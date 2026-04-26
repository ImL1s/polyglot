# polyglot RALPLAN-DR — Planner v4 (Final)

> Date: 2026-04-27
> Mode: **DELIBERATE** (v3 + Critic 12 Required Revisions = final plan for Executor)
> Scope: v3 全量 + Critic v3 12 项 fix 全落实
> 前置：`docs/ralplan-planner-v{1,2,3}.md` + `docs/ralplan-architect-v{1,3}.md` + `docs/ralplan-critic-v3.md` + 已实现代码 src/*.ts
> Owner: Planner phase（不写代码，只规划）
> Status: **待 Architect v4 + Critic v4 APPROVE 后进 Executor**

---

## 0. v4 增量摘要

v4 = v3 plan + Critic 12 项 Required Revisions **逐项落地**，无新决策。关键变更：(1) Phase 1.4 → Phase 1.1b（D19 ambient 紧跟多语言，利用 graceful skip 不需要等 mastered pool 积累）(2) immersion_level 0.50 档重定义为「双语句法混合」(3) Task 14 加 paths.ts CONFIG_DIR 双路径迁移（CRITICAL fix）(4) Task 5.5 加 daily backup（CRITICAL fix）(5) 新增 Task 26 ambient 效果验证 + Task 27 `lt doctor` (6) Phase 1.0 估时修正 22-31h，总估时 55-77h。

---

## 1. Principles（9 条，v3 不变）

1. **依附工作流不打断（v1）**：训练寄生在 user 已有间隙；Stop hook 限流 + DND 是硬保险。
2. **错题本 = 单一真相，但「自动注入」只有 Claude Code（v1 Adjustment B）**：`reviews.db` 跨 tool 共享读写；只有 Claude Code 有 hook 自动塞题 + ambient mix；Codex/Gemini 走 manual `/lt`。
3. **CLI 是核心引擎，LLM 是渲染 + 评分层但评分要 rubric-anchored（v1 + Adjustment E）**：rubric 按 `(language, type)` 查表。
4. **概率触发 + 工作时间感知 + 限流（v1 + Adjustment F）**：inject_max_per_hour=3 / per_session=10 / DND 硬上限。
5. **失败安全 + 可一键关闭 + 可观测（v1 + Adjustment C）**：NDJSON log + `lt uninstall-hooks` + `lt logs` 过滤。
6. **跨语言可扩展但单 active（v2）**：active_language 控制当下学哪门；FSRS 排期 lang-scoped。
7. **TTS 多 backend 抽象 + 默认零依赖（v2）**：macOS `say` 默认 + edge-tts 备选 + none fallback。
8. **讲解是 second-pass 教学不是 first-pass 评分（v2）**：rating ≤ 2 自动 verbose + `/lt explain` 显式命令。
9. **被动暴露优先于主动测验（v3）**：ambient mix 是 24/7 背景信号；mix 让 Claude 说话不顺畅 → 关掉 → 项目失败。mix_rate 默认保守 + 只夹带已知词 + 代码场景关。

---

## 2. Decision Drivers（5 条，v3 不变）

1. **零摩擦（最高）**：ambient mix 让 Claude 说话变怪 = 关掉 = 项目失败。
2. **Cross-tool 一致性**：ambient 暴露日志写 db，所有 tool 可查。
3. **跨语言可扩展性**：mix 词汇来源 = active_language 已掌握概念。
4. **目标语言通过率**：ambient 提供长期被动记忆强化。
5. **长期记忆通过被动暴露**：incidental vocabulary acquisition（≥ 7 次暴露 → 长期记忆概率显著提升）；此 driver 在 driver 1 之下。

> 次优 driver（ties 时）：可调试性 > 安装鲁棒性 > 性能。

---

## 3. D1-D8 沿用结论

D1-C 混合已实现；D2 0.10 默认 + 限流；D3-B dispatch；D4 3000 双 phase；D5 Adj-A schema-aware；D6 与 D19 合并为统一谱系（见 §4 D19-0）；D7 WAL + 事务 Adj-C；D8-C LLM 生成。Architect v1 5 adjustments（A-E）+ 可选 F 全部纳入。

---

## 4. Decisions D9-D19

### D9-D18：沿用 v2/v3 决策（简引）

- **D9**：重命名 polyglot / lt CLI + jp alias 兼容 v0.2.0
- **D10**：CLI 名 `lt`（2 字母）
- **D11**：单 SQLite + language 字段 + FSRS 按 active_language 隔离
- **D12**：Profile per_language nested + LEVEL_RANKS per-lang + profile v1→v2 自动 migration
- **D13**：macOS `say` 默认 + multi-backend abstraction（tts_engine = macos|edge|none）
- **D14**：TTS 答题后念 + listen mode + say 命令 + 各触发 profile 可控
- **D15**：听力 drill 复用 vocab/grammar concept + listening_drill_rate profile 开关
- **D16**：`/lt explain` + rating ≤ 2 verbose + token 预算硬约束 + attempts.llm_feedback 缓存
- **D17**：Hook active_language only + detect-native 重命名 + immersion flag per-language
- **D18**：已实现代码增量 patch list（完整 tradeoffs 见 v2 plan §4）

### D19. Ambient Mix-Language（v3 + Critic v3 fixes）

#### D19-0. D6 沉浸 vs D19 ambient 关系：**合并为统一谱系**

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 独立并行（D6 flag + D19 flag 各自触发） | 逻辑简单 | 用户同时开两个效果叠加不可预测（mix=0.2 + 沉浸=全日文 = 矛盾指令） | 否 |
| **B. 合并为统一谱系 immersion_level：离散 5 档** | 单一旋钮；用户心智模型清晰；hook 里只有一段 prompt 按档位分支 | 杀掉 D6 的二元开关语义 | **是** |
| C. D6 是 hard override（on=全沉浸忽略 D19；off=D19 生效） | 向后兼容 | 两个变量、状态矩阵 2x(0-1) | 否 |

**推荐 B**。**【Critic v3 fix #2】离散 5 档 + 0.50 档重定义**：

| 档位 | 名称 | 行为 | 命令 |
|---|---|---|---|
| 0 | off | 不注入任何语言指令 | `lt mix 0` / `lt immersion off` |
| 0.10 | 偶尔点缀 | ≤ 1 词 / 回复，括号注中文 | `lt mix 10` |
| 0.25 | 常见词替换 | ≤ 3 词 / 回复，括号注中文 | `lt mix 25` |
| **0.50** | **双语句法混合** | **短句尾以整句目标语言呈现 + 中文翻译紧随**（例："这个 bug 修好了。このバグは直りました。"）— 介于词替换与全沉浸的中间态 | `lt mix 50` |
| 1.00 | 全沉浸 | 全目标语言 + 假名 + 中文译文附后（原 D6） | `lt mix 100` / `lt immersion on` |

- `lt mix <N>` 只接受 0/10/25/50/100 五个值
- `lt mix 35` → stderr 报错："请用 0/10/25/50/100，或 `lt mix --custom 35`（不推荐：行为与档位 25 接近）"
- `lt mix --custom <0-100>` escape hatch 保留（内部映射到最近档位行为）
- profile.yaml 存 float（0 / 0.10 / 0.25 / 0.50 / 1.00），hook 读取后映射到对应 prompt template

统一重命名：
- v2 `immersion.flag` 文件 → v4 `immersion_level` 字段写入 profile.yaml
- `lt immersion on` → `lt immersion 100`（兼容别名，旧 `on` = 1.0，`off` = 0）
- 旧 profile `immersion_default: true` 自动迁移为 `immersion_level: 1.0`
- 旧 `immersion.flag` 文件存在 → 自动迁移 + 删文件

**Alternative invalidation**：A 两 flag 产生 4 种状态（on+on 矛盾无定义）；C 两变量增加 hook 复杂度。

#### D19a. 实现机制

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. UserPromptSubmit hook 注入 system 指令（无词汇清单） | 简单 | LLM 自由选词不可控 | 否 |
| B. profile.yaml 写死 | 零代码 | 改 yaml 不够快 | 否 |
| **C. UserPromptSubmit hook 注入 + `lt mix <N>` 命令实时改 + hook 传词汇清单** | hook 注入 prompt + CLI 产出的词汇 JSON → LLM 按清单替换 | 多一次 CLI 调用（<50ms） | **是** |

**推荐 C**。**【Critic v3 fix #2】实现链路扩展为四分支**：

```
用户发 prompt → UserPromptSubmit hook
  ↓ 读 profile.immersion_level
  ↓ = 0 → 不注入
  ↓ = 1.00 → 全沉浸 prompt（原 D6 逻辑：全目标语言 + 假名 + 中文译文附后）
  ↓ = 0.50 → 双语句法混合 prompt：
    ↓ 检测 looksLikeCodeContext → 是 → 不注入
    ↓ 调 lt mix-vocab --limit 15 --json
    ↓ 注入 additionalContext：
      "[双语句法] 在回复中，将部分短句尾以 {active_language} 整句呈现，
       中文翻译紧随其后。例：'这个 bug 修好了。このバグは直りました。（这个 bug 修好了。）'
       可替换词汇范围限于以下清单：{mix_vocab_json}
       不替换代码/变量名/命令名/文件路径。"
  ↓ = 0.10 / 0.25 → ambient mix prompt：
    ↓ 检测 looksLikeCodeContext → 是 → 不注入
    ↓ 调 lt mix-vocab --limit 15 --json
    ↓ 计算 max_replace = 档位映射（0.10→1, 0.25→3）
    ↓ 注入 additionalContext：
      "[Ambient 语言混入] 在回复中将至多 {max_replace} 个可替换中文词汇
       自然替换为目标语言（{active_language}）。替换范围限于以下清单：
       {mix_vocab_json}
       替换后在词旁括号标注中文对照，如：バグ（bug）。
       不替换代码/变量名/命令名/文件路径。
       不影响语义准确性。如果替换后造成理解困难，跳过。"
    ↓ 记录本次注入词汇到 NDJSON log（含 prompt_version 字段）
```

#### D19b. 词汇来源：**80% 已掌握 + 20% 弱项**

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. LLM 自由选词 | 无 CLI 调用 | 不可控 | 否 |
| B. 只限已掌握词（stability ≥ 7d 且 state=Review） | 100% 读得懂 | 初期 pool 太小（前两周可能只有 20 词） | 中 |
| C. 只限弱项词（rating ≤ 2） | 强迫接触 | 挫败感 | 否 |
| **D. 混合 80% 已掌握 + 20% 弱项** | 既巩固已知又小剂量挑战 | 弱项词可能看不懂 | **是** |

**推荐 D**。教育学依据：Krashen i+1（95-98% 已知 + 2-5% 未知 = 最佳习得窗口）；80/20 落在此范围。

`lt mix-vocab --limit 15 --json` 内部逻辑：
```
pool_mastered = SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
  WHERE c.language = :active_language AND r.state = 2 AND r.stability >= 7*24*3600*1000
  ORDER BY RANDOM() LIMIT 12;

pool_weak = SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
  WHERE c.language = :active_language AND (r.state IN (1, 3) OR r.stability < 7*24*3600*1000) AND r.lapses > 0
  ORDER BY RANDOM() LIMIT 3;

→ UNION ALL → shuffle → JSON [{id, ja, zh, reading}, ...]
```

mastered 不足 12 → 全量填不硬凑 weak。空 pool → hook 不注入 ambient prompt（graceful degrade）+ log `{event:"ambient_skip", reason:"empty_pool"}`。

**Alternative invalidation**：A 不可控；B 纯 i+0 不进步；C 挫败感。

#### D19c. 代码上下文白名单（与 D6 统一）

所有 immersion_level > 0 场景，`looksLikeCodeContext(userMessage)` 为 true 时：
- 1.00（全沉浸）：当次 turn 切回中文
- 0.10/0.25/0.50（ambient/双语句法）：当次 turn 不注入 mix prompt

```typescript
function looksLikeCodeContext(s: string): boolean {
  return /```|^import |\.dart\b|\.ts\b|\.tsx\b|\.py\b|\.go\b|\.rs\b|\bclass \w+|\bfunction \w+|\bconst \w+\s*=|\bdef \w+|\bfn \w+/.test(s);
}
```

#### D19d. FSRS 交互：**不计入 FSRS + 独立 ambient_exposures 表**

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. 不计入 FSRS + 独立暴露计数表** | 不污染 FSRS 信号 | 被动暴露数据独立查 | **是** |
| B. silent passive review（update last_review） | 有复习痕迹 | 干扰 elapsed_days | 否 |
| C. rating=3 passive | 最大化利用 | 严重污染信号 | 否 |

新增 `ambient_exposures` 表：
```sql
CREATE TABLE IF NOT EXISTS ambient_exposures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id   TEXT NOT NULL REFERENCES concepts(id),
  source       TEXT NOT NULL DEFAULT 'mix',
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ambient_concept ON ambient_exposures(concept_id, created_at DESC);
```

**【Critic v3 fix #3 / Adjustment G】** 新增 `ambient_exposures_archive` 表：
```sql
CREATE TABLE IF NOT EXISTS ambient_exposures_archive (
  concept_id      TEXT NOT NULL,
  cumulative_count INTEGER NOT NULL,
  archived_at     INTEGER NOT NULL,
  PRIMARY KEY (concept_id, archived_at)
);
```

`lt ambient-clean [--keep-days 90]`：
- 90 天前的 ambient_exposures → 按 concept_id GROUP BY → INSERT INTO ambient_exposures_archive (cumulative_count) ON CONFLICT 累加 → DELETE 原行
- `lt stats --ambient` 查询合并 ambient_exposures + ambient_exposures_archive
- `daily-push` 检测 ambient_exposures.count > 100K → 推送 "建议运行 `lt ambient-clean`"

**Alternative invalidation**：B 干扰 elapsed_days；C 严重污染 FSRS。

#### D19e. 进度可见性：**stats --ambient + 周五 cron**

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. `lt stats --ambient`** | 按需查 | 需主动 | **是** |
| **B. 周五 cron 推送** | 被动可见 | cron 复杂度 | **是（叠加 A）** |
| C. 不做 | 安静 | 用户不知效果 → 关掉 | 否 |

`lt stats --ambient` 输出：
- 本周混入 N 次、覆盖 M 个已学概念、前 5 高频词
- **诊断行（Critic Independent #4 fix）**：当 exposure_count=0 → "本周 0 次暴露 — 原因：mastered 词库 N=X < 12（积累中），或 mix=0（已关闭）"
- 周五 cron 推送一行

#### D19f. 任务类型调节：**二挡**

代码上下文 → mix=0 / 非代码 → 用 profile.immersion_level。不做三挡精细检测。

#### D19g. 默认值：**10% 启动 + 手动调节**

- 默认 `immersion_level=0.10`（档位 1：偶尔点缀）
- `lt mix 25` 随时调
- `/lt-setup` onboarding 新增一问："ambient 语言混入强度？0=关 / 10=偶尔点缀（推荐） / 25=常见词替换 / 50=双语句法 / 100=全沉浸"
- **【Critic Independent #4 fix】** onboarding 附注："前 21 天可能因词汇库未积累而暴露较少，`lt stats --ambient` 可查实际频次"
- 不做自动加压

---

## 5. D18 Updated：已实现代码迁移路径（v4 增量 patch）

**【Critic fix #12】声明：以下 v3/v4 增量在 v2 §4 D18 已含 Adjustment A-F 字段（version 2 + active_language + per_language + inject_max_per_hour + inject_max_per_session + do_not_disturb_until + tts_engine + tts_voice_overrides + tts_on_* 等）基础上叠加；v2 字段不重复列出。Executor 落地 profile.ts 时必须同时包含 v2 D18 表全部字段。**

v4 增量 patch（在 v2 D18 + v3 §5 基础上追加）：

| 文件 | 改动 | Why |
|---|---|---|
| `src/profile.ts` | Profile 接口加 `immersion_level: number` 替代 boolean `immersion_default`；老 `immersion_default: true` 自动迁移为 `immersion_level: 1.0`；加 `mix_mastered_ratio: number`（默认 0.8） | D19-0 合并 + D19b |
| **`src/paths.ts`** | **【Critic fix #1 CRITICAL】** CONFIG_DIR 优先读 `~/.config/polyglot/`，fallback `~/.config/jp-trainer/`；首次启动检测老路径存在 → `mv` 全目录到新路径 + 留 symlink + 写 NDJSON `{event:"config_dir_migrated"}`；LOG_FILE 从 `jp.log` 改 `lt.log` | Independent #6 |
| `src/db.ts` | migrate v3: 新增 `ambient_exposures` 表 + 索引 + `ambient_exposures_archive` 表（含 PK `(concept_id, archived_at)`）（用 user_version 3） | D19d + Adj-G |
| **新增** `src/ambient.ts` | `getMixVocab(lang, limit, masteredRatio)` → 拉 mastered + weak pool → shuffle → JSON；`logAmbientExposures(conceptIds)` → 批量 INSERT；**`cleanOldExposures(beforeMs)` + `archiveExposures(beforeMs)`** → 归档 + DELETE | D19b/D19d/Adj-G |
| `src/cli.ts` | 新增 `mix-vocab` / `mix <N>` / `ambient-log` / **`ambient-clean [--keep-days 90]`** / **`doctor`** / **`restore --from <date>`** 子命令 | D19a/Adj-G/fix #3/#8 |
| `src/cli.ts` | `immersion` 子命令改为：`lt immersion <0/10/25/50/100|on|off|status>`，on=100, off=0 | D19-0 |
| `src/cli.ts` | `lt mix <N>` 只接受 0/10/25/50/100；其他值报错 + 建议用 `--custom` | Critic fix #2 |
| `src/concepts.ts` | `getStats()` 加 ambient_exposures 统计 + 诊断行 | D19e + Critic #4 |
| `src/paths.ts` | 移除 `IMMERSION_FLAG`（不再用 flag 文件，改 profile 字段） | D19-0 |
| **新增** `scripts/daily-backup.sh` | `reviews.db.bak.<7-day-rolling>` 备份 + `ambient_exposures` 含在内 | Critic fix #2 CRITICAL |
| `hooks/user-prompt-submit.ts` | immersion 分支改为四路（=0 / 0.10\|0.25 ambient / 0.50 双语句法 / 1.0 全沉浸） | D19a + Critic fix #2 |
| **新增** skill `/lt-mix` | thin wrapper + frontmatter `prompt_version: v1` + `prompt_max_tokens: 250` | D19g + Adj-I |
| **新增** `scripts/check-prompt-version.ts` | git pre-commit hook：检测 hooks/user-prompt-submit.ts prompt template hash 与 skills/lt-mix.skill.md prompt_version 一致性 | Adj-I |
| `tests/` | 新增 `ambient.test.ts` / `immersion-level.test.ts` / `ambient-stats.test.ts` / `code-context-detect.test.ts` / **`paths-migration.test.ts`** / **`ambient-clean.test.ts`** / **`immersion-050.test.ts`（0.50 档 prompt template 输出）** | D19 + Critic fixes |

---

## 6. Pre-mortem（7 scenarios，v3 不变）

### Scenario 1: Stop hook 烦人到关闭（v1, L=H I=H）
参见 v1 §4.1 + Adj-D shell pre-gate + Adj-F 限流。TTS 默认 stop hook off。

### Scenario 2: Cross-tool 写冲突（v1, L=L I=H）
参见 v1 §4.2 + Adj-C transaction + busy_timeout=5000 + **daily backup（Critic fix #2 CRITICAL 落地）**。

### Scenario 3: 设计复杂跑不起来（v1, L=M I=M）
参见 v1 §4.3 + **paths.ts 双路径迁移（Critic fix #1 CRITICAL 落地）** + `lt doctor` 检测冲突。

### Scenario 4: TTS Linux 哑火（v2, L=M I=M）
参见 v2/v3 §6.4。

### Scenario 5: 多语言切换 + token 预算爆（v2, L=M I=M）
参见 v2/v3 §6.5。

### Scenario 6: Ambient mix 让 Claude 说话不顺畅（v3, L=H I=H）

**症状**：LLM 被 mix 指令干扰后回答变得语义混乱/长度膨胀/错误。

**Mitigation**：
1. prompt 用绝对数量上限而非百分比（0.10→≤1, 0.25→≤3, 0.50→双语句法, 1.0→全沉浸）
2. 替换只在句末/括号补充（0.10/0.25 档）或短句尾整句呈现（0.50 档），不句中强插
3. 长回复自动减量（prompt 写明 >500 字减少混入）
4. `lt mix 0` 一行关
5. 首周 log 审计 + prompt_version 字段追踪（Adj-I）
6. few-shot one-shot 示例提高 LLM 遵守度

### Scenario 7: LLM 无法精确控制替换比例（v3, L=M I=M）

**Mitigation**：
1. 绝对数量上限（已覆盖 Scenario 6 #1）
2. hook prompt 含 one-shot 示例
3. `lt stats --ambient --accuracy` 事后偏差率统计（Phase 1.1b dogfood 审计）
4. prompt 用「至多 N 个」fail-safe 方向是少不是多

---

## 7. Test Plan（v3 全量 + Critic fixes 新增）

### 7.1 Unit

v2 + v3 unit tests 全部保留。v4 新增：

| 测试 | 关键 case | 来源 |
|---|---|---|
| `tests/ambient.test.ts` | mastered=12 weak=3 pool 分配 / 空 pool → [] / mastered 不足 → 全填不硬凑 | D19b |
| `tests/immersion-level.test.ts` | level=0 无注入 / 0.10 → ≤1 / 0.25 → ≤3 / 旧 flag 迁移 | D19-0 |
| **`tests/immersion-050.test.ts`** | **level=0.50 → prompt template 输出含「双语句法」指令 + 示例格式** | **Critic fix #2** |
| `tests/ambient-stats.test.ts` | 插 20 行 → getStats --ambient 正确 | D19e |
| `tests/code-context-detect.test.ts` | py/go/rs 后缀 + import/class/function/const/def/fn | D19c |
| **`tests/paths-migration.test.ts`** | **老路径 ~/.config/jp-trainer 存在 → 自动 mv → 新路径 ~/.config/polyglot → 老路径变 symlink** | **Critic fix #1** |
| **`tests/ambient-clean.test.ts`** | **插 200K 行 → clean --keep-days 90 → 旧行归档到 archive 表（PK 不 collision） + 新行保留 + stats 查询合并正确** | **Critic fix #3** |

### 7.2 Integration

v2 + v3 integration tests 全部保留。v4 新增：

| 测试 | 流程 | 来源 |
|---|---|---|
| user-prompt-submit ambient full path | level=0.10 + 20 mastered → hook 输出含 mix 词汇 JSON + ≤1 上限 | D19a |
| user-prompt-submit 0.50 full path | level=0.50 + 20 mastered → hook 输出含「双语句法」prompt | Critic fix #2 |
| ambient + code context skip | level=0.25 + ``` → 无 mix 指令 | D19c |
| ambient-log batch write | `lt ambient-log --concepts id1,id2,id3` → 3 行 | D19d |
| immersion_level migration | 旧 flag 存在 → readProfile → 1.0 → flag 删 | D19-0 |
| lt mix cycle | mix 25 → hook 读新值 → mix 0 → 不注入 | D19g |
| **paths migration** | **老 CONFIG_DIR 存在 → 首次 getDb() → mv + symlink → NDJSON logged** | **Critic fix #1** |
| **install project-level conflict** | **cwd 有 .claude/settings.json 含 lt hook → install 检测 + 报告** | **Critic fix #8** |
| **daily backup + restore** | **reviews.db 有数据 → daily-backup.sh → .bak 存在 → lt restore → db 恢复** | **Critic fix #2** |
| **lt doctor** | **~/.claude + cwd/.claude 都有 lt hook → doctor 报告重复** | **Critic fix #8** |

### 7.3 E2E（手动步骤）

v2 + v3 步骤全保留（1-13）。v4 无新增手动步骤（Critic fixes 由 integration test 覆盖）。

### 7.4 Observability

v3 NDJSON 事件全保留。v4 新增：

```jsonc
{"ts":"...", "event":"config_dir_migrated", "from":"~/.config/jp-trainer", "to":"~/.config/polyglot"}
{"ts":"...", "event":"ambient_inject", "immersion_level":0.25, "suggested_max":3, "vocab_count":15, "prompt_version":"v1", ...}
{"ts":"...", "event":"ambient_cleaned", "deleted":45000, "archived_concepts":230, "kept":5000}
{"ts":"...", "event":"daily_backup", "file":"reviews.db.bak.20260427", "size_bytes":1234567}
{"ts":"...", "event":"doctor_check", "global_hooks":2, "project_hooks":1, "duplicates":["Stop:polyglot-hooks/stop.sh"]}
```

### 7.5 Mock 测验 + Ambient 效果度量

- `/lt mock-test` 30 题 hold-out pool
- mock-test report 加一维：ambient 暴露 ≥ 7 次组 vs < 7 次 → 答对率对比
- **【Critic fix #5 / Adj-K1】Task 26**：Phase 1.1b 落地后 30 天每周跑 mock-test → `lt ambient-validate` binomial test (p<0.05) → ADR-005 confirmed/deprecated

---

## 8. 任务表（25 + 2 = 27 任务）

**任务 1-5 已完成。** 以下是 5.5 起的完整任务表。

| Task | 内容 | Phase | 优先级 | 依赖 |
|---|---|---|---|---|
| **5.5** | **数据完整性 hardening**：(a) srs.ts:69 recordAnswer 事务化 db.transaction (b) db.ts busy_timeout=5000 + synchronous=NORMAL + wal_autocheckpoint=1000 (c) hooks/lib/common.ts safeFail() NDJSON (d) **【Critic fix #2 CRITICAL】** `scripts/daily-backup.sh` 写 `reviews.db.bak.<7-day-rolling>` + install.sh 注册 launchd 凌晨 2 点 (e) `lt restore --from <date>` 恢复命令 | **1.0** | **P0** | 5 |
| 6 | 种子题库 import（ja：jonchang N5-N2 vocab + LLM N2 grammar 100-150 条） | 1.0 | P0 | 5.5 |
| 7 | 5 个 skill markdown（含 Adj-E rubric per type） | 1.0 | P0 | 6 |
| 8 | 3 个 hook（含 Adj-D shell pre-gate + Adj-F profile 字段使用） | 1.0 | P0 | 6, 7 |
| 9 | 沉浸模式 + 关键词反问接线（fold 进 Task 8.3 UserPromptSubmit） | 1.0 | P1 | 8 |
| 10 | launchd plist 模板 | 1.0 | P2 | 8 |
| 11 | Codex/Gemini snippet（Adj-B honest framing） | 1.0 | P1 | 7 |
| 12 | install.sh + bun build（Adj-A schema-aware merge）+ **【Critic fix #8】substep 12.7：检测 cwd `.claude/settings.json` 扫描 'jp-trainer-hooks' / 'polyglot-hooks' / 'lt-' substring 提示用户审慎** | 1.0 | P0 | 6-11 |
| 13 | README + e2e demo | 1.0 | P0 | 12 |
| 14 | 项目重命名 polyglot/lt + jp alias + **【Critic fix #1 CRITICAL】`src/paths.ts` CONFIG_DIR 双路径（优先 `~/.config/polyglot/` fallback `~/.config/jp-trainer/`）+ 首次启动 mv + symlink + NDJSON logged + LOG_FILE `jp.log` → `lt.log` + `tests/paths-migration.test.ts`** | 1.0 | P0 | 12 |
| 15 | 多语言 schema migration + lang.ts（D11/D12/D18：profile v1→v2 migration + db v2 concepts.language + LEVEL_RANKS） | 1.1a | P0 | 14 |
| 16 | 多语言 seeds 韩语（TOPIK） | 1.1a | P1 | 15 |
| 17 | 多语言 hook 适配（D17：UserPromptSubmit active_language + detect-native） | 1.1a | P1 | 15 |
| **23** | **【Critic fix #1 / Adj-J Phase 重排】D19-0 合并 + immersion_level 谱系**：profile.immersion_level 替代 boolean + flag 文件迁移 + `lt immersion <N>` + `lt mix <N>`（5 档 + --custom）+ UserPromptSubmit hook **四分支**处理（=0 / 0.10\|0.25 ambient / 0.50 双语句法 / 1.0 全沉浸）+ **`tests/immersion-050.test.ts` 覆盖 0.50 档 prompt** | **1.1b** | **P0** | 17 |
| **24** | **D19b+d ambient 词汇引擎 + 暴露日志 + 【Critic fix #3 / Adj-G】retention/cleanup**：src/ambient.ts（getMixVocab + logAmbientExposures + **cleanOldExposures + archiveExposures**）+ db v3 ambient_exposures 表 + **ambient_exposures_archive 表（PK: concept_id, archived_at）** + `lt mix-vocab` + `lt ambient-log` + **`lt ambient-clean [--keep-days 90]`** CLI + daily-push 检测 >100K 提示 + **`tests/ambient-clean.test.ts`（200K 行归档测试）** | **1.1b** | **P0** | 23 |
| **25** | **D19e+g ambient 可见性 + onboarding + 【Critic fix #4 / Adj-I】prompt 版本化**：`lt stats --ambient`（含诊断行）+ cron 周五推送 + `/lt-setup` 新增 mix 问题（含前 21 天注释）+ `/lt-mix` skill（**frontmatter `prompt_version: v1` + `prompt_max_tokens: 250`**）+ **`scripts/check-prompt-version.ts` pre-commit hook** + **NDJSON `ambient_inject` event 加 `prompt_version` 字段** | **1.1b** | **P1** | 24 |
| **26 (NEW)** | **【Critic fix #5 / Adj-K1】ambient 效果验证**：Phase 1.1b 落地后 30 天每周跑 mock-test 30 题 + cron 自动统计 + `lt ambient-validate` binomial test (p<0.05) → ADR-005 confirmed/deprecated | **1.1b dogfood** | **P1** | 25 |
| **27 (NEW)** | **【Critic fix #8】`lt doctor` 命令**：扫描 `~/.claude/settings.json` + cwd `.claude/settings.json` 检测 lt hook 重复并报告 + TTS backend 诊断 + profile 版本检测 + active_language vs immersion flag 一致性 | **1.0** | **P0** | 12 |
| 18 | TTS macOS backend（D13/D14） | 1.2 | P1 | 15 |
| 19 | 听力 `/lt listen`（D15） | 1.2 | P1 | 18 |
| 20 | 讲解 `/lt explain` + verbose（D16） | 1.3 | P1 | 19 |
| 21 | TTS edge-tts Linux fallback（D13） | 1.3 | P2 | 20 |
| 22 | mock-test（Architect Risk #7） | 1.3 | P2 | 16 |

### 任务依赖图（v4）

```
[Phase 1.0  v1 + Adjustments + Critic CRITICAL fixes]
Task 5.5 (data integrity + daily backup)
  ↓
Task 6 (seeds)
  ├─→ Task 7 (skills + rubric)
  └─→ Task 8 (hooks + shell pre-gate)
        ├─→ Task 9 (immersion wire)
        ├─→ Task 10 (cron)
        └─→ Task 11 (codex/gemini)
              ↓
        Task 12 (install + project-level conflict detect 12.7)
              ↓
        Task 13 (README e2e)
              ↓
        Task 14 (rename + paths.ts CONFIG_DIR migration)
              ↓
        Task 27 (lt doctor)

[Phase 1.1a  多语言]
Task 14 → Task 15 (schema migration)
              ├─→ Task 16 (ko seeds)
              └─→ Task 17 (multi-lang hooks)

[Phase 1.1b  Ambient Mix-Language]
Task 17 → Task 23 (immersion_level 5 档 + 四分支 hook)
              ↓
           Task 24 (ambient 词汇引擎 + 暴露日志 + cleanup/archive)
              ↓
           Task 25 (可见性 + prompt 版本化 + onboarding)
              ↓
           Task 26 (ambient 效果验证 — 30 天 dogfood)

[Phase 1.2  TTS]
Task 15 → Task 18 (TTS macOS)
              ↓
           Task 19 (listen mode)

[Phase 1.3  讲解 + Linux + mock]
Task 19 → Task 20 (explain)
              ├─→ Task 21 (edge-tts Linux)
Task 16 → Task 22 (mock-test)
```

---

## 9. Phase 划分

**【Critic fix #1 / Adj-J】4 phase 重排（不再 5 phase）**：

| Phase | 范围 | 目标 | 准入 | 估时 |
|---|---|---|---|---|
| **1.0** | Task 5.5-14, 27 | v1 完整 + 5 Adjustments + lt 改名 + paths 迁移 + daily backup + lt doctor | bun test 绿 + e2e ja 跑通 + jp alias 工作 + 老路径迁移 + lt doctor 报告 | **22-31h** |
| **1.1a** | Task 15-17 | 多语言 + 韩语 + hook 适配 | active_language=ko `/lt` 出 TOPIK 题 | 10-15h |
| **1.1b** | Task 23-26 | Ambient Mix-Language + 30 天效果验证 | `lt mix 25` → Claude 回复夹带词 + `lt stats --ambient` 可查 + 30 天后 `lt ambient-validate` 出报告 | 9-12h + 30 天 dogfood |
| **1.2** | Task 18-19 | TTS + listening | `/lt say` ja/ko 能听 + `/lt listen` 工作 | 5-7h |
| **1.3** | Task 20-22 | 讲解 + Linux + mock | `/lt explain` 5 段教学 + mock-test 30 题 | 7-10h |

**【Critic fix #9】Phase 1.0 估时 22-31h**（v1 18-26 + Adj A-F 细化 ~1h + Task 14 重命名 2-3h + Task 5.5 数据完整性+backup 1-2h）。**总估时 55-77h**（不含 Task 26 的 30 天 dogfood 等待期）。

### 为什么 D19 放 Phase 1.1b 而不再是 Phase 1.4？

**【Critic v3 fix #1 对 v3 §9 的重写】**

v3 原始 reasoning 是「mastered pool 需要 1.0-1.3 dogfood 积累 ≥ 20 个才有词可 mix」。**Critic 正确指出这与 D19b 的 graceful skip 自相矛盾**：D19b 显式设计了 "pool 不足 → hook 不注入 → log ambient_skip:empty_pool"，意味着 D19 在 mastered pool 为 0 时**不会出错，只是静默跳过**。因此 D19 不需要等 pool 积累就能安全落地。

Phase 1.1b 紧跟 Phase 1.1a 的理由：
1. **graceful skip = 安全**：mastered pool 为 0 → ambient 静默跳过 → 用户无感知 → 无负面体验（不像 TTS/讲解那样功能直接不工作）
2. **渐进上线体验**：用户第一周 mastered=0 → 不替换；第二周 mastered=5 → 偶尔 1 词；第四周 mastered=20 → 常规运作。对用户来说感觉 ambient 功能"随着学习渐渐生效" — 天然的 progressive disclosure
3. **ambient_exposures.language 语义一致**：与 Task 17 多语言 hook 同 phase 落地，ambient_exposures 表从一开始就带正确 language 字段
4. **独立回滚仍然可行**：如果 1.1b 翻车（Scenario 6），只回滚 Task 23-25，不影响 1.1a 多语言和 1.0 基础功能

**Alternative invalidation（Phase 1.4 deferred）**：推迟到 1.4 = 用户完成 1.0-1.3 全部后（约 6-8 周 + dogfood）才能体验到 ambient → v3 的核心新卖点 5 周内不可见 → 用户不知道 v3 跟 v2 有什么不同。

---

## 10. 风险清单（v3 全量 + Critic fix 更新）

### v1+v2 风险沿用

参见 v1 §7 + v2 §9（R-V1 到 R-V10）。

### v3 风险（v4 updated）

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| R-V11：Ambient mix 让 Claude 回复语义混乱 | H | H | 绝对数量上限 + 句末括号 + few-shot + 长回复减量 + `lt mix 0` + prompt_version 追踪（Adj-I） | Task 25 |
| R-V12：LLM 无法遵守替换数量 | M | M | few-shot + 「至多 N 个」fail-safe + 事后偏差统计 | Task 25 |
| R-V13：ambient pool 初期太小 | M | L | graceful skip + log + stats 诊断行 | Task 24 |
| **R-V14：ambient_exposures 表膨胀** | L | L | **【Critic fix #11】`lt ambient-clean [--keep-days 90]` + archive 表（Adj-G）+ daily-push >100K 提示**（删除 vapor 的 "lt db compact"） | **Task 24** |
| R-V15：immersion_level 合并引入向后不兼容 | M | M | 旧 flag + boolean 自动迁移 + 单测 + 文档 breaking change v0.4.0 | Task 23 |
| R-V16：ambient 暴露被视为 FSRS review | L | H | 独立表 + FSRS 三表零改动 | Task 24 |
| R-V17：cron 周五推送时 exposure=0 | L | L | 检测 0 → silent skip | Task 25 |

---

## 11. ADR Draft（v3 全量 + v4 updates）

### ADR-001 到 ADR-004：沿用 v2/v3

完整内容见 v2 §10 / v3 §11。v4 对 ADR-001 追加：
- Decision 新增：(8) UserPromptSubmit hook 四分支 + ambient mix + 独立 ambient_exposures + ambient_exposures_archive + 4 phase（非 5 phase）
- (9) paths.ts CONFIG_DIR 双路径迁移 + daily backup
- (10) lt doctor 全局/项目级 hook 重复检测

### ADR-005（v3，v4 unchanged）：Ambient Mix-Language 与沉浸模式合并

**Decision**: D6 沉浸与 D19 ambient 合并为 `immersion_level` 5 档谱系。词汇来源 80/20 mastered/weak。独立 ambient_exposures 表不计入 FSRS。LLM 替换用绝对数量上限 + 句末括号 + few-shot。90 天 retention + archive 表。**Phase 1.1b 落地（非 1.4）**。

**Drivers**: 零摩擦 > 被动暴露长期记忆 > FSRS 信号纯度。

**Alternatives invalidated**: 独立并行两 flag（冲突）/ LLM 自由选词（不可控）/ FSRS rating=3 passive（污染）/ 百分比替换（LLM 不精确）/ 自动加压（失控）/ Phase 1.4 deferred（graceful skip 矛盾 + 5 周不可见）。

**Consequences**: ✓ `lt mix 25` 一行开启 / ✓ graceful skip 安全 / ✗ LLM 不精确靠 few-shot 补偿 / ✗ mastered pool 初期不足 → 静默跳过。

**Follow-ups**: Phase 1.1b 30 天 mock-test 验证（Task 26 / K1）→ confirmed/deprecated。

---

## 12. Open Questions（v3 全量 + Critic fix #10 新增 4 条）

### v2 Open Questions 沿用
- [ ] 韩语 reading 字段语义
- [ ] TTS rate 默认值
- [ ] 讲解 LLM model 偏好
- [ ] mock-test pool 来源
- [ ] 重命名 timeline
- [ ] edge-tts 离线缓存
- [ ] listen mode 评分严格度
- [ ] 跨语言 stats 聚合 view phase
- [ ] D17 mother tongue 双向检测

### v3 Open Questions 沿用
- [ ] ambient prompt few-shot 示例数
- [ ] ambient 暴露阈值 7 次 vs 10 次
- [ ] ambient_exposures 记录提供清单 vs 实际替换
- [ ] mix_rate vs immersion_level UX 命名（profile float vs CLI int）
- [ ] Codex/Gemini 的 ambient 方案

### 【Critic fix #10】v4 新增 4 条
- [ ] **(a) Phase 3 iCloud 同步是否含 ambient_exposures 表？** INSERT 频次是 reviews 表 15 倍（每次 hook 写 ≤15 行 × 100 prompt/day = 1500 行/天），iCloud 文档 sync 频次跟得上吗？需要评估 iCloud 对 SQLite WAL 的兼容性。
- [ ] **(b) prompt_version CI 检测算法？** 当前设计用 git pre-commit hook（`scripts/check-prompt-version.ts`）检测 prompt template hash vs skill frontmatter。是否改为 bun build-time check（不依赖 git hook 装机）？pre-commit hook 在 `git commit --no-verify` 时被跳过。
- [ ] **(c) 0.50 档「双语句法混合」prompt template 具体设计** — Phase 1.1b 实测调优。初版模板："将部分短句尾以 {active_language} 整句呈现，中文翻译紧随"。需要 dogfood 3 天后根据 LLM 实际输出调整模板措辞。
- [ ] **(d) Phase 1.1b mock-N2 30 题含 production-side 题型？** 造句/翻译/作文属 productive skill，听力/阅读属 receptive。ambient 本质是 receptive exposure → 先只测 receptive？还是全题型？影响 binomial test 统计功效。

---

## 13. Final Checklist

- [x] Critic fix #1 CRITICAL：Task 14 加 paths.ts CONFIG_DIR 双路径迁移 + LOG_FILE + symlink + tests
- [x] Critic fix #2 CRITICAL：Task 5.5 加 daily backup + lt restore
- [x] Critic fix #3 / Adj-G：Task 24 加 ambient-clean + archive 表（PK）+ daily-push 100K 提示 + tests
- [x] Critic fix #4 / Adj-I：Task 25 加 prompt_version frontmatter + check-prompt-version.ts + NDJSON 字段
- [x] Critic fix #5 / Adj-K1：新增 Task 26 ambient 效果验证
- [x] Critic fix #6 Independent #6：= fix #1（paths.ts，已合并）
- [x] Critic fix #7 Independent #3：= fix #2（daily backup，已合并）
- [x] Critic fix #8 Independent #2：Task 12 加 12.7 + 新增 Task 27 lt doctor
- [x] Critic fix #9 Independent #7：Phase 1.0 估时 22-31h，总估时 55-77h
- [x] Critic fix #10：Open Questions 加 4 条（a-d）
- [x] Critic fix #11：R-V14 mitigation 引用 Adj-G lt ambient-clean（删 vapor）
- [x] Critic fix #12：D18 表顶部加声明（v2 Adj A-F 字段不重复列出）
- [x] Phase 1.4 → Phase 1.1b 重排 + §9 理由重写
- [x] D19-0 0.50 档重定义 + D19a 四分支 + tests
- [x] Principles 9 条不变
- [x] Drivers 5 条不变
- [x] D1-D8 沿用
- [x] D9-D18 沿用（D18 加声明）
- [x] D19 全决策保留 + Critic fixes 落地
- [x] Pre-mortem 7 scenarios 不变
- [x] Test plan 扩展（新增 paths-migration / ambient-clean / immersion-050 tests）
- [x] 任务表 27 任务（v3 25 + Task 26 + Task 27）
- [x] 风险 R-V14 mitigation 修正
- [x] ADR 5 个（ADR-001 追加 / ADR-005 unchanged）
- [x] Open Questions v4 新增 4 条
- [x] 已实现代码 src/*.ts 不动
- [x] 不引入新决策（纯 fix 合并）

---

## 14. 下一步交接

1. Planner v4 输出本文件 → **Architect v4 review**（关注：12 项 fix 是否全部正确落地 / Phase 1.1b 依赖图 / 0.50 档 prompt 四分支 feasibility / paths.ts 迁移 edge case）
2. Architect v4 → **Critic v4 review**（目标 APPROVE）
3. APPROVE 后 → `/team` mode 按 Phase 1.0 开工
4. Phase 1.0 准入：bun test 全绿 + e2e ja N3-N2 跑通 + jp alias 工作 + 老路径迁移测试 + lt doctor 报告 + daily backup cron 注册
