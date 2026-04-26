# jp-trainer — AI-Native Japanese Training for Claude Code / Codex / Gemini

> Date: 2026-04-27
> Status: design

---

## 1. Why

学日语为 N2 工作签证。市面方案两类都不行：

- **Anki / Duolingo**：要切换上下文专门去练，每天打开是负担。
- **代码内训练（commit/PR 写日语）**：污染工作产出，团队/CI 都受影响。

机会点：每天写代码大量时间花在「等 Claude 回话」「等 build」「打 commit」这些已经存在的间隙。
本工具把日语训练**寄生**在这些间隙上：你不主动学，hooks 把题塞过来；你想主动学，`/jp` 一句话就出题。

核心 thesis：**LLM 在线时永远有出题能力**。题库不需要静态题面，只需要「概念点 ID」+ FSRS 排期。Hook/skill 触发时把概念点喂给 LLM，LLM 现场生成题，回答喂给 LLM 评分，结果回写错题本。

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  USER                                                        │
│    ↕ 自然对话 + /jp 命令 + 工作流（commit / build / pause）  │
├─────────────────────────────────────────────────────────────┤
│  Claude Code / Codex / Gemini                                │
│    ↕ skills (命令入口)        ↕ hooks (自动触发)              │
├─────────────────────────────────────────────────────────────┤
│  ~/.claude/skills/jp-trainer/    ~/.claude/settings.json     │
│  ~/.codex/AGENTS.md (snippet)    (hooks 配置)                │
│  ~/.gemini/GEMINI.md (snippet)                               │
│    ↕ shell exec                                              │
├─────────────────────────────────────────────────────────────┤
│  jp CLI (Bun + TS, single binary at ~/.local/bin/jp)         │
│    setup / next / answer / review / stats / config / add     │
│    sleep-check / immersion-toggle / detect-cn                │
│    ↕ SQLite + YAML                                           │
├─────────────────────────────────────────────────────────────┤
│  ~/.config/jp-trainer/                                       │
│    profile.yaml         ← 水平/目标/触发概率/工作时间          │
│    reviews.db (SQLite)  ← 错题 + SRS 进度 + attempts          │
│    immersion.flag       ← 沉浸模式开关                         │
│    seeds/*.yaml         ← 题库种子（N5-N2 概念点）             │
└─────────────────────────────────────────────────────────────┘
```

CLI 是核心引擎。Skills 是命令式入口（同时承担 LLM 出题/评分的 prompt 模板）。Hooks 是自动触发（仅 Claude Code 有等效机制）。三者都通过 shell 调 jp CLI，CLI 不依赖 LLM。

---

## 3. Data Flow

### 3.1 主动出题（`/jp` skill）

```
user: /jp
  ↓
Claude 读 skill markdown
  ↓
Claude run: jp next --json
  ↓
CLI: 从 reviews.db 选一个 due 的 concept (FSRS 排期最早) → 输出 JSON
  ↓
Claude 读 concept (id/level/type/ja/zh/examples) → 现场生成题面
  ↓
user 答
  ↓
Claude 评分 1-4 (FSRS rating: 1=again 2=hard 3=good 4=easy)
  ↓
Claude run: jp answer --concept-id X --rating Y --user-answer "..." --feedback "..."
  ↓
CLI: ts-fsrs.next(card, rating) → update reviews.db (stability/difficulty/due_at)
  ↓
若 rating ≤ 2：写 attempts 表，下次 next 优先选这个 concept 的变体
```

### 3.2 自动注入（Stop hook）

```
Claude 回完话 → Stop hook 触发
  ↓
hook 脚本: jp inject-decide --inject-rate 0.15 → 输出 0/1
  ↓ (1)
hook 脚本: jp next --json → 拿 concept
  ↓
hook 脚本输出 hookSpecificOutput.additionalContext = "[日语训练] 请基于这个概念出一道题给我答：{concept JSON}"
  ↓
Claude 在下一轮自动出题（hook 注入到 next user turn 前）
```

### 3.3 沉浸模式

```
user: /jp on → skill 调 jp immersion-toggle on → touch ~/.config/jp-trainer/immersion.flag
  ↓
之后每次 user prompt → UserPromptSubmit hook 检测 flag
  ↓
hook 注入 additionalContext = "用户处于日语沉浸模式：所有回答先用日文（带假名注音），再附中文翻译"
  ↓
user: /jp off → 删除 flag
```

### 3.4 关键词反问

```
user 输入含中文 → UserPromptSubmit hook
  ↓
jp detect-cn --probe-rate 0.05 --text "..." → 输出 0/1
  ↓ (1)
hook 注入 additionalContext = "顺手让用户做日语翻译练习：把这句中文 '...' 翻译成日语，先让用户自己答"
```

### 3.5 Cron 定时

```
launchd 09:00 触发 → jp daily-push
  ↓
CLI 检测当前 work_hours → 是工作日工作时间 → 通过 osascript 发系统通知
  ↓
notification: "今日 5 词 + 1 语法已上桌，去 Claude Code 打 /jp review"
  ↓
（可选）通过 anthropic API 直接发 prompt 到指定 session 文件 — phase 2
```

---

## 4. SQLite Schema

```sql
-- 概念点（题库种子，import 一次性导入）
CREATE TABLE concepts (
  id           TEXT PRIMARY KEY,         -- 'n3-grammar-tokoroda' / 'n4-vocab-benkyou'
  type         TEXT NOT NULL,             -- 'vocab' | 'grammar' | 'kanji' | 'expression'
  level        TEXT NOT NULL,             -- 'N5' | 'N4' | 'N3' | 'N2' | 'N1'
  ja           TEXT NOT NULL,             -- 'ところだ' / '勉強'
  reading      TEXT,                      -- 假名读音（汉字必填）
  zh           TEXT NOT NULL,             -- 中文释义
  examples     TEXT,                      -- JSON array of {ja, zh}
  tags         TEXT,                      -- JSON array: ['business', 'casual', ...]
  pos          TEXT,                      -- part-of-speech for vocab
  created_at   INTEGER NOT NULL
);

-- FSRS 排期
CREATE TABLE reviews (
  concept_id   TEXT PRIMARY KEY REFERENCES concepts(id),
  due_at       INTEGER NOT NULL,          -- Unix ms
  stability    REAL NOT NULL,
  difficulty   REAL NOT NULL,
  elapsed_days REAL NOT NULL DEFAULT 0,
  scheduled_days REAL NOT NULL DEFAULT 0,
  reps         INTEGER NOT NULL DEFAULT 0,
  lapses       INTEGER NOT NULL DEFAULT 0,
  state        INTEGER NOT NULL DEFAULT 0, -- 0=New 1=Learning 2=Review 3=Relearning
  last_review  INTEGER
);

-- 答题历史（错题本核心 + 进度统计）
CREATE TABLE attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id   TEXT NOT NULL REFERENCES concepts(id),
  rating       INTEGER NOT NULL,           -- 1-4 FSRS rating
  user_answer  TEXT,
  llm_feedback TEXT,
  source       TEXT,                       -- 'manual' | 'stop-hook' | 'post-tool' | 'cron' | 'review'
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_reviews_due ON reviews(due_at);
CREATE INDEX idx_attempts_concept ON attempts(concept_id, created_at DESC);
```

---

## 5. SRS Algorithm

用 [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs)（FSRS-5 算法）。
- 新概念默认 stability=2, difficulty=5
- 每次答题输入 rating (1-4) → 算法输出新的 stability/difficulty/due_at
- `jp next` 选 `due_at <= now()` 中 due_at 最早的（混合一定比例新概念，由 profile.daily_new_count 决定）

---

## 6. Hook Specifications

### 6.1 Stop Hook (`hooks/stop.ts`)

触发：Claude 每次回完话。

```typescript
// pseudo
const profile = readProfile();
if (Math.random() > profile.inject_rate) return; // 默认 0.15
if (!isWithinWorkHours(profile)) return;
const concept = exec('jp next --json --quiet');
if (!concept) return; // 没有 due 的概念
const prompt = `[日语训练 · ${concept.level} · ${concept.type}]\n请基于这个概念出一道题让用户答（题型由你判断：选择题/填空/翻译/造句）。用户答完后用 jp answer 记录评分。\n概念：${JSON.stringify(concept)}`;
output({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: prompt } });
```

### 6.2 UserPromptSubmit Hook (`hooks/user-prompt-submit.ts`)

触发：用户每次提交 prompt。

合并 3 个职责：
1. **新会话注入**：检测是否新会话（首次 prompt） → 注入「今日待复习 X 题」清单
2. **沉浸模式**：检测 flag 文件 → 注入沉浸指令
3. **关键词反问**：检测含中文 → 概率（默认 0.05）注入翻译练习

```typescript
const profile = readProfile();
const ctx: string[] = [];

if (isNewSession()) {
  const due = exec('jp due-count');
  if (due > 0) ctx.push(`[日语训练] 今日待复习 ${due} 题，输入 /jp 开始`);
}

if (existsImmersionFlag()) {
  ctx.push('[沉浸模式] 之后所有回答先用日文（带假名 furigana），再附中文翻译');
}

if (containsChinese(input.user_message) && Math.random() < profile.cn_probe_rate) {
  const concept = exec('jp next --json --quiet --source detect-cn');
  if (concept) {
    ctx.push(`[关键词反问] 把用户这句话「${snippet}」翻成日语 + 顺便复习概念 ${concept.id}`);
  }
}

output({ hookSpecificOutput: { additionalContext: ctx.join('\n\n') } });
```

### 6.3 PostToolUse Hook (`hooks/post-tool-use.ts`)

触发：工具调用结束后（特别是耗时 >5s 的工具如 build、test、analyze）。

```typescript
const profile = readProfile();
if (!profile.post_tool_inject) return;
if (input.tool_response.duration_ms < 5000) return; // 只在长任务后
if (Math.random() > 0.3) return; // 30% 概率
const concept = exec('jp next --json --quiet --type vocab'); // 长任务后塞单词卡，比塞语法负担小
if (!concept) return;
output({
  hookSpecificOutput: {
    additionalContext: `[等 build 顺手记个词] ${concept.ja}（${concept.reading}）= ${concept.zh}\n例：${concept.examples[0].ja}`,
  },
});
```

---

## 7. Skill Specifications

### 7.1 `/jp` （主入口，多分支）

```
/jp                  → jp next + Claude 出题
/jp easy             → 出 N5/N4 题
/jp hard             → 出 N1 题或 user level + 1
/jp grammar          → 只出语法题
/jp vocab            → 只出词汇题
/jp on               → jp immersion on
/jp off              → jp immersion off
/jp review           → 列今日待复习 + 逐题过
/jp stats            → 进度（今日答题数 / 准确率 / 各 level 概念覆盖）
/jp setup            → 首次 onboarding
/jp config inject_rate=0.2  → 改 profile
/jp add "ところで"   → 手动加错题（CLI 反查 jisho 类似数据补全）
```

### 7.2 `/jp-setup` （首次配置 onboarding）

skill 引导 LLM 问：
1. 当前水平（N5-N1 自评 + 简单测试 5 题）
2. 目标水平（默认 N2）
3. 弱项（词汇/语法/汉字/听力）
4. 工作时间（影响 cron + work_hours）
5. 训练强度：
   - inject_rate（Stop hook 概率，默认 0.15）
   - post_tool_inject（开关，默认 true）
   - cn_probe_rate（关键词反问概率，默认 0.05）
   - daily_cron（HH:MM，默认 09:00；空字串=关）
   - daily_new_count（每天新概念数量，默认 5）
6. 沉浸模式默认开关（默认 false）

最后写 `~/.config/jp-trainer/profile.yaml` 并执行 `jp install-cron`。

---

## 8. profile.yaml Schema

```yaml
version: 1
level: N3
target: N2
weak_areas: [grammar, kanji]
work_hours: "09:00-19:00"
work_days: [Mon, Tue, Wed, Thu, Fri]

inject_rate: 0.15            # Stop hook 概率
post_tool_inject: true       # 长任务投递开关
post_tool_min_duration_ms: 5000
post_tool_inject_rate: 0.3
cn_probe_rate: 0.05          # 关键词反问概率
daily_cron: "09:00"          # 每日 cron 时间，空=关
daily_new_count: 5           # 每天最多新概念数
immersion_default: false

# Phase 2:
notification_channel: macos  # macos | telegram | none
```

---

## 9. Codex / Gemini Adaptation

Codex 和 Gemini 没有等效 hooks 机制，所以**自动触发功能仅 Claude Code 有**。其他客户端通过：

### 9.1 Codex (`~/.codex/AGENTS.md` snippet)

```markdown
## Japanese Training Tool

`jp` CLI is in PATH. When the user says `/jp` or asks for Japanese practice:
- Run `jp next --json` to get the next concept due for review
- Generate a question based on the concept JSON (type: vocab/grammar)
- After user answers, evaluate and run `jp answer --concept-id X --rating Y --user-answer "..." --feedback "..."`
- For review session: `jp review` lists all due cards
- For stats: `jp stats`

User profile is at `~/.config/jp-trainer/profile.yaml`. Match the user's level when choosing question difficulty.
```

### 9.2 Gemini (`~/.gemini/GEMINI.md` snippet)

类似，命令格式可能略有差异。

### 9.3 跨客户端的错题本是同一个

`~/.config/jp-trainer/reviews.db` 是单一真相。Claude Code 答题、Codex 答题、Gemini 答题、CLI 直接答题（`jp` 命令）都更新同一个 db。FSRS 排期共享。

---

## 10. Cron / launchd

macOS：

```xml
<!-- ~/Library/LaunchAgents/com.jp-trainer.daily.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.jp-trainer.daily</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/USER/.local/bin/jp</string>
    <string>daily-push</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>9</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>/tmp/jp-trainer.log</string>
  <key>StandardErrorPath</key><string>/tmp/jp-trainer.err</string>
</dict>
</plist>
```

`jp install-cron` 子命令：根据 profile.daily_cron 生成 plist + `launchctl load -w`。

`jp daily-push` 行为：
1. 检测 work_hours / work_days（不在工作时间不打扰）
2. 算今日 due 概念数
3. macOS：`osascript -e 'display notification "今日 N 题待复习" with title "jp-trainer"'`
4. （phase 2）通过 anthropic CLI / API 注入到指定 session

---

## 11. Install Flow (`install.sh`)

```bash
#!/bin/bash
set -euo pipefail

# 1. 装 bun（如未装）
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash

# 2. 装依赖 + build
cd "$(dirname "$0")"
bun install
bun build src/cli.ts --compile --outfile ~/.local/bin/jp

# 3. 拷 skills
mkdir -p ~/.claude/skills
cp -r skills/jp-trainer ~/.claude/skills/

# 4. 拷 hooks 到独立目录（不放 skills 下）
mkdir -p ~/.claude/jp-trainer-hooks
cp hooks/*.ts ~/.claude/jp-trainer-hooks/

# 5. 改 ~/.claude/settings.json 加 hook 配置（用 jq 安全合并）
node scripts/install-hooks.mjs   # 用 node 脚本编辑 JSON 避免 jq 依赖

# 6. 初始化数据
mkdir -p ~/.config/jp-trainer
[ -f ~/.config/jp-trainer/profile.yaml ] || cp data/default-profile.yaml ~/.config/jp-trainer/profile.yaml

# 7. 导入种子题库
jp seed-import

# 8. Codex / Gemini snippet（用户手动选）
echo "可选：将 codex/AGENTS.snippet.md 内容追加到 ~/.codex/AGENTS.md"

# 9. 提示用户跑 setup
echo "完成。运行 \`jp setup\` 或在 Claude Code 里用 /jp-setup 进行个性化配置"
```

---

## 12. Logic Deep Dive

### 12.1 `jp next` 选题逻辑

```
SELECT c.*
FROM reviews r JOIN concepts c ON c.id = r.concept_id
WHERE r.due_at <= now()
  AND (filter type/level if specified)
ORDER BY r.due_at ASC
LIMIT 1;
```

如果 due 列表空：
- 检查今日新概念配额（profile.daily_new_count）是否用完
- 未用完 → 选一个 `concept` 但 `reviews` 表无记录的（从用户 level 范围内随机）
- 用完 → 输出 `null`（hook/skill 收到 null 不出题）

### 12.2 `jp answer` 写入

```typescript
const card = getCardOrCreate(concept_id);
const next = fsrs.next(card, rating, now);
db.exec(`UPDATE reviews SET stability=?, difficulty=?, due_at=?, ... WHERE concept_id=?`, ...);
db.exec(`INSERT INTO attempts (concept_id, rating, user_answer, llm_feedback, source, created_at) VALUES (...)`);
```

### 12.3 沉浸 flag

`touch ~/.config/jp-trainer/immersion.flag` / `rm immersion.flag`。
UserPromptSubmit hook fs.existsSync 检测。

### 12.4 work_hours 检测

```typescript
const [start, end] = profile.work_hours.split('-');
const now = new Date();
const dayMatch = profile.work_days.includes(weekday(now));
const hourMatch = isBetween(now, start, end);
return dayMatch && hourMatch;
```

cron / Stop hook 都共用此逻辑（Stop hook 即使在工作日工作时间外也不该烦人）。

### 12.5 关键词反问的中文检测

```typescript
const cnRegex = /[一-龥]/;
function detectMeaningfulCn(text: string): string | null {
  const lines = text.split('\n').filter(l => l.length > 5 && cnRegex.test(l));
  return lines[0] ?? null;
}
```

---

## 13. Extension

### 13.1 加新概念类型

1. `concepts.type` 加新值（如 `'kana'` 假名练习）
2. 写 `data/seeds/n5-kana.yaml`
3. `jp seed-import` 重跑
4. 更新 skill markdown 让 LLM 知道这种新题型怎么出

### 13.2 加新触发器

1. 写 `hooks/your-hook.ts`
2. 加到 install.sh 的 settings.json 合并逻辑
3. 在 design doc 6 节补 spec

### 13.3 加新客户端（如 Cursor / Continue）

1. 写 `<client>/INSTRUCTIONS.md` snippet
2. install.sh 提示用户拷贝
3. CLI 接口不变（shell exec 即可）

---

## 14. Testing

- `bun test` 跑 CLI 单元测试（FSRS 排期、profile 解析、work_hours 检测）
- 手动 e2e：`jp setup → jp next → jp answer → jp stats`
- Hook 在 Claude Code 里实测（无法自动化）
- Cron 用 `launchctl start com.jp-trainer.daily` 强制触发验证

---

## 15. Phase Roadmap

- **Phase 1（MVP）**：CLI 全 + skills 全 + 3 个 hooks + 沉浸 + 关键词反问 + cron + Codex/Gemini snippet + install
- **Phase 2**：N1 题库扩展 / 听力（用 macOS say 命令朗读）/ Telegram 通知 / 网页 dashboard
- **Phase 3**：移动端（iOS app 复用同一 reviews.db via iCloud）
