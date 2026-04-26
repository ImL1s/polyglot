# RALPLAN-DR Architect Review — polyglot/lt Planner v3

> Architect: opus (DELIBERATE mode)
> Date: 2026-04-27
> Verdict: **Continue with adjustments** — v3 D19 fold-in 方向正确，但有 3 条必修 + 3 条强烈推荐
> Scope: v3 增量（D19-0 合并 + D19a-g + Phase 1.4 重排 + ambient_exposures 表）。v1/v2 已审基础设施层 5 Adjustments (A-F) 不重复审。

---

## Verdict

D19 fold-in 思路（统一 immersion_level 谱系 + 80/20 词汇池 + ambient_exposures 物理隔离 FSRS）**架构上 sound**，但 v3 在三个地方踩了 v1 Architect 已经埋过的坑：

1. **D19-0 合并** 把二元开关压进连续刻度，UX 不连续 vs 内部连续的张力没解决
2. **Phase 1.4 dogfood gating（≥20 mastered）** 依赖链反向，会让 D19 永远开不出来
3. **ambient_exposures** 表无 retention 策略，5 年线性膨胀 Planner 自己估的 547K 行被低估（实际接近 2.7M）

## Top 3 Must-Fix（最关键 3 条新 Adjustment）

1. **Adjustment H — immersion_level 离散化（5 档预设 + escape hatch）**：解决 T8 + R-V11 的 UX 不连续问题。`lt mix 23` 让用户以为是精度，实际 LLM 行为只能离散到 0/1/2/3 词数。改成预设档位 `0/0.10/0.25/0.50/1.00` + 自定义 escape hatch + 文档明确每档行为映射。
2. **Adjustment J — Phase 1.4 提前到 1.1b（紧跟多语言）**：Planner 自己 D19b 决策已经是「pool 不足 graceful skip」，那 dogfood gating 就是自我矛盾。1.4 推迟到第 5 周（49-73h 的最后）会让 Principle 9（被动暴露优先于主动测验）实际验证窗口推迟 4 周，Phase 1.0-1.3 的 dogfood 期间用户根本感受不到 v3 的 ambient 价值。
3. **Adjustment G — ambient_exposures retention + 清理子命令**：Planner R-V14 估的 547K 行/5 年 = 20MB 是按「100 prompt/day × 1 词/prompt」算的，但 ambient_exposures **每次注入 batch 写入清单全部 ID**（D19d 实现描述 batch 写 `concept_ids`），15 词/prompt × 100 prompt/day × 365 = 547K/年，5 年 = **2.7M 行**。需要 90 天默认 retention + `lt ambient-clean` 子命令 + 周报后归档。

---

## 1. Steelman Antithesis（v3 增量，3 条最强反论）

### A1. "D19 ambient mix 是噱头不是教学法 — Krashen i+1 + sparse exposure 论证可疑"

**最强辩护**：
- Krashen i+1 假说在 SLA 学界 30 年来仍有争议（Swain 1985 反驳：comprehensible input 不够，需要 pushed output；Long 1996 反驳：interaction 比 input 重要）。Planner 援引 Krashen + Nation incidental acquisition research 作为 D19b 80/20 比例的依据，但：
  - Krashen i+1 假定的是**连续高密度浸入式输入**（每天 1 小时 Netflix 日剧 / 看日文小说）—— 不是每次 Claude 回复随机塞 1-3 个词的零碎 sparse exposure
  - Nation (2001) 的 8-12 次曝光阈值数据是基于**阅读理解**实验（连续阅读 N 千词 graded reader），单次曝光持续 5-30 秒，注意力专注度高
  - ambient mix 单次曝光 < 1 秒（用户读 Claude 回复扫过去），且**无后续测验**回收信号 → retention curve 远低于 spaced repetition + 主动出题
- 资源对比：用户日常 Phase 1.0-1.3 已经在 FSRS 主动训练上每天投入 5-15 分钟。再花 9-12h dev work 做 Phase 1.4，**机会成本**是同样时间能把 mock-N2 题库扩到 200 题或加 N1 vocab 1500 词，对 Driver 3（N2 通过率）增量贡献明显高于 ambient
- 历史教训：DuoLingo 的 immersion mode（2014 上线 2017 关闭）就是因为「sparse exposure 没有 retention 提升信号」被砍

**Architect rebuttal**：
- 不致命因为 Planner 自己加了 §7.5 的 mock-test 效果度量（暴露 ≥ 7 次组 vs < 7 次答对率对比）—— 实际上是 **dogfood 期间的 A/B test** 自我证伪机制
- driver 1 (零摩擦) 在 D19 设计中被严格保护：mix=0 默认值之外 user 主动 `lt mix 15` 才生效，`lt mix 0` 一行关 → 用户控感强
- A1 应该作为 §9 ADR follow-up 必落项

**Verdict**：不致命，但 **Adjustment K1 升级 Phase 1.4 准入门槛**：Phase 1.4 落地后 30 天内 mock-N2 无显著提升则 ADR-005 标记 deprecated + 默认 `immersion_level=0`。

### A2. "D6 + D19 合并是错误简化 — 心智模型不连续"

**最强辩护**：
- D6 沉浸是**结构化教学**：全日文回答 + 假名注音 + 中文翻译附后 → 用户主动调用学习模式
- D19 ambient 是**零碎注入**：被动接受 1-3 个词 + 括号注释 → 用户工作流不切换
- 单旋钮看似简洁实则强制把**两个独立功能**压成一个连续轴，导致中间区段（0.3 < x < 0.9）行为未定义；0.95 边缘值尤其问题（按数量上限算 ≤ 9 词替换，但句子结构上要不要全日语？）

**Architect rebuttal**：
- Planner D19a 实现链路明确说「= 1.0 → 全沉浸 prompt」「0 < x < 1.0 → ambient mix 模式」—— 显式三路分支不是连续函数
- 但 0.95 这种边缘值是真问题：用户输 `lt mix 95` 走 ambient mix 但效果接近全沉浸 → UX 撕裂
- 用 Adjustment H（离散化 5 档）正好解决：用户能输的值就是 0/0.10/0.25/0.50/1.00，0.95 不可达 → 边缘值消失

**Verdict**：不致命，但**强烈 mandate Adjustment H** 离散化。

### A3. "Phase 1.4 dogfood gating（≥ 20 mastered）反向依赖 — 用户在第二周就流失"

**最强辩护**：
- 实际计算：FSRS-5 默认参数下，新概念达到 `state=Review` + `stability ≥ 7d` 需要至少 3 次成功复习。20 个 mastered 需要：
  - 最快情况（每天 5 新 + 100% 答对 + 3 次 review 全 rating=4）：~14 天
  - 真实情况（每天 5 新 + 70% 答对率 + lapses 偶发）：~21-30 天
- **用户视角**：从 setup 到积累 20 mastered = 21-30 天 = Phase 1.0-1.3 的 dogfood 第 3-5 周
- Phase 1.4 在第 5 周才上 = 用户**前 4 周完全感受不到 ambient 价值** = 注意力曲线断层

**Architect rebuttal**：
- Planner D19b 决策原文：「pool_mastered 不足 12 个（初期），全量填补不硬凑弱项。空 pool → hook 不注入 ambient prompt（graceful degrade）」
- **这与 Phase 1.4 dogfood gating 互相矛盾**：既然空 pool graceful skip，那 Phase 1.4 提前到 1.1（pool=0 时也能落地）就没有「ambient 永远 skip」的风险
- A3 的真正含义是 **「Phase 1.1 而非 Phase 1.4」**

**Verdict**：致命的依赖链反向 + Planner 内部矛盾。**强烈 mandate Adjustment J — Phase 1.4 提前到 1.1b**。

---

## 2. Tradeoff Tensions（v3 新增 4 条 unresolved）

### T5. "LLM 可控性" vs "用户感知自然"

「绝对数量上限 + 句末括号注释 + few-shot 示例」让 LLM 可控但**读起来机械**。「修了这个 バグ（bug）」连续 10 次后用户会觉得是模板而非自然语言混入。

**Adequacy**：不充分。需要 **Adjustment I — D19 prompt 模板版本化**。skill markdown frontmatter 加 `prompt_version: v1`，每次改 prompt 模板必须 bump 版本。

### T6. "ambient_exposures 表膨胀" vs "进度可见性"

100 prompts/天 × **15 词/prompt（D19a 实现：mix-vocab --limit 15）** × 365 天 = **547K 行/年**，5 年 = **2.7M 行**。Planner R-V14 低估 15 倍。

**Adequacy**：不充分。需要 **Adjustment G — 90 天 retention + `lt ambient-clean` 子命令**。

### T7. "5 phase 串行 vs 用户「全都要」愿景"

Planner §9 切 5 phase（51-73h）意味着 Phase 1.4 ambient 在第 4-5 周才开。用户可能在 Phase 1.0 上线第二天就问「ambient 在哪」。

**Adequacy**：T7 与 A3 是同一个问题的两面。Adjustment J 解决。

### T8. "immersion_level 单旋钮简洁 vs 实际 UX 行为不连续"

`lt mix 0`/`0.10`/`0.25`/`0.50`/`1.0` 是有意义档位，`0.23`/`0.67` 没意义。强制 continuous 让 `lt mix 23` 看起来像精度，实际行为只能离散。

**Adequacy**：不充分。Adjustment H 离散化 5 档解决。

---

## 3. Principle Violations（v3 增量，DELIBERATE 模式必查）

| # | Principle | Violation | Severity |
|---|---|---|---|
| **P6** | 1 "依附工作流不打断" | UserPromptSubmit hook 每次都注入 system 指令（即便 mix=0.10）—— LLM context 多了 ~500 token / prompt × 100 prompt/day = 50K token 噪声 | **Medium** |
| **P7** | 5 "失败安全 + 一键关闭" | `lt mix 0` 是否真的瞬间生效？Hook 已经注入的当前 prompt 还会让 Claude 在当前 turn 输出 mixed 内容 → 用户感觉「关不掉」 | **Low** |
| **P8** | 9 (新) "被动暴露优先于主动测验" | 自身循环论证风险：「被动暴露优先」被用作 D19 合理性论据，但 D19 是否真有效又依赖 Principle 9 成立 → 应该降级为「假设 + Phase 1.1b dogfood 验证」 | **Medium** |
| **P9** | (新候选) "ambient < active 优先级" 缺失 | 没有原则保护「ambient 不能喧宾夺主」—— 用户主动 `/lt` 答题（active 训练），同 turn 又被 hook 注入 ambient mix prompt，两者会冲突 | **Medium** |
| **P10** | (新候选) "ambient prompt 不应增加 LLM context > 10%" | Scenario 6 mitigation 4 提到「混入不应增加回复长度超过 10%」但没说 prompt 注入本身的 token 开销限制 | **Low** |

P6 P8 P9 是有意义的。P7 是 race condition 已在 R13 覆盖。P10 是 token economy。

---

## 4. Concrete Architectural Risks（v3 增量 ≥ 5）

### R9. ambient_exposures 表清理（L=H, I=L）

无 retention 策略，5 年线性膨胀 2.7M 行。Planner R-V14 提到「如需清理 `lt db compact --keep-days 365`」—— **但 Task 23-25 没列这个子命令**，是 vapor mitigation。**Strengthen**: Adjustment G。

### R10. 80/20 pool 计算性能（L=M, I=M）

每个 UserPromptSubmit hook 都查 reviews 表 + 排序 stability。N=10K concepts 时 `ORDER BY RANDOM()` 是 O(N) full scan + sort，30-80ms。两个 pool 查询 + ambient_exposures batch INSERT 总计 60-160ms / hook。

**Strengthen**: 改用 `WHERE id IN (SELECT id FROM reviews ORDER BY RANDOM() LIMIT N)` 子查询 / 或预生成 mastered/weak pool 缓存表。

### R11. LLM 不遵守绝对数量（L=H, I=M）

即便 prompt 说"至多 3 个词"，LLM 也可能 0 个或 5 个。Planner 「事后 log 偏差统计」需要 post-process Claude 实际回复 parse 出现的目标语言词 —— Planner §12 自己说「极难可靠」 → 不是 mitigation 是 admit defeat。

**Strengthen**: prompt 末尾加 self-check "Before submitting, count how many times you mixed in {target_lang}. If > {ceil(level*10)}, reduce" + few-shot 示例至少 2 个（一个 0 词、一个 N 词）展示边界情况。

### R12. mastered/weak 定义漂移（L=M, I=M）

stability 阈值（7d/1d）写死在 CLI Planner D19b 实现。跨语言（韩语 vs 日语）可能不适用。

**Strengthen**: 把 `MASTERED_STABILITY_DAYS` 提升为 profile 字段 `per_language.{lang}.mastered_threshold_days`（默认 7），允许 phase 2 调优。

### R13. immersion_level 实时切换的 hook race（L=M, I=L）

用户输 `/lt mix 0` 那一刻 hook 已经为下个 prompt 注入了 mix 指令，下一轮才生效。用户感觉「关不掉」。

**Strengthen**: 加 `lt mix abort` 或纯 UX 教育「`lt mix 0` 后下次 prompt 生效」。

### R14. 跨语言 mix 的 cross-talk（L=L, I=H）

ambient_exposures 表无 language 字段，依赖 concepts.language 反查。cross-language analytics 不可能。

**Strengthen**: ambient_exposures 表加 `language TEXT NOT NULL`（冗余 concepts.language 但避免 JOIN）。

### R15. Phase 1.4 dogfood gating 实操问题（L=H, I=H）

如何检测「mastered pool 已 ≥ 20」？install.sh 怎么阻止用户在 Phase 1.0 dogfood 不足时 enable Phase 1.4？Planner 没说技术机制。

**Strengthen**: 不需要 gating —— Adjustment J 直接消除该问题。

---

## 5. Adjustments（v3 必加 ≥ 3，编号 G/H/I/J/K 接 v1 ABCDEF）

### Adjustment G — ambient_exposures retention + 清理子命令（R9, T6）

**Where**: Task 24 (`src/ambient.ts` + `src/cli.ts`)

**Change**:
- `src/ambient.ts` 加 `cleanOldExposures(beforeMs)` + `archiveExposures(beforeMs)`
- `src/db.ts` migrate v3 schema 加 `ambient_exposures_archive (concept_id, cumulative_count, archived_at)`
- `src/cli.ts` 加 `ambient-clean [--keep-days 90]` 子命令
- `daily-push` 检测 ambient_exposures.count > 100K 提示用户清理
- 默认 90 天 retention（覆盖 mock-test ≥ 7 次暴露窗口）

**Verify**: `tests/ambient-clean.test.ts` 插 200K 行 → ambient-clean --keep-days 90 → 旧行归档 + 新行保留 + 不影响 stats 查询。

### Adjustment H — immersion_level 离散化 5 档（T8, A2）

**Where**: Task 23 (profile.ts + cli.ts immersion 命令)

**Change**:
- profile schema：`immersion_level: number` 仅接受预设档位 `{0, 0.10, 0.25, 0.50, 1.00}` + 自定义 escape hatch
- `lt mix <preset>`: 接受 `0`/`10`/`25`/`50`/`100` 自动映射
- `lt mix --custom <0-100>`: escape hatch
- 老 immersion.flag 文件 → immersion_level=1.0 自动迁移

| 档 | 名称 | 行为 |
|---|---|---|
| 0 | off | 不注入任何指令 |
| 0.10 | 偶尔点缀 | ≤ 1 词替换 / 回复 |
| 0.25 | 频繁出现 | ≤ 2-3 词 / 回复 |
| 0.50 | 半混合 | ≤ 5 词 + 句子级 mix |
| 1.00 | 全沉浸 | 全日语 + 假名 + 中文译文附后 |

**Verify**: 输 35 → 报错「请用 0/10/25/50/100 或 --custom 35」。

### Adjustment I — D19 prompt 模板版本化（T5, R11）

**Where**: Task 25 skill markdown + skill loader

**Change**:
- skill markdown frontmatter `prompt_version: v1` + `prompt_max_tokens: 250`
- 每次改 prompt 模板必须 bump version
- `lt logs --event ambient_inject` 输出含 `prompt_version` 字段
- 后续 A/B test：dogfood 期间随机选 v1/v2 模板观察实际混入率

**Verify**: 改模板没 bump version → CI 报错。

### Adjustment J — Phase 1.4 提前到 1.1b（A3, T7, R15）

**Where**: §9 Phase 划分 + §8 任务依赖图

**Change**: 4 phase 重排（不是 5 phase）：

| Phase | 范围 | 估时 |
|---|---|---|
| **1.0** | Task 5.5-14（v1 + 5 Adjustments + 改名） | 18-26h |
| **1.1a** | Task 15-17（多语言） | 10-15h |
| **1.1b**（NEW，原 1.4） | Task 23-25（D19 ambient） | 9-12h |
| **1.2** | Task 18-19（TTS + 听力） | 5-7h |
| **1.3** | Task 20-22（讲解 + Linux + mock） | 7-10h |

总估时不变（51-73h）但 1.1b 在第 3-4 周落地（不是第 5 周）。D19 graceful skip 当 pool=0 → 用户体验是「ambient 渐进上线」。

### Adjustment K — looksLikeCodeContext 跨任务复用（D19c, P9）

**Where**: 新建 `src/utils/code-context.ts`

**Change**: 抽出 D6/D19 共用的代码上下文检测：
```typescript
export function looksLikeCodeContext(s: string): boolean {
  return /```|^import |\.dart\b|\.ts\b|\.tsx\b|\.py\b|\.go\b|\.rs\b|\bclass \w+|\bfunction \w+|\bconst \w+\s*=|\bdef \w+|\bfn \w+/.test(s);
}
export function looksLikeCodeContextStrict(s: string): boolean {
  return looksLikeCodeContext(s) || /^\$\s|^\#\s|^\>\s|^https?:\/\//.test(s.trim()) || /`[^`]+`/.test(s);
}
```

### Adjustment K1（条件性）— Phase 1.1b 落地后 30 天 mock-N2 验证（A1）

**Where**: §9 + ADR-005 follow-up

**Change**:
- Phase 1.1b 落地后 30 天 dogfood 期，每周跑 `/lt mock-test` 30 题
- 30 天后跑 mock-test report：「ambient 暴露 ≥ 7 次的概念 vs < 7 次 → 答对率对比 + p < 0.05 binomial test」
- 如果 ambient 组无显著提升（p > 0.05）→ ADR-005 标记 deprecated + 默认 immersion_level=0
- 如果显著提升 → ADR-005 升级 confirmed + Principle 9 从假设变成验证

---

## 6. Open Questions for Critic（v3 增量，最多 3）

### Q4. Phase 1.4 → Phase 1.1b 提前是否 binding？

**Architect 立场**: Yes, binding。Planner D19b graceful skip 决策与 §9 dogfood gating 决策互相矛盾，二选一必须 Critic 裁决。

**Recommendation**: 提前到 Phase 1.1b。

### Q5. immersion_level 离散化（5 档）vs continuous（0-1 浮点）？

**Architect 立场**: Yes, binding。离散 5 档。

**Recommendation**: Adjustment H 离散化。

### Q6. ambient_exposures 表 retention 默认值（90 天 / 1 年 / 不限）？

**Architect 立场**: 90 天默认 + `lt ambient-clean` 子命令 + 周报后归档。

**Recommendation**: 90 天理由：覆盖 §7.5 mock-test ≥ 7 次暴露效果度量窗口；防止表膨胀；Critic 可质疑 90 vs 180 vs 365 取舍。

---

## References

- `docs/ralplan-planner-v3.md:13` — v3 增量摘要（5 phase 串行 + D19 fold-in）
- `docs/ralplan-planner-v3.md:27` — Principle 9 「被动暴露优先于主动测验」 — P8 violation 候选
- `docs/ralplan-planner-v3.md:73-83` — D19-0 合并裁决 B（统一 immersion_level 谱系）— A2 antithesis 起点
- `docs/ralplan-planner-v3.md:117-154` — D19b 80/20 mastered/weak pool + graceful skip — A3 矛盾点
- `docs/ralplan-planner-v3.md:180-205` — D19d ambient_exposures schema + 查询 — R9/R10/R14 起点
- `docs/ralplan-planner-v3.md:240-253` — D19g 默认 mix_rate=0.10 + 手动调节 — T8 起点
- `docs/ralplan-planner-v3.md:454-466` — §9 Phase 1.4 reasoning — A3 + R15 起点
- `docs/ralplan-architect-v1.md:175-247` — v1 Adjustment A-F（编号延续到 G/H/I/J/K）
- `src/srs.ts:69-93` — recordAnswer 非事务（v1 Adjustment C 已修，v3 不变）
- `src/db.ts:13` — WAL 配置（v3 db v3 migrate 起点）

**Hand-off to Critic**: 5 adjustments (G/H/I/J/K) + 3 binding decisions (Q4/Q5/Q6)。
