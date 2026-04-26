# jp-trainer RALPLAN-DR — Planner v1

> Date: 2026-04-27
> Mode: **DELIBERATE** (high-risk dev-first tool, hooks 装错会污染所有 Claude Code 会话)
> Scope: 任务 6-13（任务 1-5 已实现，本 plan 不重新设计）
> Owner: Planner phase（不写代码，只规划，等 Architect/Critic 共识后由 Executor 落地）

---

## 0. Current State Snapshot

| 任务 | 状态 | 关键产出 |
|---|---|---|
| 1 装 bun | done | bun in PATH |
| 2 项目骨架 + git | done | `package.json` (ts-fsrs 4.6 / yaml 2.6 / commander 12) + `tsconfig` |
| 3 design doc | done | `docs/design.md` (404 行) |
| 4 CLI 骨架 | **partially-done** | `src/cli.ts` 13 个子命令全实现：`setup / next / answer / review / due-count / stats / config / immersion / inject-decide / detect-cn / seed-import / daily-push / install-cron`。**缺**：`add`、`sleep-check` |
| 5 SRS + DB | done | `db.ts` (concepts/reviews/attempts + 3 索引 + WAL + foreign_keys) / `srs.ts` (getOrInitCard/recordAnswer) / `concepts.ts` (getNextDue with daily_new_count gating + listDueConcepts + getStats) / `profile.ts` (Profile + DEFAULT_PROFILE + levelsInLearningRange) |
| 6 种子题库 | **空** | `data/seeds/` 目录在但 0 文件 |
| 7 skills | **空** | `skills/` 目录在但 0 文件 |
| 8 hooks | **空** | `hooks/` 目录在但 0 文件 |
| 9 沉浸+关键词反问 | CLI 部分 done | `jp immersion` + `jp detect-cn` 已实现；缺 hook 接线 |
| 10 launchd | CLI 部分 done | `jp install-cron` + `jp daily-push` 已实现；缺独立 plist 模板文件用于 install.sh |
| 11 Codex/Gemini | **空** | 需要 `codex/AGENTS.snippet.md` + `gemini/GEMINI.snippet.md` |
| 12 install.sh | **空** | 需要 `install.sh` + `scripts/install-hooks.mjs` |
| 13 README + demo | **空** | 需要 `README.md` + e2e 跑通 |

**Gap 清单（design 内但 CLI 没实现）**：
- `jp add "ところで"`（design §7.1 提到，CLI 没有）
- `jp sleep-check`（design §2 提到，CLI 没有，可能是 work_hours 检测的别名）

---

## 1. Principles (5)

1. **依附工作流不打断**：训练必须寄生在用户已有的「等 LLM / 等 build / 打 commit」间隙；任何要求用户主动切换上下文的设计都失败。
2. **错题本是单一真相**：`~/.config/jp-trainer/reviews.db` 跨 Claude/Codex/Gemini/CLI 共享。FSRS 排期一处算，不允许任何客户端持有本地副本。
3. **CLI 是核心引擎，LLM 是渲染层**：`jp` 二进制不依赖 LLM，hook/skill 只负责把 concept JSON 喂给 LLM 出题/评分。LLM 离线/超时不能让 db 损坏。
4. **概率触发 + 工作时间感知**：所有 hook 都尊重 `inject_rate` 和 `work_hours`，宁可少触发也不要烦到用户去 `kill -9 jp`。
5. **失败安全 + 可一键关闭**：任何 hook 异常必须 silent fail（exit 0 + 空 additionalContext），settings.json 的 hook block 必须可一行删除回滚。

---

## 2. Decision Drivers (top 3)

1. **零摩擦（Zero Friction）**：用户已经在用 Claude Code 干活，jp-trainer 不能产生「打开 / 切换 / 等待」三动作中的任何一个。Stop hook 弹太多 = 关掉 = 项目失败。
2. **Cross-tool 一致性**：Claude/Codex/Gemini 必须看到同一个错题本和同一份 profile。任何方案如果导致 Codex 答的题在 Claude 看不到 = 项目失败。
3. **N2 通过率（business outcome）**：题库覆盖 + FSRS 间隔 + 关键词反问场景实用度，决定 6-12 个月后能不能过 JLPT N2。覆盖率不足 / 题面与考试形式偏差大 = 项目失败。

> 次优 driver（在 ties 时使用）：可调试性（log 哪些事件）> 安装鲁棒性（不同 shell/macOS 版本）> 扩展性（加 Cursor/Continue）。

---

## 3. Viable Options + Tradeoffs

### D1. 题库形态：LLM 现场生成 vs 静态题面 vs 混合（种子有词条但题面 LLM 生成）

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 纯 LLM 生成（concept 都不存） | 题型无限、个性化（按 weak_area 现场调） | FSRS 没法排期（没有稳定 ID）、离线完全不能用、跨工具不一致（每次出题都不一样）、token 烧 | 否 |
| B. 静态题面（concept + 题干 + 答案都入 db） | 离线可用、确定性、好测试 | 题型固定枯燥、user 看到第二次会记答案而非记概念、N2 语法点 1500 条要手写题面 = 几千条人工 | 否 |
| **C. 混合：concept 静态 + 题面 LLM 生成** | concept 是稳定 ID（FSRS 能排期）、题型多样（LLM 每次换题型/语境）、跨工具同 concept_id 同进度、种子工作量可控（只写 ja/zh/examples） | 离线不能出题（但能 review 看答案）、LLM 一致性靠 prompt 模板约束 | **是（已落实）** |

**已选 C**。已实现 path：`concepts` 表只存 ja/zh/examples，`reviews` 表存 FSRS 状态，skill markdown 里 prompt 模板让 LLM 按 concept JSON 出题 + 评 1-4 分调 `jp answer`。**不需要重新决策**，但需要在 skill 模板里固化「题型轮换约定」（见 §6 任务 7）。

### D2. Stop hook 默认 `inject_rate`：0.05 / 0.15 / 0.30

| Rate | 用户感受（每天 100 次 Claude 回话粗估） | Pros | Cons |
|---|---|---|---|
| 0.05 | 5 次/天 | 几乎无感 | 训练量不足，覆盖率上不去 |
| **0.15** | 15 次/天 | 错题本能消化、但每小时不超过 2 次 | 仍可能在专注时干扰 |
| 0.30 | 30 次/天 | 训练量充足 | 高强度时段烦到关 |

**推荐 0.15（design 已设）**。但加 escape hatch：
- profile 加 `inject_max_per_hour: 3`（默认），hook 内部读 `~/.config/jp-trainer/sessions/<sessionId>/inject-count.json` 限流
- profile 加 `respect_work_hours: true`（默认 true），非工作时间不塞
- 用户可一行 `jp config inject_rate=0.05` 立即降档

**Alternative invalidation**：0.05 数据上不会让 N2 通过，0.30 用户实测会关；0.15 + 限流是唯一兼顾 driver 1 和 3 的点。

### D3. UserPromptSubmit hook 三职责：拆 3 个 vs 合 1 个 vs dispatch 脚本

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 拆 3 个独立 hook | 单一职责、好测试 | settings.json 里 3 个 entry、每次 user prompt 启动 3 次 bun（bun 启动 30-50ms × 3 = 90-150ms 延迟） | 否 |
| **B. 合 1 个 dispatch 脚本（hooks/user-prompt-submit.ts 内部分支）** | 1 次 bun 启动、三个职责共享 profile 读取、settings.json 干净 | 单文件 100-150 行、单元测试需要 mock 三个分支 | **是** |
| C. shell wrapper dispatch | 不需要 bun | shell 写 SQLite 太脏、跨平台 bash/zsh 差异 | 否 |

**推荐 B**。三职责是：(1) 新会话注入 due 清单 (2) 沉浸 flag 注入 (3) 中文检测概率反问。共享 profile/db handle，只启动一次 bun。

### D4. 种子量级：1500 / 3000 / 5000

JLPT N2 官方词汇约 6000 + 语法约 200 个语法点。

| 量级 | 覆盖率 | 来源可行性 | 用户体验 |
|---|---|---|---|
| 1500 | N5+N4 全 + N3 一半 + N2 核心 600 词 + N2 50 语法 | jonchang/jlpt-vocab MIT 直接拉，N2 语法 50 条 LLM 生成 | 6 个月够刷一轮，FSRS 间隔合适 |
| **3000** | N5/N4/N3 全 + N2 词 1800 + N2 语法 100 | jonchang 全量 + 自建 N2 语法 | **最佳平衡**：N2 通过覆盖 80%+，每天新 5 词刷完要 1.5 年但 FSRS 复习足够 |
| 5000 | N1 也带（target=N1 用户用） | 多源拼接、license 复杂 | 当前 user target=N2，过度 |

**推荐 3000**。Phase 1 落 1500（jonchang 直接 import），phase 1.1 补 N2 语法 100 条 + N2 高频 1500 词（jonchang 已含），落地 ~3000。

**Alternative invalidation**：1500 在 user level=N3 / target=N2 场景会在 3 个月用完新概念配额（5/day × 90 day = 450）；5000 多出来的 N1 概念在 `levelsInLearningRange` 里被过滤不会被选到，纯浪费 db 容量。

### D5. install.sh 改 settings.json：覆盖 / jq 合并 / 不动 settings 改 hooks.d 目录

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 直接覆盖 settings.json | 简单 | 用户已有的 hooks/permissions/MCP 配置全丢 → **必拒** | 否 |
| B. jq 合并（或 node script） | 安全、用户已有配置保留 | jq 不一定装、jsonc 注释会丢；node 自带在 macOS 但需写 200 行 merge | 中 |
| **C. node script + 备份 settings.json.bak + 幂等检测 hook 已存在则 skip** | 安全 + 可回滚 + 幂等重跑、不依赖 jq | 200 行 merge 代码 | **是** |
| D. 改 `~/.claude/hooks.d/` 目录约定 | 极干净 | Claude Code 没这个机制，需要改 settings.json 加一个 dispatcher 入口 | 否（不存在的特性） |

**推荐 C**。`scripts/install-hooks.mjs`：
1. `cp ~/.claude/settings.json ~/.claude/settings.json.jp-bak.$(date +%s)`
2. 用 node `JSON.parse` 读现有 settings
3. 若 `hooks.Stop` 数组里已有 `command` 含 `jp-trainer-hooks/stop` 则 skip（幂等）
4. 否则 `push` 一条
5. `JSON.stringify(..., null, 2)` 写回
6. 输出「卸载方法：编辑 settings.json 删除带 `jp-trainer-hooks` 的 entry」

**Alternative invalidation**：A 数据不安全直接拒；D 没这个特性是脑补；B 是 C 的简化版但少了幂等和备份不够 robust。

### D6. 沉浸模式 + 代码任务白名单

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 纯日文沉浸不区分 | 强训练 | Claude 解释 React/Riverpod 时词不达意、用户为了听懂 patch 说明会反复关沉浸 | 否 |
| **B. 用户消息含 code block / `import ` / 文件路径 → 当次 turn 切回中文** | 工作不受影响、闲聊全日文 | 检测启发式可能漏判（如「这个 widget 怎么 build」无 code block） | **是** |
| C. 加白名单关键词列表（widget/build/test/ts/dart/...） | 准确度高 | 维护词表、不同项目词不同 | 否 |

**推荐 B**。在 UserPromptSubmit hook 中：
```ts
if (immersion && !looksLikeCodeContext(userMessage)) {
  inject('沉浸模式：先用日文（带假名）回答，再附中文翻译');
}
function looksLikeCodeContext(s: string): boolean {
  return /```|^import |\.dart\b|\.ts\b|\bclass \w+|\bfunction \w+/.test(s);
}
```
**Alternative invalidation**：A 已在 design.md 中暗示问题；C 词表维护成本高且 user 提到的「Riverpod/React」每个项目都不同，启发式正则更通用。

### D7. Cross-tool 并发写 reviews.db：WAL 够吗

**事实核对**（需 Architect 验证）：
- bun:sqlite 默认 journal_mode=DELETE，已在 `db.ts` `getDb()` 里 `PRAGMA journal_mode = WAL`
- WAL 允许多个 reader + 单个 writer 并发不阻塞 reader
- 三客户端（Claude/Codex/Gemini）同时调 `jp answer` 时是三个独立 process 三次写

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. WAL + busy_timeout + 重试** | 现有架构、SQLite 久经考验、fcntl 锁内核保证 | 极端情况 SQLITE_BUSY 需要 retry | **是** |
| B. 加 file lock（flock） | 强一致 | bun:sqlite 没暴露 flock API、wrapper 化太复杂 | 否 |
| C. 改用 server 模式（单进程 daemon） | 完全消除并发 | 增加 daemon 生命周期管理、违反「失败安全」原则 | 否 |

**推荐 A**。补丁需求：
- `db.ts` 加 `PRAGMA busy_timeout = 5000;`（5 秒等锁，足够覆盖三客户端瞬时撞）
- `srs.ts recordAnswer` 包 try-retry（最多 3 次，间隔 100ms 指数退避）
- log 失败到 `~/.config/jp-trainer/jp.log`

**Alternative invalidation**：B 需要 wrapper bun:sqlite 写 N-API 太重；C 一个 daemon 给 N2 训练这种低 QPS 场景过度设计。

### D8. N2 语法点种子来源：公开数据 vs LLM 一次性生成

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. tanos.co.uk 抓取 | 老牌 N2 grammar list | 网站 license 不明、抓取稳定性 | 中 |
| B. jonchang/jlpt-vocab（MIT） | license 干净 | **只有词汇，没有语法点** | 词汇 yes，语法 no |
| **C. LLM 一次性生成 N2 语法 100-150 条 + 人工校对** | license 自有、质量可控、format 统一 | 一次性 ~30 分钟 LLM 工作 + 用户花 2-3 天 review | **是** |
| D. 商业题库授权 | 权威 | 钱、且不是开源 | 否 |

**推荐 C**。具体做法（**作为任务 6 的一部分**）：
1. 用 Claude Opus 一次性生成 `data/seeds/n2-grammar.yaml` ~120 条
2. 每条 fields：id (n2-grammar-XXX) / type=grammar / level=N2 / ja (语法形式如 `〜にすぎない`) / zh (释义) / examples (3 条 ja+zh)
3. user 抽样 review 10% 验证质量（错则全量重生）
4. 词汇侧：`bun run scripts/import-jonchang.ts` 把 jonchang 的 N5-N2 vocab 转成 yaml seeds

**Alternative invalidation**：A license 风险（tanos 没明示）；B 缺语法直接不够；D 不开源不符合个人工具定位。

---

## 4. Pre-mortem (3 scenarios)

### Scenario 1: Stop hook 烦人到关闭（**likelihood=H**, **impact=H**）

**症状**：用户两周后 PR `git diff ~/.claude/settings.json` 把 jp-trainer hooks 注释掉。
**根因可能**：
- inject_rate=0.15 在 3 小时 60 次 Claude 回话场景下 = 9 次出题，专注 coding 时崩溃
- 题面与代码上下文语境不符（在调 Riverpod bug 时塞「ところで」翻译）
- LLM 评分敷衍，用户觉得在自动化糊弄

**Mitigation**：
1. 加 `inject_max_per_hour: 3`（hour 级限流，硬上限）
2. 加 `inject_max_per_session: 10`（单会话上限，避免一坐 4 小时被砸 30 次）
3. PostToolUse hook **不**在 build/test 失败时塞（错误恢复阶段更脆弱）
4. profile 加 `do_not_disturb_until: <ISO ts>` 字段，`/jp dnd 1h` 命令一键暂停 1 小时
5. 默认 inject_rate=0.10（design 是 0.15，但保守起步，用户嫌少自己调）— **建议改默认值**
6. log 每次 inject 决策（why fired / why skipped），3 天后 `jp stats --inject` 看实际频率

### Scenario 2: Cross-tool 写冲突丢数据（**likelihood=L**, **impact=H**）

**症状**：用户在 Claude Code 答完 `/jp` 题，切到 Codex 看 stats，发现刚答的没记上，db 损坏。
**根因可能**：
- WAL 文件 `.wal` / `.shm` 跨进程不一致
- 三个客户端同时 `jp answer` 撞锁，bun:sqlite 默认 busy_timeout=0 直接抛 SQLITE_BUSY 不重试
- ts-fsrs `recordAnswer` 是双语句（UPDATE reviews + INSERT attempts），中间崩溃留半截

**Mitigation**：
1. `db.ts` 加 `PRAGMA busy_timeout = 5000`
2. `srs.ts recordAnswer` 包事务 `db.transaction(() => { update; insert; })()`
3. 写失败重试 3 次（exponential backoff 100/300/900ms）
4. 全程 log + `jp stats --integrity` 命令做一次 `PRAGMA integrity_check` 报告
5. **install 时**自动建 `~/.config/jp-trainer/reviews.db.daily-backup-<date>` cron（每日 0 点 sqlite3 .backup），保留 7 份滚动覆盖

### Scenario 3: 设计复杂用户跑不起来（**likelihood=M**, **impact=M**）

**症状**：用户 `bash install.sh` 报错或装完 hook 不触发，半小时排查不定，放弃。
**根因可能**：
- bun build 在 macOS Sequoia 26.x 上有 codesign 要求（需要 ad-hoc sign）
- `~/.claude/settings.json` 不存在（用户没装 hooks 过），install 脚本假设它在
- launchctl load plist 在 macOS 13+ 需要 SMAppService 注册（旧 launchctl 警告但能用）
- chmod +x 漏掉，hook 文件不可执行

**Mitigation**：
1. `install.sh` 第一步 `command -v bun` 不存在直接 `curl bun.sh/install` 自动装
2. 检测 `~/.claude/settings.json` 不存在则 `echo '{}' >`
3. 每个 hook 文件 `chmod +x`
4. install 末尾跑 **smoke test**：`jp next --json`、`jp stats`、`jp config --show`、`bash hooks/stop.sh < /dev/null`（验证 exit code = 0），任何失败大红字打印 + 不继续
5. README 顶部 `## 快速验证` 5 行命令检验装机
6. install.sh 失败必须能完全回滚（备份 settings.json，加 `install.sh --uninstall` 子命令）

---

## 5. Test Plan (expanded)

### 5.1 Unit (CLI 命令、SRS、profile、work-hours、detect-cn)

文件：`tests/*.test.ts`，跑 `bun test`

| 测试 | 覆盖目标 | 关键 case |
|---|---|---|
| `tests/profile.test.ts` | profile.ts | DEFAULT_PROFILE 写回读、partial patch 不丢字段、levelsInLearningRange(N3→N2) = [N2, N3, N4] |
| `tests/srs.test.ts` | srs.ts | new card → rating=3 due 推迟、rating=1 due 不变 lapse++、并发 recordAnswer 事务原子 |
| `tests/concepts.test.ts` | concepts.ts | due_at <= now 选最早、daily_new_count 用完返回 null、type 过滤、level 过滤 |
| `tests/work-hours.test.ts` | work-hours.ts | 工作日工作时间 true、周末 false、9:00-19:00 边界 |
| `tests/detect-cn.test.ts` | cli.ts detect-cn | 中文短句过滤、长度 ≥5 阈值、probe-rate=0 全 skip |
| `tests/seeds.test.ts` | seeds.ts | upsert 幂等、缺字段 skipped、example/tags JSON encode |
| `tests/inject-decide.test.ts` | cli.ts inject-decide | rate=0 永远 exit 1、rate=1 永远 exit 0、respect-work-hours 非工作时间 exit 1 |

**目标覆盖率**：CLI 核心路径 90%+。

### 5.2 Integration (hook → CLI → DB)

文件：`tests/integration/*.test.ts`

| 测试 | 流程 |
|---|---|
| stop-hook full path | 调 `hooks/stop.ts` → CLI → 输出 hookSpecificOutput JSON 含 concept |
| user-prompt-submit dispatch | 注入 ctx 含 due 清单 + 沉浸 + 中文反问，三个 case 分别打开/关闭 |
| post-tool-use | duration < 5000 跳过、duration > 5000 + rate=1 注入 vocab |
| concurrent answer | 3 个并发 spawn `jp answer` → db row 无丢失 |

### 5.3 E2E (Claude Code 装完跑一次完整 setup→next→answer→review→stats)

**手动步骤（README §5 复制粘贴）**：
1. `bash install.sh`
2. 在 Claude Code 新会话 `/jp-setup` → answer 6 个问题 → profile.yaml 写
3. `/jp` → Claude 出一道 N3 vocab 题（说明显示 concept_id）
4. 用户答错 → Claude 评 1 → 调 `jp answer` → due_at 推到几分钟后
5. `/jp review` → 列 1 条 due
6. `/jp stats` → today_attempts=1, accuracy=0%
7. 关闭 Claude，开 Codex，运行 `jp stats` → 同样数据（验证 cross-tool db）

**自动化部分**：5-7 步可写 `scripts/e2e.sh` 直接调 CLI 不走 Claude。

### 5.4 Observability

`~/.config/jp-trainer/jp.log` 写以下事件（NDJSON）：

```jsonc
{"ts":"...", "event":"inject_decision", "hook":"stop", "rate":0.15, "rolled":0.08, "fired":true, "concept_id":"n3-grammar-tokoroda"}
{"ts":"...", "event":"answer", "concept_id":"...", "rating":3, "source":"stop-hook", "next_due_at":"..."}
{"ts":"...", "event":"db_busy_retry", "attempt":2, "elapsed_ms":300}
{"ts":"...", "event":"work_hours_skip", "now":"...", "reason":"weekend"}
```

提供 `jp logs --tail 50` / `jp logs --inject-only` 子命令。

---

## 6. 任务 6-13 详细 Step Plan

### Task 6: 种子题库 import（**优先级 P0，blocker for hooks**）

| Step | 操作 | 文件 | Verify |
|---|---|---|---|
| 6.1 | clone jonchang/jlpt-vocab 到 `tmp/jonchang-jlpt-vocab` | n/a | `ls tmp/jonchang-jlpt-vocab/n5.json` |
| 6.2 | 写 `scripts/import-jonchang.ts`：把 N5-N2 json 转成 `data/seeds/{n5,n4,n3,n2}-vocab.yaml`，id 格式 `n5-vocab-勉強-001` | `scripts/import-jonchang.ts` | `bun scripts/import-jonchang.ts && ls data/seeds/*.yaml` |
| 6.3 | LLM 生成 N2 语法 120 条到 `data/seeds/n2-grammar.yaml`（用一个 `scripts/gen-n2-grammar-prompt.md` 喂 Claude Opus 一次跑完） | `data/seeds/n2-grammar.yaml`, `scripts/gen-n2-grammar-prompt.md` | YAML lint 通过 + 抽样 10 条 user 校对 |
| 6.4 | 跑 `jp seed-import` 全量入库 | n/a | `jp stats` → total_concepts ≈ 3000 |
| 6.5 | 写 `tests/seeds.test.ts`（6.4 不依赖此） | tests/ | `bun test seeds` 绿 |

**依赖**：none（任务 5 已完成）。
**估时**：2-4 小时（不含 user review N2 语法）。
**可延后项**：6.3 N2 语法可 phase 1.1，phase 1 先 N5/N4/N3/N2 vocab ~2400 条够开测。

### Task 7: 5 个 skill markdown（**优先级 P0**）

| Skill | 路径 | 行为 |
|---|---|---|
| `/jp` | `skills/jp-trainer/jp.skill.md` | 读 ARGUMENTS（easy/hard/grammar/vocab/review/stats/setup 等子命令）→ 调 `jp next --json` 或 `jp review --json` → 现场出题（题型根据 type 选）→ 收答 → 评 1-4 → 调 `jp answer` |
| `/jp-setup` | `skills/jp-trainer/jp-setup.skill.md` | 6 步 onboarding，最后 `jp config k=v ...` + `jp install-cron` |
| `/jp-review` | `skills/jp-trainer/jp-review.skill.md` | 调 `jp review --json --limit 20` → 逐题过 → 每题 jp answer |
| `/jp-on` | `skills/jp-trainer/jp-on.skill.md` | `jp immersion on` |
| `/jp-off` | `skills/jp-trainer/jp-off.skill.md` | `jp immersion off` |

**Step**:
1. 7.1 写 `jp.skill.md` 含**题型轮换**约定（vocab→选/翻/造、grammar→填/造/翻），LLM 每次伪随机选一种避免枯燥
2. 7.2 写其他 4 个 skill（thin wrapper）
3. 7.3 在每个 skill 顶部加 `description:` + `auto-trigger:` frontmatter（如果 Claude Code skills 支持）
4. 7.4 install.sh 拷贝 `skills/jp-trainer/` 到 `~/.claude/skills/jp-trainer/`
5. 7.5 在 Claude Code 实测 `/jp` 触发

**依赖**：Task 6（无 concept 没法测）。
**估时**：3-4 小时。

### Task 8: 3 个 hook 脚本（**优先级 P0，最高风险**）

| Hook | 文件 | Trigger | 行为 |
|---|---|---|---|
| Stop | `hooks/stop.ts` | Claude 回完话 | 1) 读 profile 2) 检查 work_hours 3) 限流（per-hour/per-session）4) 概率掷骰 5) `jp next --json` 6) 输出 hookSpecificOutput |
| UserPromptSubmit | `hooks/user-prompt-submit.ts` | 用户提交 prompt | dispatch 三职责：新会话 due 注入 / 沉浸（带 looksLikeCodeContext） / 中文反问（jp detect-cn） |
| PostToolUse | `hooks/post-tool-use.ts` | 工具调用结束 | 1) duration < 5000 skip 2) tool 失败 skip（错误恢复期） 3) 概率 30% 4) `jp next --json --type vocab` 5) 输出单词卡 |

**Step**:
1. 8.1 写 `hooks/lib/common.ts`：`readSession()` / `incrementInjectCount()` / `looksLikeCodeContext()` / `safeFail()` 公共工具
2. 8.2 写 stop.ts（ ~80 行）+ unit test
3. 8.3 写 user-prompt-submit.ts dispatcher（~120 行）+ unit test
4. 8.4 写 post-tool-use.ts（~60 行）+ unit test
5. 8.5 hook 都 `chmod +x`，每个开头 `#!/usr/bin/env bun`
6. 8.6 写 `hooks/README.md` 描述每个 hook 的输入/输出 schema（参照 Claude Code hooks 官方）

**依赖**：Task 6, 7。
**估时**：5-6 小时（hook schema 调试占大头）。
**关键 verify**：在测试 Claude Code session 里手动模拟 Stop 事件 → 看 hookSpecificOutput.additionalContext 出现「[日语训练]」前缀。

### Task 9: 沉浸模式 + 关键词反问（**优先级 P1，与 Task 8 一起做**）

CLI 已实现 `jp immersion` + `jp detect-cn`，本任务只剩**接线**到 Task 8 的 user-prompt-submit hook：

| Step | 操作 |
|---|---|
| 9.1 | hooks/user-prompt-submit.ts 内调 `existsSync(IMMERSION_FLAG)` 注入沉浸 ctx |
| 9.2 | 同 hook 内 spawn `jp detect-cn --probe-rate <profile.cn_probe_rate>` 检测中文 |
| 9.3 | 注入「翻译练习」prompt 时附 concept JSON（需要调 jp next）让 LLM 顺便巩固 |
| 9.4 | 写 `tests/integration/user-prompt-submit.test.ts` |

**估时**：1-2 小时（基本跟 Task 8.3 合并）。

### Task 10: launchd plist 模板（**优先级 P2**）

`jp install-cron` CLI 已实现内联生成 plist。本任务做**独立模板文件**用于 install.sh 一键装：

| Step | 操作 |
|---|---|
| 10.1 | 写 `templates/com.jp-trainer.daily.plist.tmpl`（带 `__BIN_PATH__` / `__HOUR__` / `__MINUTE__` placeholder） |
| 10.2 | install.sh 调 `jp install-cron`（已有逻辑），不重新发明轮子 |
| 10.3 | 写 `jp install-cron --uninstall` 选项移除 plist |
| 10.4 | 写 `jp daily-push --dry-run` 用于测试不真发通知 |

**估时**：1 小时。
**可延后**：phase 2 加 Linux systemd timer 支持。

### Task 11: Codex / Gemini 适配（**优先级 P1**）

| Step | 文件 | 内容 |
|---|---|---|
| 11.1 | `codex/AGENTS.snippet.md` | design.md §9.1 内容（~30 行） |
| 11.2 | `gemini/GEMINI.snippet.md` | design.md §9.2 内容 |
| 11.3 | install.sh 检测 `~/.codex/AGENTS.md` 存在则提示用户手动 append（**不自动改**，避免污染用户配置） |
| 11.4 | README §3 Cross-tool setup 章节解释 hooks 仅 Claude，Codex/Gemini 走 manual `/jp` |

**依赖**：Task 7。
**估时**：1-2 小时。

### Task 12: install.sh + bun build（**优先级 P0**）

| Step | 操作 |
|---|---|
| 12.1 | 写 `install.sh` 13 步流程（design §11） |
| 12.2 | 写 `scripts/install-hooks.mjs`（D5 决策的 node script，~150 行） |
| 12.3 | 写 `install.sh --uninstall`（卸载 + 备份恢复） |
| 12.4 | 写 smoke test 段（5 命令）：`jp config --show` / `jp seed-import` / `jp next --json` / `jp stats` / 模拟 stop hook stdin |
| 12.5 | 在干净 macOS 测试机或 fresh `~/.claude/settings.json={}` 跑一次 install + smoke |
| 12.6 | 写 `tests/integration/install.test.ts` 测 hooks merge 幂等 |

**依赖**：Task 6-11 全完成。
**估时**：3-4 小时。

### Task 13: README + e2e demo（**优先级 P0，最后做**）

| Step | 文件 | 内容 |
|---|---|---|
| 13.1 | `README.md` | Why / Architecture 图（design §2）/ 一键安装 / e2e demo / 卸载 / FAQ |
| 13.2 | `docs/demo.md` | screenshot + 终端输出节选 5 步 e2e |
| 13.3 | `docs/CHANGELOG.md` | v0.1.0 features list |
| 13.4 | 录制（可选）一段 30 秒 asciinema demo |
| 13.5 | tag v0.1.0 |

**依赖**：Task 12 通过。
**估时**：2-3 小时。

### 任务依赖图

```
Task 6 (seeds) ──┐
                 ├─→ Task 7 (skills) ──┐
                 │                     │
                 └─→ Task 8 (hooks) ──┴─→ Task 9 (immersion wire-in)
                                       │
Task 5 (CLI) (done) ──→ Task 10 (cron) ┤
                                       ├─→ Task 11 (Codex/Gemini)
                                       │
                                       └─→ Task 12 (install.sh) ─→ Task 13 (README + e2e)
```

**总估时（不含 N2 语法 user review）**：18-26 小时 dev work。

---

## 7. 风险清单

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| Stop hook 烦人到关闭 | H | H | inject_max_per_hour=3 + dnd 命令 + 默认改 0.10 + 日志事后调参 | Executor §6 |
| Cross-tool 写冲突 | L | H | busy_timeout=5000 + 事务包 recordAnswer + 重试 + 每日 .backup cron | Executor §4 |
| install.sh 失败 | M | M | 备份 + 幂等 + smoke test + --uninstall | Executor §12 |
| bun build 在 macOS 26 codesign 阻挡 | L | M | install.sh 检测失败 fallback 到 `bun run src/cli.ts` 跑解释模式（性能稍差但能跑） | Executor §12 |
| N2 语法 LLM 生成质量差 | M | M | user 抽样 review 10%，错则重生；上线 phase 1 不依赖此（先 vocab） | Planner §6.6.3 |
| 题面 LLM 生成不稳定（同一 concept_id 题型乱跳） | M | L | skill prompt 模板固化「用 concept.id hash 做题型轮换种子」 | Executor §7 |
| jonchang/jlpt-vocab 数据 schema 变 | L | L | import script 写 schema 校验 + 失败 fallback 旧本地缓存 | Executor §6.2 |
| 用户在团队 PR 写日语污染（沉浸模式 leak） | L | H | 沉浸模式 prompt 明示「commit message / PR 仍用英文/中文」 | Planner §1 |
| FSRS 参数不适合中文母语者学日语 | M | M | profile 暴露 fsrs.maximum_interval / 后续支持 fsrs.parameters 调优 | Phase 2 |
| launchd plist macOS 13+ 警告 | L | L | install.sh 输出兼容提示，不阻塞 | Executor §10 |

---

## 8. ADR Draft（待 Architect/Critic 共识后定稿）

### ADR-001: jp-trainer 整体架构

**Decision**: 采用 CLI 引擎 + Skills 命令入口 + Hooks 自动触发的三层寄生架构，跨 Claude/Codex/Gemini 共享 SQLite reviews.db 单一真相，FSRS-5 排期，concept 静态 + 题面 LLM 生成（混合模式）。

**Drivers**:
1. 零摩擦（不打断工作流）
2. Cross-tool 一致性（错题本同步）
3. N2 通过率（题量覆盖）

**Alternatives considered**:
- 纯 Anki / Duolingo（独立 app）→ 切上下文成本高，被设计拒
- 纯 LLM 生成无种子 → FSRS 排期不稳，被 D1 拒
- 纯静态题面 → 题型枯燥 + 维护重，被 D1 拒
- daemon 进程同步 db → 增加生命周期复杂度，被 D7 拒
- 直接覆盖 settings.json → 用户配置丢失，被 D5 拒

**Why chosen**:
- CLI 引擎保证离线确定性（review/stats 不依赖 LLM）
- Skill + Hook 两套入口覆盖「主动训练」+「被动注入」全场景
- SQLite WAL + busy_timeout 是 cross-process 写并发的最简方案
- 混合模式让 concept 复用同时题面多样
- Hook 限流 + dnd 命令是 Stop hook scenarios 1 的硬保险

**Consequences**:
- ✓ Bun 单二进制启动 <50ms 适合高频 hook
- ✓ 错题本是 user-owned data，删 ~/.config/jp-trainer 完全卸载
- ✓ N2 语法 LLM 一次性生成可控
- ✗ Hook 仅 Claude Code 有，Codex/Gemini 必须手动 `/jp` 触发
- ✗ macOS 限定（launchd），Linux/Windows phase 2
- ✗ 跨设备同步需 phase 3 iCloud / git-managed db

**Follow-ups**:
- Phase 1.1: N2 语法 user review 完毕入库
- Phase 2: 听力（macOS say）/ Telegram 通知 / dashboard / Linux systemd
- Phase 3: 移动端 / iCloud 同步
- 持续: log 分析 + inject_rate 默认值调优 + FSRS 参数化

---

## 9. 下一步交接

1. Planner 输出本文件 → Architect review（关注：D5/D7 技术可行性、hook schema 准确性）
2. Architect 修订 → Critic review（关注：风险清单完整性、scenarios 实际性）
3. Critic 修订 → Executor 按 §6 顺序落地（建议串行 6→7→8→9→10→11→12→13）
4. 每完成一个 task，verify 命令通过 + 单测绿才进下一个
5. Task 13 收尾后 v0.1.0 tag + 用户实测 1 周 + 数据回收（log 分析） → phase 1.1 调参

---

## 10. Open Questions（留给后续阶段）

- [ ] inject_max_per_hour 默认值：3 还是 5？需 1 周实测数据
- [ ] N2 语法 LLM 生成的 prompt 模板要不要给具体语法书参考（如「新完全マスター」格式）
- [ ] PostToolUse hook 的「tool 失败 skip」如何检测：read tool_response.success 字段？需查 Claude Code hooks API 文档
- [ ] sessions/<sessionId>/inject-count.json 跨 session 清理机制：每天 00:00 清？install-cron 加一条 daily cleanup？
- [ ] Codex/Gemini 共享 db 的 stats 查询：是否做一个 `jp daily-summary --json` 给 Codex 主动 query？
- [ ] iOS phase 3 是 Flutter 还是 SwiftUI？决定 db 是否需要 iCloud-friendly 的 file format

