# polyglot RALPLAN-DR — Planner v3

> Date: 2026-04-27
> Mode: **DELIBERATE** (high-risk dev-first tool + v2 四项需求 + v3 新增 Ambient Mix-Language)
> Scope: v2 全量继承 + D19 Ambient Mix-Language fold-in
> 前置：`docs/ralplan-planner-v1.md` + `docs/ralplan-architect-v1.md` + `docs/ralplan-planner-v2.md` + 已实现代码 src/{cli,db,srs,concepts,profile,seeds,paths,work-hours}.ts
> Owner: Planner phase（不写代码，只规划）

---

## 0. v3 增量摘要（一段）

v2 共识：CLI 引擎 + Skills + Hooks + SQLite single-source；5 Architect adjustments（A-E）+ 可选 F；项目重命名 polyglot/lt；多语言（D9-D12）+ TTS（D13-D15）+ 讲解（D16）+ 4 phase 串行（1.0→1.1→1.2→1.3）。**v3 在 v2 基础上 fold-in D19 Ambient Mix-Language**：Claude 中文回复中按 `mix_rate`（0-1 连续）夹带目标语言词汇，实现被动浸入式学习。关键裁决：(1) D19 与 D6 沉浸模式**合并为统一谱系**（mix_rate=0 关闭 / 0.05-0.30 ambient / 1.0 全沉浸 = 原 D6）(2) 词汇来源限制为**80% 已掌握 + 20% 弱项**（D19b-D） (3) 新增 `ambient_exposures` 表记录被动暴露但**不计入 FSRS 排期**（D19d-A + passive review 统计） (4) 代码上下文自动降为 mix_rate=0（D19c + D6 白名单统一） (5) 新增 Phase 1.4 落地。所有改动仍是增量 patch，任务 1-5 代码 100% 保留。

---

## 1. Principles（v2 8 条 + v3 修订 1 条 + 新增 1 条 = 9 条）

1. **依附工作流不打断（v1，未变）**：训练寄生在 user 已有间隙；Stop hook 限流 + DND 是硬保险。
2. **错题本 = 单一真相，但「自动注入」只有 Claude Code（v1 Adjustment B 修订）**：`reviews.db` 跨 tool 共享读写；只有 Claude Code 有 hook 自动塞题 + ambient mix；Codex/Gemini 走 manual `/lt`。
3. **CLI 是核心引擎，LLM 是渲染 + 评分层但评分要 rubric-anchored（v1 + Adjustment E）**：rubric 按 `(language, type)` 查表。
4. **概率触发 + 工作时间感知 + 限流（v1 + Adjustment F）**：inject_max_per_hour=3 / per_session=10 / DND 硬上限。
5. **失败安全 + 可一键关闭 + 可观测（v1 + Adjustment C）**：NDJSON log + `lt uninstall-hooks` + `lt logs` 过滤。
6. **跨语言可扩展但单 active（v2）**：active_language 控制当下学哪门；FSRS 排期 lang-scoped。
7. **TTS 多 backend 抽象 + 默认零依赖（v2）**：macOS `say` 默认 + edge-tts 备选 + none fallback。
8. **讲解是 second-pass 教学不是 first-pass 评分（v2）**：rating ≤ 2 自动 verbose + `/lt explain` 显式命令。
9. **【v3 新增】被动暴露优先于主动测验**：ambient mix 是 24/7 背景信号，用户不需要投入注意力就在累积 exposure 频次；主动出题是刻意练习。两者互补但被动暴露的零摩擦优先级最高——如果 mix 让用户觉得 Claude 在说话不顺畅 → 关掉 → 项目失败。所以 **mix_rate 默认保守 + 只夹带已知词 + 代码场景关**。

---

## 2. Decision Drivers（v2 4 条 + v3 修订 1 条 = 5 条）

1. **零摩擦（v1，最高）**：ambient mix 如果让 Claude 说话变怪 = 关掉 = 项目失败。
2. **Cross-tool 一致性（v1）**：ambient 暴露日志写 db，所有 tool 可查。
3. **跨语言可扩展性（v2）**：mix 词汇来源 = active_language 已掌握概念。
4. **目标语言通过率（v1 driver 3 泛化）**：ambient 提供长期被动记忆强化。
5. **【v3 修订】长期记忆通过被动暴露（v3 新增 sub-driver）**：研究表明 incidental vocabulary acquisition（被动接触 > 7 次 = 长期记忆概率显著提升）；ambient mix 目标是让已知词在自然语境里不断重现。此 driver 在 driver 1 之下——绝不能为了暴露频次牺牲可读性。

> 次优 driver（ties 时）：可调试性 > 安装鲁棒性 > 性能。

---

## 3. D1-D8 沿用结论

同 v2 §3，不再赘述。D1-C 混合已实现；D2 0.10 默认 + 限流；D3-B dispatch；D4 3000 双 phase；D5 Adj-A schema-aware；D6 沉浸 + 代码白名单（**v3 在 D19 裁决中与 D6 合并，见 §4.11**）；D7 WAL + 事务 Adj-C；D8-C LLM 生成。Architect 5 adjustments（A-E）+ 可选 F 全部纳入。

---

## 4. Decisions D9-D19

### D9-D18：沿用 v2 决策（简引）

- **D9**：重命名 polyglot / lt CLI + jp alias 兼容 v0.2.0
- **D10**：CLI 名 `lt`（2 字母）
- **D11**：单 SQLite + language 字段 + FSRS 按 active_language 隔离
- **D12**：Profile per_language nested + LEVEL_RANKS per-lang + profile v1→v2 自动 migration
- **D13**：macOS `say` 默认 + multi-backend abstraction（tts_engine = macos|edge|none）
- **D14**：TTS 答题后念 + listen mode + say 命令 + 各触发 profile 可控
- **D15**：听力 drill 复用 vocab/grammar concept + listening_drill_rate profile 开关
- **D16**：`/lt explain` + rating ≤ 2 verbose + token 预算硬约束 + attempts.llm_feedback 缓存
- **D17**：Hook active_language only + detect-native 重命名 + immersion flag per-language
- **D18**：已实现代码增量 patch list（v2 §4 D18 表完整保留）

完整 tradeoffs/alternatives 见 v2 plan §4。以下仅展开 D19。

### D19. Ambient Mix-Language（v3 新增）

#### D19-0. D6 沉浸 vs D19 ambient 关系裁决

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. 独立并行（D6 flag + D19 flag 各自触发） | 逻辑简单 | 用户同时开两个效果叠加不可预测（mix=0.2 + 沉浸=全日文 = 矛盾指令）；hook 里 additionalContext 拼接冲突 | 否 |
| **B. 合并为统一谱系 immersion_level：0=关 / 0.05-0.30=ambient mix / 1.0=全沉浸（原 D6）** | 单一旋钮；0→1 连续滑动；hook 里只有一段 prompt 按 level 分支；用户心智模型清晰 | 杀掉 D6 的二元开关语义 | **是** |
| C. D6 是 hard override（on=全沉浸忽略 D19；off=D19 生效） | 向后兼容 | 两个变量、状态矩阵 2x(0-1) | 否 |

**推荐 B**。统一重命名：
- v2 `immersion.flag` 文件 → v3 `immersion_level` 字段（float 0-1）写入 profile.yaml
- `lt immersion on` → `lt immersion 1.0`（兼容别名，旧 `on` = 1.0，`off` = 0）
- `lt mix <0-100>` 快捷设 immersion_level = N/100
- UserPromptSubmit hook 统一读 `immersion_level`：
  - `= 0`：不注入任何语言指令
  - `0 < x < 1.0`：ambient mix 模式（D19 逻辑）
  - `= 1.0`：全沉浸模式（原 D6 逻辑）

**Alternative invalidation**：A 两个 flag 产生 4 种状态（off+off / off+on / on+off / on+on），on+on 矛盾无定义；C 两变量增加 hook 判断复杂度且用户需记住两个命令。

#### D19a. 实现机制

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. UserPromptSubmit hook 注入 system 指令「约 N% 词汇替换为 {active_language}」 | 最自然融入（hook 一段 additionalContext） | LLM 无法精确控制百分比（"约 20%" 可能出 5% 或 40%） | 中 |
| B. profile.yaml 写死 mix_rate，用户改文件 | 零代码 | 改 yaml 不算零摩擦 | 否 |
| **C. UserPromptSubmit hook 注入 + `lt mix <N>` 命令实时改 + hook 同时传词汇清单** | hook 注入 prompt + 附 CLI 产出的「本次可 mix 词汇 JSON」→ LLM 按清单替换 | 多一次 CLI 调用（可接受，单次 <50ms） | **是** |

**推荐 C**。实现链路：
```
用户发 prompt → UserPromptSubmit hook
  ↓ 读 profile.immersion_level (0-1)
  ↓ 如果 0 → 不注入
  ↓ 如果 1.0 → 全沉浸 prompt（D6 原逻辑）
  ↓ 如果 0 < x < 1.0 → ambient mix 模式：
    ↓ 检测 looksLikeCodeContext(userMessage) → 是 → 不注入（D19c）
    ↓ 调 `lt mix-vocab --limit 15 --json` 拉可 mix 词汇清单
    ↓ 注入 additionalContext：
      "[Ambient 语言混入] 在回复中将约 {immersion_level*100}% 的可替换中文词汇
       自然替换为目标语言（{active_language}）。替换范围限于以下清单：
       {mix_vocab_json}
       替换后在词旁括号标注中文对照，如：バグ（bug）。
       不替换代码、变量名、命令名、文件路径。
       不影响语义准确性。如果某个词放在当前语境中替换后会造成理解困难，跳过不替换。"
    ↓ 同时记录本次注入词汇到 NDJSON log
```

**Alternative invalidation**：A 不传词汇清单 LLM 自由选词 → 可能选用户没学过的 → 读不懂 → 关闭（driver 1 violation）；B 改 yaml 不够快（driver 1）。

#### D19b. 词汇来源

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. LLM 自由选词 | 无 CLI 调用 | 可能选未学过词、前后不一致 | 否 |
| B. 只限已掌握词（stability ≥ 7d 且 state=Review） | 用户 100% 读得懂 + 巩固记忆 | 初期 vocabulary pool 太小（前两周可能只有 20 词 → mix 千篇一律） | 中 |
| C. 只限弱项词（rating ≤ 2 最近 30 天内） | 强迫接触 | 可能读不懂 → 挫败感 | 否 |
| **D. 混合 80% 已掌握 + 20% 弱项** | 既巩固已知又小剂量挑战 | 弱项词可能看不懂 | **是** |

**推荐 D**。用户偏好 B + 灰度引入 D，Planner 评估教育学合理性：

**教育学依据**（Krashen i+1 假说 + Nation's incidental acquisition research）：
- 95-98% 已知词 + 2-5% 未知词 = 最佳自然习得窗口
- 80/20 比例落在这个范围内（20% 弱项 ≠ 完全未知，是「学过但没记牢」，心理可猜测度高）
- 纯已知词（B）= i+0，只巩固不进步，长期边际效益递减
- 纯弱项（C）= i+5，frustration 过高直接关

**实现**：`lt mix-vocab --limit 15 --json` 内部逻辑：
```
pool_mastered = SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
  WHERE c.language = :active_language
  AND r.state = 2 (Review)
  AND r.stability >= 7*24*3600*1000
  ORDER BY RANDOM()
  LIMIT 12; -- 80% of 15

pool_weak = SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
  WHERE c.language = :active_language
  AND (r.state IN (1, 3) OR r.stability < 7*24*3600*1000)
  AND r.lapses > 0
  ORDER BY RANDOM()
  LIMIT 3; -- 20% of 15

UNION ALL → shuffle → 输出 JSON [{id, ja, zh, reading}, ...]
```

如果 pool_mastered 不足 12 个（初期），全量填补不硬凑弱项。空 pool → hook 不注入 ambient prompt（graceful degrade）。

**Alternative invalidation**：A 不可控违反 principle 9（已知词优先）；B 纯已知 i+0 不进步；C 纯弱项挫败感高。

#### D19c. 代码上下文白名单（与 D6 统一设计）

**统一规则**：所有 immersion_level > 0 的场景，当 `looksLikeCodeContext(userMessage)` 为 true 时：
- immersion_level = 1.0（全沉浸）：当次 turn 切回中文（v2 D6 逻辑）
- 0 < immersion_level < 1.0（ambient）：当次 turn 不注入 mix prompt → Claude 纯中文回复

```typescript
function looksLikeCodeContext(s: string): boolean {
  return /```|^import |\.dart\b|\.ts\b|\.tsx\b|\.py\b|\.go\b|\.rs\b|\bclass \w+|\bfunction \w+|\bconst \w+\s*=|\bdef \w+|\bfn \w+/.test(s);
}
```

v3 扩展检测范围（v2 只有 dart/ts，v3 加 py/go/rs 覆盖更多项目类型）。

**不额外做 "闲聊 vs 工作" 任务类型自动检测（D19f 裁决见下）**。

#### D19d. 跟 FSRS 排期的交互

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. 不计入 FSRS（无 explicit feedback signal）** | 不污染 FSRS difficulty/stability 信号 | 被动暴露数据不可查 | **是（FSRS 侧）** |
| B. 算 silent passive review（update last_review 不改 stability） | 有被动复习痕迹 | 干扰 FSRS 的 elapsed_days 计算（review 间隔被压缩 → stability 上升 → 真出题时过早 review） | 否 |
| C. 算 super-easy review（rating=3） | 最大化 FSRS 利用 | **严重**污染信号（用户可能根本没注意到那个词就被标已复习） | 否 |

**推荐 A（FSRS 隔离）+ 独立暴露计数表**。

新增 `ambient_exposures` 表（不动 reviews/attempts 三表）：
```sql
CREATE TABLE IF NOT EXISTS ambient_exposures (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  concept_id   TEXT NOT NULL REFERENCES concepts(id),
  source       TEXT NOT NULL DEFAULT 'mix',  -- 'mix' | 'immersion' | 'keyword_probe'
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ambient_concept ON ambient_exposures(concept_id, created_at DESC);
```

UserPromptSubmit hook 在注入 mix 词汇清单后，调 `lt ambient-log --concepts <id1,id2,...>` 批量写入 ambient_exposures。

`lt stats --ambient` 查询：
```sql
SELECT c.ja, c.zh, COUNT(*) as exposure_count, MAX(ae.created_at) as last_exposed
FROM ambient_exposures ae JOIN concepts c ON c.id = ae.concept_id
WHERE c.language = :active_language
GROUP BY ae.concept_id
ORDER BY exposure_count DESC
LIMIT 20;
```

**Alternative invalidation**：B 干扰 elapsed_days（FSRS 把 passive review 当真 review → 降低 schedule 间隔 → 用户觉得刷不完永远有 due）；C 更严重，rating=3 让 stability 飙升 → 用户真测验时以为记住实际没有。

#### D19e. 进度可见性

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| **A. `/lt stats --ambient` 显示本周暴露统计** | 用户按需查、不打扰 | 需要主动 | **是** |
| **B. 周五 cron 推送 ambient 周报** | 被动可见 | 增加 cron 复杂度 | **是（叠加 A）** |
| C. 不做任何可见性 | 最安静 | 用户不知道 ambient 在学什么 → 质疑效果 → 关掉 | 否 |

**推荐 A + B**：
- `lt stats --ambient` 输出：本周混入 N 次、覆盖 M 个已学概念、前 5 高频词
- 周五 cron（复用 `lt daily-push` 加一天检测 if weekday=Fri）推送一行「本周 ambient 暴露 47 词次，覆盖 18 个 N3 概念」
- 不做实时弹窗 / 不在 Claude 回复后加统计行（会打断对话流）

**Alternative invalidation**：C 无反馈 → 用户不信 ambient 有用 → 关掉 → driver 5 失败。

#### D19f. 不同任务类型的强度调节

| 选项 | Pros | Cons | 推荐？ |
|---|---|---|---|
| A. hook 自动检测任务类型（代码/闲聊/解释/debug）精细调节 | 精准 | 检测不可靠（debug 和闲聊难区分）；多参数用户配不动 | 否 |
| **B. 二挡：代码上下文 → mix_rate=0 / 非代码 → 用 profile.immersion_level** | 简单清晰，一个 `looksLikeCodeContext` 搞定 | 不够精细（解释代码概念时也被归为代码场景） | **是** |
| C. 三挡：代码→0 / 技术讨论→rate/2 / 闲聊→rate | 更细 | 「技术讨论 vs 闲聊」检测不可靠 | 否 |

**推荐 B（二挡）**。原因：

1. `looksLikeCodeContext` 正则已在 v1/v2 验证过（D6 用同一个），误判率可控
2. 用户在讨论代码概念（如「这个 widget 怎么 build」）时不含 code block → 被归为非代码 → mix 仍生效 → 实际上用户在这场景接受度也 OK（讨论代码原理 ≠ 读代码）
3. 三挡的「技术讨论」检测需要语义理解，hook 里无法可靠做到（bun 调 CLI 不是 LLM）

**Alternative invalidation**：A/C 检测不可靠，增加维护成本且误判时（debug 时插日文）比二挡更烦。

#### D19g. 用户接受度 + 首周默认值 + 加压策略

| 选项 | 默认 mix_rate | 策略 | 推荐？ |
|---|---|---|---|
| A. 高启动 30%+ | 训练量大 | 首日关掉概率 > 50% | 否 |
| B. 低启动 5% | 几乎无感 | 效果微弱 | 否 |
| **C. 10% 启动 + 手动调节** | 每 5 句回复约 1 句有 1 个词被替换；用户可感知但不干扰 | 需要用户主动调 | **是** |
| D. 10% 启动 + 自动加压（每周 +5%） | 无需操作 | 用户不知道为什么 Claude 越来越日文；可能某周突然不适应 | 否 |

**推荐 C（10% + 手动）**：
- 默认 `immersion_level=0.10`（安装完即生效，Principle 9 + driver 1 平衡点）
- `lt mix 20` 命令随时调（实时生效，下次 prompt 就用新值）
- `/lt-setup` onboarding 步骤新增一问：「ambient 语言混入强度？（推荐 10-20%，输入 0 关闭）」
- **不做自动加压**（用户不知道为什么越来越难读 → Scenario 6 失败路径）

**Alternative invalidation**：A 首日关；B 无感等于没有 → 用户忘记有这功能 → 不调高 → 等于没有；D 自动加压没有 explicit consent → 用户感到失控 → 关掉。

---

## 5. D18 Updated：已实现代码迁移路径（v3 增量 patch）

v2 D18 全量保留。v3 新增：

| 文件 | 改动 | Why |
|---|---|---|
| `src/profile.ts` | Profile 接口加 `immersion_level: number` 替代 boolean `immersion_default`；老 `immersion_default: true` 自动迁移为 `immersion_level: 1.0`；加 `mix_mastered_ratio: number`（默认 0.8） | D19-0 合并 + D19b |
| `src/db.ts` | migrate v3: 新增 `ambient_exposures` 表 + 索引（用 user_version 3） | D19d |
| `src/db.ts` | AmbientExposureRow interface | D19d |
| **新增** `src/ambient.ts` | `getMixVocab(lang, limit, masteredRatio)` → 拉 mastered + weak pool → shuffle → 输出 JSON；`logAmbientExposures(conceptIds)` → 批量 INSERT ambient_exposures | D19b/D19d |
| `src/cli.ts` | 新增 `mix-vocab` 子命令（调 ambient.getMixVocab）+ `mix <N>` 子命令（patch profile.immersion_level）+ `ambient-log` 子命令 | D19a/D19e |
| `src/cli.ts` | `immersion` 子命令改为：`lt immersion <0-100|on|off|status>`，on=100, off=0, 数字=N/100 | D19-0 |
| `src/concepts.ts` | `getStats()` 加 ambient_exposures 统计（本周暴露次数/覆盖概念数） | D19e |
| `src/work-hours.ts` | 不变 | - |
| `src/paths.ts` | 移除 `IMMERSION_FLAG`（不再用 flag 文件，改 profile 字段） | D19-0 |
| `hooks/user-prompt-submit.ts` | immersion 分支改为三路（=0 / 0<x<1 / =1.0）；ambient 路径调 `lt mix-vocab --limit 15 --json` + 注入 prompt + 调 `lt ambient-log` | D19a |
| **新增** skill `/lt-mix` | thin wrapper：`lt mix <N>` 快捷调 | D19g |
| `tests/` | 新增 `ambient.test.ts`（vocab pool 分 mastered/weak + 空 pool graceful degrade）+ `immersion-level.test.ts`（0/0.1/1.0 三档 hook 行为） | D19 |

**关键约束**：不删已有代码；`immersion.flag` 文件在 profile 读取时若存在则自动迁移为 `immersion_level=1.0` 并删除文件（one-time migration）。

---

## 6. Pre-mortem（v2 5 + v3 新增 2 = 7 scenarios）

### Scenario 1-5：沿用 v2

1. Stop hook 烦人到关闭（v1, L=H I=H）
2. Cross-tool 写冲突（v1, L=L I=H, Adj-C 解决）
3. 设计复杂跑不起来（v1, L=M I=M）
4. TTS Linux 哑火（v2, L=M I=M）
5. 多语言切换 + token 预算爆（v2, L=M I=M）

### Scenario 6：【v3 新增】Ambient mix 让 Claude 说话不顺畅 → 关闭（L=H, I=H）

**症状**：用户开了 mix 20%，Claude 把「这个 bug 在第三行」说成「この バグ（bug）は第三行にあります… 不对，是在第三行」→ LLM 被 mix 指令干扰后回答变得语义混乱、长度膨胀、甚至错误（因为 LLM 花 attention 在挑词替换而非回答问题）。
**根因可能**：
- LLM 不擅长精确控制替换比例（说 20% 实际 5% 或 50%）
- 强制替换某些词导致句子结构变形（日语语序与中文不同，插入日语词不自然）
- 长回答（如解释架构）里 mix 词太多读不下去

**Mitigation**：
1. **prompt 约束精确化**：不说「约 N%」，改为「从以下清单中选 ≤ 3 个词替换在本次回复中，用括号注中文」→ LLM 更容易遵守「N 个词」比「N%」
2. **词汇清单限 15 个但建议替换 ≤ `ceil(immersion_level * 10)` 个**（level=0.1 → ≤ 1 个/回复；level=0.3 → ≤ 3 个）→ 绝对数量可控
3. **替换只在句末/括号补充而非句中强插**：prompt 模板写明「在句子末尾或独立注释形式补充目标语言，如：修复了这个 bug（バグ / bagu）」
4. **回复长度膨胀控制**：prompt 写明「混入不应增加回复长度超过 10%；如果当前回复已经很长（>500 字），减少混入量」
5. **用户可一行关**：`lt mix 0` 立即停止；profile 改 immersion_level=0 → 下次 prompt 无注入
6. **首周 log 审计**：log 每次 mix 注入的词 + Claude 实际回复中出现的词 → `lt logs --event ambient_inject` → 用户/开发者事后检查 LLM 遵守度

### Scenario 7：【v3 新增】LLM 无法精确控制替换比例 → mix 效果随机 → 用户觉得不可控（L=M, I=M）

**症状**：用户设 mix 10%，实际有时 0 有时 40%，每次回复替换量完全不可预测。
**根因**：LLM 是概率模型，「替换 N%」是 soft constraint 不是 hard constraint。

**Mitigation**：
1. **改用绝对数量而非百分比**（Scenario 6 mitigation 2 已覆盖）：`ceil(immersion_level * 10)` 给上限
2. **hook prompt 末尾加 one-shot 示例**：给 2 个替换和不替换的 example → LLM few-shot 学习比纯 instruction 更可靠
3. **事后统计 log 验证**：`lt stats --ambient --accuracy` 算「指令要求 N 个 / 实际出现 M 个」的偏差率 → Phase 1.4 dogfood 期如果偏差 > 50% 则调整 prompt 模板
4. **接受非精确**：prompt 模板用「至多 N 个」而非「恰好 N 个」→ LLM 少替换可以，多替换不行（fail safe 方向是少不是多）

---

## 7. Test Plan（v2 全量 + v3 新增）

### 7.1 Unit（v2 全量 + v3 新增）

v2 unit tests 全部保留。v3 新增：

| 测试 | 文件 | 关键 case |
|---|---|---|
| `tests/ambient.test.ts` | getMixVocab mastered=12 weak=3 正确 pool 分配 / 空 pool → 返回 [] / mastered 不足 12 → 全填 mastered 不硬凑 weak / logAmbientExposures 批量 insert | D19b/D19d |
| `tests/immersion-level.test.ts` | profile.immersion_level=0 → hook 不注入 / =0.10 → hook 注入 ambient prompt 含 ≤ 1 个替换上限 / =1.0 → 全沉浸 prompt / 旧 immersion.flag 文件自动迁移为 1.0 | D19-0 |
| `tests/ambient-stats.test.ts` | ambient_exposures 插 20 行 → getStats --ambient 输出正确 exposure_count + covered_concepts | D19e |
| `tests/code-context-detect.test.ts` | 扩展 looksLikeCodeContext 正则测试 py/go/rs 文件后缀 + import + class/function/const/def/fn | D19c |

### 7.2 Integration（v2 全量 + v3 新增）

| 测试 | 流程 |
|---|---|
| user-prompt-submit ambient full path | profile immersion_level=0.15 + concepts 有 20 个 mastered → hook 输出 additionalContext 含 mix 词汇 JSON + 替换上限 ≤ 2 | D19a |
| ambient + code context skip | immersion_level=0.15 + userMessage 含 ``` → hook 输出 additionalContext 无 mix 指令 | D19c |
| ambient-log batch write | hook 调 `lt ambient-log --concepts id1,id2,id3` → ambient_exposures 表多 3 行 | D19d |
| immersion_level migration | 旧 immersion.flag 存在 → readProfile 返回 immersion_level=1.0 → flag 文件被删 | D19-0 |
| lt mix 20 → lt mix 0 cycle | mix 改值 → 下次 hook 读到新值 → mix 0 后 hook 不注入 | D19g |

### 7.3 E2E（v2 全量 + v3 新增手动步骤）

手动 E2E 追加步骤（插在 v2 §6.3 步骤 3 后）：

9. `lt mix 15` → 下次向 Claude 发非代码消息 → Claude 回复中出现 1-2 个目标语言词 + 中文对照
10. 发含 ``` 的代码 prompt → Claude 回复纯中文无 mix
11. `lt mix 0` → 下次回复无 mix
12. `lt stats --ambient` → 显示刚才的暴露记录
13. `lt immersion 100` → 下次回复全日文（原 D6 沉浸模式）

### 7.4 Observability（v2 全量 + v3 新增事件）

新增 NDJSON 事件：

```jsonc
{"ts":"...", "event":"ambient_inject", "immersion_level":0.15, "suggested_max":2, "vocab_count":15, "mastered_count":12, "weak_count":3, "concept_ids":["n3-vocab-001","n3-vocab-042",...]}
{"ts":"...", "event":"ambient_skip", "reason":"code_context", "immersion_level":0.15}
{"ts":"...", "event":"ambient_skip", "reason":"empty_pool", "immersion_level":0.15}
{"ts":"...", "event":"ambient_logged", "concept_ids":["n3-vocab-001","n3-vocab-042"], "count":2}
{"ts":"...", "event":"immersion_level_changed", "from":0.10, "to":0.20}
```

`lt logs --event ambient_inject` / `lt logs --event ambient_skip --since 1h`。

### 7.5 Mock 测验 + Ambient 效果度量（Phase 1.4+）

在 mock-test report 里加一维：「ambient 暴露 ≥ 7 次的概念 vs < 7 次 → 答对率对比」。如果暴露 ≥ 7 次组显著高于对照组（p < 0.05 on 30-题 binomial test），证明 ambient 有效。

---

## 8. 任务重排 + 新增任务（v2 22 → v3 25）

**任务 1-5 已完成（不动）**。v2 任务 5.5-22 全部保留。**v3 新增任务 23-25**：

| Task | 内容 | Phase | 优先级 | 依赖 |
|---|---|---|---|---|
| 5.5 | 数据完整性 hardening（Adj-C） | 1.0 | P0 | 5 |
| 6 | 种子题库 import（ja） | 1.0 | P0 | 5.5 |
| 7 | 5 个 skill markdown（含 rubric Adj-E） | 1.0 | P0 | 6 |
| 8 | 3 个 hook（含 Adj-D shell pre-gate + Adj-F profile 字段） | 1.0 | P0 | 6, 7 |
| 9 | 沉浸模式 + 关键词反问接线 | 1.0 | P1 | 8 |
| 10 | launchd plist 模板 | 1.0 | P2 | 8 |
| 11 | Codex/Gemini snippet（Adj-B） | 1.0 | P1 | 7 |
| 12 | install.sh + bun build（Adj-A） | 1.0 | P0 | 6-11 |
| 13 | README + e2e demo | 1.0 | P0 | 12 |
| 14 | 项目重命名 polyglot/lt（D9/D10） | 1.0 | P0 | 12 |
| 15 | 多语言 schema migration + lang.ts（D11/D12/D18） | 1.1 | P0 | 13 |
| 16 | 多语言 seeds 韩语（D11/D12） | 1.1 | P1 | 15 |
| 17 | 多语言 hook 适配（D17） | 1.1 | P1 | 15 |
| 18 | TTS macOS backend（D13/D14） | 1.2 | P1 | 15 |
| 19 | 听力 `/lt listen`（D15） | 1.2 | P1 | 18 |
| 20 | 讲解 `/lt explain` + verbose（D16） | 1.3 | P1 | 19 |
| 21 | TTS edge-tts Linux fallback（D13） | 1.3 | P2 | 20 |
| 22 | mock-test（Architect Risk #7） | 1.3 | P2 | 16 |
| **23 (NEW)** | **D19-0 合并 + immersion_level 谱系**：profile.immersion_level 替代 boolean + flag 文件迁移 + `lt immersion <N>` + `lt mix <N>` 命令 + UserPromptSubmit hook 三路分支 | **1.4** | P0 | 17 |
| **24 (NEW)** | **D19b+d ambient 词汇引擎 + 暴露日志**：src/ambient.ts + db v3 ambient_exposures 表 + `lt mix-vocab` + `lt ambient-log` CLI + 80/20 mastered/weak pool | **1.4** | P0 | 23 |
| **25 (NEW)** | **D19e+g ambient 可见性 + onboarding**：`lt stats --ambient` + cron 周五推送 + `/lt-setup` 新增 mix 强度问题 + `/lt-mix` skill + hook prompt 模板含 one-shot 示例 | **1.4** | P1 | 24 |

### 任务依赖图（v3）

```
[Phase 1.0 v1 + Adjustments]
Task 5.5 (data integrity) ─→ Task 6 (seeds) ─┬─→ Task 7 (skills + rubric)
                                              │     │
                                              └─→ Task 8 (hooks + shell pre-gate)
                                                    │
                                                    ├─→ Task 9 (immersion wire)
                                                    ├─→ Task 10 (cron)
                                                    └─→ Task 11 (codex/gemini)
                                                         │
                                                         └─→ Task 12 (install)
                                                              │
                                                              └─→ Task 13 (README e2e)
                                                                   │
                                                                   └─→ Task 14 (rename)

[Phase 1.1 多语言]
Task 14 ─→ Task 15 (schema migration)
              │
              ├─→ Task 16 (ko seeds)
              └─→ Task 17 (multi-lang hooks)

[Phase 1.2 TTS]
Task 15 ─→ Task 18 (TTS macOS)
              │
              └─→ Task 19 (listen mode)

[Phase 1.3 讲解 + Linux + mock]
Task 19 ─→ Task 20 (explain)
              ├─→ Task 21 (edge-tts Linux)
Task 16 ─→ Task 22 (mock-test)

[Phase 1.4 Ambient Mix-Language]
Task 17 ─→ Task 23 (immersion_level 合并)
              │
              └─→ Task 24 (ambient 词汇引擎 + 暴露日志)
                    │
                    └─→ Task 25 (可见性 + onboarding)
```

**总估时**：v2（42-61h）+ Task 23（3-4h schema + migration + 命令改造）+ Task 24（4-5h ambient.ts + db v3 + CLI + pool 逻辑）+ Task 25（2-3h stats + cron + skill）= **51-73 小时 dev work**。

---

## 9. Phase 划分 + 推荐

| Phase | 范围 | 目标 | 准入 | 估时 |
|---|---|---|---|---|
| **1.0** | Task 5.5-14 | v1 完整 + 5 Adjustments + lt 改名 | bun test 绿 + e2e ja 跑通 + jp alias 工作 | 18-26h |
| **1.1** | Task 15-17 | 多语言 + 韩语 + hook 适配 | active_language=ko `/lt` 出 TOPIK 题 | 10-15h |
| **1.2** | Task 18-19 | TTS + listening | `/lt say` ja/ko 能听 + `/lt listen` 工作 | 5-7h |
| **1.3** | Task 20-22 | 讲解 + Linux + mock | `/lt explain` 5 段教学 + mock-test 30 题 | 7-10h |
| **1.4** | Task 23-25 | Ambient Mix-Language | `lt mix 15` → Claude 回复夹带词 + `lt stats --ambient` 可查暴露 | 9-12h |

### D19 为什么放 Phase 1.4 而不是更早？

1. **依赖链**：D19 的 UserPromptSubmit hook 三路分支（=0/ambient/full）依赖 Task 17（多语言 hook 适配）中 active_language 落地；ambient 词汇池依赖多语言 schema（Task 15）；一键 `lt mix` 依赖项目重命名（Task 14）。
2. **风险排序**：D19 是**最高 UX 风险**的功能（Scenario 6：LLM 说话变怪 → 关闭）。在 1.0-1.3 已完成稳定 baseline 后再叠加 D19，如果 ambient 翻车可以独立回滚（只删 Task 23-25 代码），不影响核心训练流。
3. **教育学验证窗口**：Phase 1.0-1.3 dogfood 期间用户已积累 ≥ 20 个 mastered 概念 → ambient pool 有足够词汇 → D19 落地后立即有效果。如果在 Phase 1.0 就做 D19，mastered pool 为 0 → ambient 永远 skip → 用户看不到效果 → 质疑 → 关掉。

### Alternative invalidation

- **D19 放 Phase 1.1（紧跟多语言）**：多语言刚落地，mastered pool 接近 0（新语言），ambient 无词可 mix → 用户体验空转
- **D19 放 Phase 1.0（最早）**：v1 任务 6-13 + 5 Adjustments 已经是 18-26h 工作量；再加 D19 的 hook 改造 → Phase 1.0 膨胀 → 延迟 dogfood → 违反 phase 原则
- **D19 不分 phase 一次性**：同 v2 §8 reasoning，一次性写完回滚单位 = 全部

---

## 10. v3 风险清单（v2 全量 + v3 新增）

### v1+v2 风险沿用

参见 v1 §7 + v2 §9 全部风险（R-V1 到 R-V10）。

### v3 新增

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| **R-V11：Ambient mix 让 Claude 回复语义混乱** | H | H | prompt 用绝对数量 ≤ ceil(level*10) 而非百分比 + 句末括号注释模式（不强插句中）+ 长回复自动减量 + 首周 log 审计 + `lt mix 0` 一行关 | Task 25 |
| **R-V12：LLM 无法遵守替换数量指令** | M | M | few-shot 示例 + 「至多 N 个」fail-safe + 事后 log 偏差统计 → 偏差 > 50% 调 prompt 模板 | Task 25 |
| **R-V13：ambient pool 初期太小 → mix 千篇一律** | M | L | mastered 不足 12 → 全量填不硬凑 weak → 极端情况 pool=0 → hook graceful skip 不注入 → log NDJSON | Task 24 |
| **R-V14：ambient_exposures 表膨胀** | L | L | 每次 hook 写 ≤ 15 行 × 100 prompt/day = 1500 行/天 × 365 天 = 547K 行 ~20MB → 可接受 5 年；如需清理 `lt db compact --keep-days 365` | Task 24 |
| **R-V15：immersion_level 合并引入向后不兼容** | M | M | 旧 immersion.flag 自动迁移 + 旧 profile immersion_default: true → immersion_level: 1.0 + 单测覆盖 migration + 文档注明 breaking change v0.4.0 | Task 23 |
| **R-V16：ambient 暴露被视为 FSRS review → 信号污染** | L | H | ambient_exposures 独立表 + FSRS 三表零改动 + reviews/attempts 查询不 JOIN ambient_exposures（物理隔离）| Task 24 |
| **R-V17：cron 周五推送 ambient 周报时 ambient_exposures 为 0（用户 mix=0 整周）** | L | L | cron 检测 exposure_count=0 → 不推送（silent skip）| Task 25 |

---

## 11. ADR Draft（v2 全量 + v3 新增 ADR-005）

### ADR-001 到 ADR-004：沿用 v2

完整内容见 v2 §10。v3 对 ADR-001 做追加：

**ADR-001（v3 追加）**：
- Decision 新增：(8) UserPromptSubmit hook 三路分支（immersion_level=0/ambient/full）+ ambient mix 词汇引擎 + ambient_exposures 独立表 + 5 phase 串行
- Alternatives considered 新增：D19-0A 独立并行两 flag（拒，状态矩阵冲突）/ D19b-A LLM 自由选词（拒，不可控）/ D19d-C FSRS rating=3 passive（拒，信号污染）/ D19g-D 自动加压（拒，失控感）
- Consequences 新增：✓ 被动暴露 24/7 零摩擦 / ✗ LLM 替换比例不精确需 few-shot 补偿 / ✗ mastered pool 初期可能不足

### ADR-005（v3 新增）：Ambient Mix-Language 与沉浸模式合并

**Decision**: D6 沉浸（binary on/off）与 D19 ambient mix（continuous 0-1）合并为统一 `immersion_level` 谱系。0=关、0<x<1.0=ambient mix、1.0=全沉浸。词汇来源限 80% 已掌握 + 20% 弱项。暴露记录写独立 `ambient_exposures` 表，不计入 FSRS 排期。LLM 替换用绝对数量上限（ceil(level*10)）+ 句末括号注释 + few-shot 示例。

**Drivers**:
1. 零摩擦（D19 最高优先：Claude 说话变怪 = 关掉 = 失败）
2. 被动暴露长期记忆（incidental acquisition research: ≥ 7 次暴露 → 长期记忆）
3. FSRS 信号纯度（passive 不能污染 active rating）

**Alternatives considered**:
- 独立并行 D6 + D19 → 拒（状态矩阵 2x(0-1) 冲突，on+on 无定义）
- D6 hard override → 拒（两变量复杂度）
- LLM 自由选词 → 拒（不可控）
- FSRS rating=3 passive → 拒（信号污染）
- 百分比替换 → 拒（LLM 不精确，改用绝对数量上限）
- 自动加压 → 拒（用户失控感）

**Why chosen**:
- 单一旋钮 immersion_level 用户心智模型最清晰
- 绝对数量上限比百分比更可控（LLM 更擅长「至多 3 个」而非「约 20%」）
- 80/20 mastered/weak 对齐 Krashen i+1 假说（95-98% 已知 + 2-5% 未知）
- 独立 ambient_exposures 表保护 FSRS 纯度
- Phase 1.4 落地给足 mastered pool 积累时间

**Consequences**:
- ✓ 用户 `lt mix 15` 一行开启被动学习
- ✓ 不影响核心训练流（D19 全程 graceful degrade）
- ✓ 暴露统计可查 `lt stats --ambient`
- ✗ LLM 替换比例不精确（靠 few-shot + 绝对上限补偿）
- ✗ mastered pool 初期可能不足导致 ambient skip
- ✗ 旧 immersion.flag 文件需 one-time migration

**Follow-ups**:
- Phase 2.0：ambient 效果 A/B 测试（mock-test 对照组 ≥ 7 次暴露 vs < 7 次）
- Phase 2.0：支持 Codex/Gemini ambient（通过 AGENTS.md snippet 注入 mix 指令 + 手动 `lt mix-vocab` → 用户粘贴词汇列表到 prompt）
- 持续：prompt 模板调优（few-shot 示例更新 + 偏差率监控）

---

## 12. Open Questions（v2 全量 + v3 新增）

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

### v3 新增 Open Questions

- [ ] **ambient prompt 模板最优 few-shot 示例数**：1 个 example 还是 2-3 个？more = LLM 更遵守但注入 token 多（每个 example ~50 token × 3 = 150 token / prompt）— 需 Phase 1.4 dogfood 实测
- [ ] **ambient 暴露阈值 7 次的来源**：Nation (2001) research 给的 8-12 次，Waring & Takaki (2003) 给 5-7 次，Pigada & Schmitt (2006) 给 10+ 次；用 7 次作为「可能记住」的 proxy 是否足够？还是该用 10 次？影响 `lt stats --ambient` 的「已巩固」标签阈值
- [ ] **ambient_exposures 是否需要记录 LLM 实际替换了哪些词**（vs 只记录「提供了哪些词」）？记录实际替换需要 LLM 回复后 post-process parse（极难可靠），记录提供清单简单但不精确
- [ ] **mix_rate vs immersion_level 命名**：用户面对 `lt mix 15` 更直觉（mix 百分比），但内部用 `immersion_level=0.15`（0-1 浮点）；是否统一 UX 面用百分比（0-100 int）内部用浮点？当前设计已如此但 profile.yaml 写 float 用户看到 `immersion_level: 0.15` 可能困惑为什么不是 15
- [ ] **Codex/Gemini 的 ambient 方案**：无 hook 机制，用户在 Codex 里能不能手动 `lt mix-vocab --limit 15` → 把输出粘贴到 prompt 前缀？还是太摩擦不值得？

---

## 13. Final Checklist

- [x] Principles 更新（v2 8 + v3 新增 1 = 9 条）
- [x] Decision Drivers 更新（v2 4 + v3 修订 1 = 5 条）
- [x] D1-D8 沿用（一段引用）
- [x] D9-D18 沿用 v2（简引 + D18 v3 增量 patch）
- [x] D19 完整决策（D19-0 合并裁决 + D19a-g 每个 ≥2 选项 + tradeoffs + 推荐 + alternative invalidation）
- [x] Pre-mortem 7 scenarios（v2 5 + v3 新增 2）
- [x] Test plan 扩展（含 ambient unit/integration/e2e/observability + mock-test 效果度量）
- [x] 任务重排（v2 22 + v3 新增 3 = 25 任务）
- [x] Phase 划分（5 phase + D19 放 1.4 的理由 + alternative invalidation）
- [x] 风险清单（v2 10 + v3 新增 7 = 17 条新增 + v1 原有）
- [x] ADR 草稿（v2 ADR-001-004 + v3 ADR-005）
- [x] 已实现代码迁移路径 v3 增量 patch
- [x] Open Questions v3 新增 5 条
- [x] 不丢任何 v1 + Architect 5 adjustments + v2 工作量

---

## 14. 下一步交接

1. Planner v3 输出本文件 → **Architect v2 review**（重点关注：D19-0 合并是否正确 / ambient pool 80/20 教育学论据 / prompt 模板绝对数量 vs 百分比 / ambient_exposures 表膨胀预估 / Phase 1.4 依赖链是否合理）
2. Architect 修订 → **Critic v2 review**（重点关注：Scenario 6/7 mitigation 是否足够 / 5 phase 划分是否过度切分 / R-V11 到 R-V17 风险完整性）
3. Critic 修订 → Executor 按 §8 任务表落地（Phase 1.0 → 1.1 → 1.2 → 1.3 → 1.4）
4. 每 phase dogfood ≥ 3 天 + log 分析。特别是 **Phase 1.4 dogfood 重点**：审计 ambient prompt LLM 遵守度（`lt logs --event ambient_inject` → 对比 Claude 实际回复中目标语言词出现次数 vs 建议数量 → 偏差率 > 50% 则返工 prompt 模板）
