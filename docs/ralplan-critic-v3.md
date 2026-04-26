# RALPLAN-DR Critic Verdict v3 — polyglot/lt

> Critic: opus (DELIBERATE mode + ADVERSARIAL escalation)
> Date: 2026-04-27
> Verdict: **ITERATE** (1 round 修订即可 APPROVE)

---

## Verdict

Plan v3 + Architect v3 共识 80% sound — D19 fold-in 方向正确，5 个新 Adjustment G-K 全部硬命中真问题。**ITERATE 而非 APPROVE**：3 binding decisions Q4 (Phase 1.4→1.1b) 是 Planner 内部矛盾（D19b graceful skip vs §9 dogfood gating）必须显式承认改写；Adjustment H 的"5 档预设"档位映射与 Scenario 6 mitigation 的"绝对数量上限 ceil(level*10)"在 0.50 档处冲突（标 ≤5 词但与 1.0 全沉浸体验断层）；Adjustment I 的 prompt 版本化和 K1 的 30 天 mock-N2 验证缺单独 task 编号。这些不是大改，但必须显式落地 Plan §8 任务表才能 APPROVE 进入 Executor。

---

## 5 Hard Checks

1. **Principle-Option consistency**: **PASS** — D19-0/D19a-D19g 每个 viable option 都能 trace 回 Principle 1 (零摩擦) / Principle 9 (被动暴露优先) / Driver 5 (长期记忆通过被动暴露)。无依据的删除。
2. **Fair alternatives**: **PASS** — D19-0 三选项 + 失败选项 invalidation 明确。D19a/b/d/e/f/g 每个 ≥2 选项 + 否决理由。无稻草人。
3. **Risk mitigation clarity**: **PARTIAL PASS** — R-V11/V14 等大部分有具体 mitigation + owner，但**两条 vapor**：
   - R-V12 mitigation "事后 log 偏差统计 → 偏差 > 50% 调 prompt 模板" — Plan §12 自己承认"记录实际替换需要 LLM 回复后 post-process parse（极难可靠）" → admit defeat
   - R-V14 mitigation "如需清理 `lt db compact --keep-days 365`" — 这个子命令在 Task 24 实现表里**没列**，是 future work 不是真 mitigation
4. **Testable acceptance**: **PASS** — Task 23-25 每个有具体 verify 命令。§7 test plan 四档齐全。
5. **Concrete verification**: **PASS** — §7.3 e2e 步骤 9-13 用户能照着复现。NDJSON 事件 schema 给具体 key/value。

## DELIBERATE Checks

- **pre-mortem**: **PASS** — 7 scenarios（v2 5 + v3 新增 2）。Scenario 6/7 mitigation 具体诚实。
- **expanded test plan**: **PASS** — §7.1 unit / §7.2 integration / §7.3 e2e / §7.4 observability / §7.5 mock-test 效果度量。四档齐全且**首次**有自我证伪机制。

---

## Q4-Q6 Bindings — Critic Verdict

### Q4: Phase 1.4 → Phase 1.1b 提前？— **YES**

**Reasoning**:
- Planner D19b §4.D19b 决策原文："pool_mastered 不足 12 个（初期）...空 pool → hook 不注入 ambient prompt（graceful degrade）" — 显式自我矛盾：既然空 pool graceful skip，§9 "Phase 1.4 放最后给 mastered pool 积累时间" 的理由就垮掉
- Architect A3 算 21-30 天才能积 20 mastered，Phase 1.4 第 5 周才落地 → 用户前 4 周完全感受不到 v3 ambient 价值
- Phase 1.1b（紧跟多语言）让 ambient 与多语言一起落地 + ambient_exposures.language 字段从一开始就有正确语义

### Q5: immersion_level 离散化 5 档 vs continuous？— **离散 5 档但带必要修正**

**Reasoning**:
- Architect H 立场对：`lt mix 23` 给精度幻觉但 LLM 行为只能离散
- Architect 给的 5 档 0.50 标 "≤5 词 + 句子级 mix" 与 1.00 "全日语 + 假名 + 中文译文附后" 之间体验巨大断层
- **Critic 改进**：5 档保留但**重定义**：

| 档 | 名称 | 行为 |
|---|---|---|
| 0 | off | 不注入 |
| 0.10 | 偶尔点缀 | ≤1 词 / 回复 |
| 0.25 | 常见词替换 | ≤3 词 / 回复 |
| **0.50** | **双语句法混合** | **短句尾整句日语 + 中文翻译附后**（介于词替换与全沉浸的中间态）|
| 1.00 | 全沉浸 | 全日语 + 假名 + 中文译文附后 |

- `lt mix --custom <0-100>` escape hatch 保留
- `lt mix 35` 报错信息加建议

### Q6: ambient_exposures retention 默认值？— **90 天 + `lt ambient-clean` 必须 Task 24 显式列出**

**Reasoning**:
- Architect 写"Planner 低估 15x"是错读：Planner 的 547K 是年量，2.7M 是 5 年量，乘 5 一致
- 90 天理由：覆盖 §7.5 mock-test ≥ 7 次暴露效果度量窗口；防止表膨胀 (~5MB 可控)；周报 13 期归档周期；365 天 stats 查询 N=10K concepts × 2.7M >100ms

---

## v3 Architect 5 新 Adjustments G-K — 充分性 Review

### G — ambient_exposures retention + cleanup: **NEEDS MORE**

**Issue**: Architect 给改动列表但**未在 Plan §8 任务表新增 task 行**。Executor 看 Plan §8 Task 24 不会知道要加 ambient-clean。
**Fix**: Plan §8 Task 24 表必须吸收（见 Q6 表格）。`ambient_exposures_archive` schema 必须加 PRIMARY KEY (concept_id, archived_at) 否则同一个 concept 多期归档会 collision。

### H — immersion_level 离散化 5 档: **NEEDS MORE**

**Issue**: 见 Q5 — 0.50 档行为定义不清楚。
**Fix**: Adjustment H 档位行为表第 4 行重定义"双语句法混合"；§4.D19a 实现链路扩展为四分支；新增 unit test 覆盖 0.50 档。

### I — prompt 模板版本化: **NEEDS MORE**

**Issue**: 给了机制但未指定 CI 检查放哪、检测算法、prompt_version 字段写到哪个文件。
**Fix**: Plan §8 Task 25 加：
- `skills/lt-mix.skill.md` frontmatter `prompt_version: v1` + `prompt_max_tokens: 250`
- `scripts/check-prompt-version.ts` git pre-commit hook 检测 prompt template hash 与 prompt_version 一致性
- NDJSON `ambient_inject` event 加 `prompt_version` 字段

### J — Phase 1.4 → Phase 1.1b: **PASS**

依赖图重画方案完备 — Task 17 (multi-lang hooks) → Task 23 (immersion_level) → Task 24 (ambient 词汇引擎) → Task 25 (可见性) → Task 18 (TTS macOS Phase 1.2 start)。

### K — looksLikeCodeContext utils: **PASS**

复用边界清晰，单元测试已在 §7.1 列出。

### K1 (条件性) — Phase 1.1b 30 天 mock-N2 验证: **NEEDS MORE**

**Issue**: 未指定单独 task 还是 fold 进 Task 22。
**Fix**: 单独 Task 26：

| Task | 内容 | Phase | 优先级 | 依赖 |
|---|---|---|---|---|
| **26 (NEW)** | K1: ambient 效果验证 — Phase 1.1b 落地后 30 天每周跑 mock-test 30 题；30 天后 `lt ambient-validate` binomial test (p<0.05) → ADR-005 confirmed/deprecated | **1.1b dogfood** | P1 | 25 |

理由：fold 进 Task 22 让其同时承担 N2 题库 + ambient 验证两个职责，违反单一任务原则。

---

## Independent Findings（Critic 独立挖的 7 项）

### 1. Code-vs-plan drift: profile.ts 缺 Adjustment F 字段（CONFIRMED, MINOR）

**Evidence**: `src/cli.ts:198-210` 实现了 `inject-decide`，但 `src/profile.ts:9-25` 没有 `inject_max_per_hour` / `inject_max_per_session` / `do_not_disturb_until`。Architect v1 P4 已标 Medium，v2 §4 D18 表第 248 行明确列为 Adjustment F 落地。
**v3 是否覆盖**: v3 §5 D18 表只在 v2 D18 基础上叠加 immersion_level/mix_mastered_ratio，未重述 Adjustment F → Executor 易忽视。
**Fix**: Plan §5 D18 表顶部加声明："以下表 v3 增量在 v2 §4 D18 已含 Adjustment A-F 字段基础上叠加；v2 字段不重复列出。"

### 2. 项目级 + 全局级 hook 双触发（CONFIRMED, MAJOR）

**Evidence**: 我自己的项目 git status 显示 `.claude/settings.json` 是 modified（项目级），同时 v1 Architect Risk #1 提到 `~/.claude/settings.json`（用户级）。Claude Code 实际行为是合并全局 + 项目级 hook 数组都 fire → 装了 lt 会被双倍轰炸。
**Plan 是否处理**: v1/v2/v3 Plan 都**没处理**。Plan §8 install 流程只装 `~/.claude/settings.json`，但 cwd 是 git repo 时 `.claude/settings.json` 也参与触发。
**Fix**:
- Plan §8 Task 12 (install.sh) 加 substep "12.7: 检测项目级 settings.json 冲突" — install 时检测当前目录是否 git repo + 存在 `.claude/settings.json`，扫描 'jp-trainer-hooks' / 'polyglot-hooks' / 'lt-' substring 提示用户审慎
- Task 22 之后加 Task 27 `lt doctor` 命令（v1 Architect Risk #4 提过但 v2/v3 都没落地）— 扫描 `~/.claude/settings.json` + cwd `.claude/settings.json` 检测 lt hook 重复并报告

### 3. 数据丢失场景（CONFIRMED, CRITICAL）

**Evidence**: v1 Plan §4 Scenario 2 mitigation #5 提到 "install 时自动建 `reviews.db.daily-backup-<date>` cron"，但 v1 §6 Task 8/Task 12 实现表里**没列**。v2 D18 / v3 §5 都不动这块 = vapor mitigation。
**Severity**: CRITICAL — 6 个月积累 ~150K rows attempts 表，mac 重装 / 磁盘 corrupt 全炸 = 用户两年 N2 准备成果归零 = 项目失败。
**Fix**: Plan §8 加 Task 5.5 子任务（fold 进 Adjustment C）：`scripts/daily-backup.sh` 写 `reviews.db.bak.<7-day-rolling>` + install.sh 自动注册 launchd 凌晨 2 点执行 + `lt restore --from <date>` 恢复命令。Phase 1.0 P0 不是 Phase 2 future。

### 4. 第一周用户体验（CONFIRMED gap, MINOR）

**Evidence**: D19g §250 onboarding 步骤问 "ambient 语言混入强度？（推荐 10-20%）"，用户设 mix_rate=0.10，但前 21 天 mastered pool 不足 → ambient 永远 skip → 用户不知道是"我设错了"还是"在等积累"。
**Fix**: Plan §4.D19g onboarding 问题改写加注释："（注意：前 21 天可能因词汇库未积累而暴露较少，`lt stats --ambient` 可查实际频次）"。`lt stats --ambient` 输出新增"诊断行"：当 exposure_count=0 时输出 "本周 0 次暴露 — 原因：mastered 词库 N=X < 12（积累中），或 mix=0（已关闭）"。

### 5. 跨设备同步（KNOWN, MINOR — Phase 3 deferred）

**Evidence**: v1 ADR-001 / design.md §15 Phase 3 deferred 已知。
**v3 新引入问题**: ambient_exposures 是新表 — 跨设备同步时如果不含此表，公司机 stats --ambient 显示 0 = inconsistent。
**Fix**: §12 Open Questions 加："Phase 3 iCloud 同步设计是否包含 ambient_exposures 表？INSERT 频次是 reviews 表的 15 倍，iCloud 文档 sync 频次跟得上吗？"

### 6. paths.ts CONFIG_DIR drift（CONFIRMED, CRITICAL）

**Evidence**: `src/paths.ts:5` 写 `export const CONFIG_DIR = join(HOME, ".config", "jp-trainer");`。v2/v3 暗示项目改名 polyglot/lt + log 路径 `~/.config/polyglot/`，但 paths.ts 改动**未在 v2/v3 D18 表列出**。
**Severity**: CRITICAL — 如果 paths.ts 改成 `polyglot/` → 现有用户 `~/.config/jp-trainer/reviews.db` "消失"（新代码读新路径不存在 → 自动创建空 db）= silent data loss！如果 paths.ts 不改 → README/文档/log 路径全和实际不符。
**Fix**: Plan §8 Task 14 (项目重命名) 必须显式列：
- `src/paths.ts:5-11` 改：CONFIG_DIR 优先读 `~/.config/polyglot/`（新路径），fallback 到 `~/.config/jp-trainer/`（老路径）
- 首次启动检测老路径存在 → mv 全目录到新路径 + 留 symlink + 写 NDJSON `{event: "config_dir_migrated"}`
- LOG_FILE 从 `jp.log` 改 `lt.log`
- 单测 `tests/paths-migration.test.ts`：老路径存在 → readProfile 自动迁移 → 老路径变 symlink

### 7. Phase 1.0 估时偏低（CONFIRMED, MINOR）

**Evidence**: v3 Plan §9 Phase 1.0 估时 "18-26h" 与 v1 一致，但 v2 + v3 在 Phase 1.0 多塞了 Adjustment A-F (v1 5 + F) + Task 5.5 数据完整性 + Task 14 项目重命名。
**Fix**: §9 Phase 1.0 估时改 22-31h（v1 18-26 + Adjustment 细化 ~1h + 重命名 2-3h + 数据完整性 1-2h）。

---

## If ITERATE: Required Revisions（12 项）

1. **§9 Phase 表**：删 Phase 1.4，加 Phase 1.1b（Adjustment J 落地）；§8 任务依赖图 Task 23-25 块从 Phase 1.4 改到 Phase 1.1b 紧跟 Task 17
2. **§4.D19-0 决策表**：第 4 档 0.50 行为重定义"双语句法混合"+ §4.D19a 实现链路扩展为四分支；新增 unit test
3. **§8 Task 24 表**加 Adjustment G 5 行新增改动（src/ambient.ts cleanOldExposures + cli.ts ambient-clean + db.ts archive 表 schema 含 PK + daily-push 提示 + tests）
4. **§8 Task 25 表**加 Adjustment I 3 行（skill markdown frontmatter prompt_version + scripts/check-prompt-version.ts CI hook + NDJSON 字段）
5. **§8 加 Task 26**：Adjustment K1 ambient 效果验证（Phase 1.1b dogfood + lt ambient-validate 子命令 + ADR-005 confirmed/deprecated 触发器）
6. **§8 Task 14 表**加 Independent #6 paths.ts 4 行（CONFIG_DIR 双路径 + LOG_FILE 改名 + 自动 mv migration + tests）
7. **§8 加 Task 5.5**：daily backup（scripts/daily-backup.sh + launchd cron + lt restore --from）— Independent #3 数据丢失防护，Phase 1.0 P0
8. **§8 Task 12 (install.sh) 加 substep 12.7**：项目级 settings.json 冲突检测 + Task 27 lt doctor — Independent #2，Phase 1.0 P0
9. **§9 Phase 1.0 估时改 22-31h** — Independent #7
10. **§12 Open Questions 加 4 条**：(a) Phase 3 iCloud sync 含 ambient_exposures，(b) prompt_version CI 算法，(c) 0.50 档 prompt template 设计，(d) Phase 1.1b mock-N2 含 production-side 题型
11. **§10 R-V14 mitigation 改写**：删 vapor 的 "lt db compact"，引用 Adjustment G 落地的 `lt ambient-clean` + 90 天 retention
12. **§5 D18 表顶部加声明**：v3 增量在 v2 §4 D18 已含 Adjustment A-F 基础上叠加 — 防 Executor 漏 Adjustment F

---

## Re-review 通过后推荐

**执行模式**: `/team` mode — Phase 1.0 + 1.1a + 1.1b 共 41-58h 横跨 4-6 周，单 executor 一次吃不下；team 按 phase 切片每个 phase 2-3 周交付一次 dogfood 反馈闭环

**Phase 1.0 优先开工任务清单**（按依赖顺序）:

1. **Task 5.5** — 数据完整性 hardening（v1 Adjustment C: srs.ts:69 transaction + db.ts busy_timeout=5000 + safeFail NDJSON）+ Independent #3 daily backup
2. **Task 6** — 种子题库 import（jonchang N5-N3 vocab + LLM N2 grammar 100-150 条）
3. **Task 7** — 5 个 skill markdown（含 v1 Adjustment E rubric）
4. **Task 8** — 3 个 hook（含 v1 Adjustment D shell pre-gate + Adjustment F profile 字段补全）
5. **Task 9** — 沉浸 + 关键词反问接线（fold 进 Task 8.3）
6. **Task 10** — launchd plist 模板（已 80% 在 cli.ts:258，需独立模板文件）
7. **Task 11** — Codex/Gemini snippet（v1 Adjustment B honest framing）
8. **Task 12** — install.sh + bun build（v1 Adjustment A schema-aware merge + Independent #2 项目级 settings 检测 + lt doctor）
9. **Task 13** — README + e2e demo
10. **Task 14** — 项目重命名 polyglot/lt（含 Independent #6 paths.ts 双路径迁移 + LOG_FILE rename）

**Phase 1.0 准入**: bun test 全绿 + e2e ja N3-N2 跑通 + jp alias 工作 + 老路径自动迁移到新路径测试通过 + 项目级 settings 冲突检测工作。

---

## References

- `src/paths.ts:5-11` — CONFIG_DIR drift CRITICAL evidence
- `src/profile.ts:9-25` — Adjustment F 缺字段（Independent #1）
- `src/srs.ts:69-93` — recordAnswer 非事务（v1 Adjustment C 待落地）
- `docs/ralplan-planner-v3.md:483` — R-V14 mitigation vapor 证据
- `docs/ralplan-planner-v3.md:152` — D19b graceful skip 与 §9 dogfood gating 内部矛盾
- `docs/ralplan-architect-v3.md` — 5 Adjustments G-K + 3 binding Q4-Q6

---

## 摘要

- **Verdict**: ITERATE — 1 round 修订即 APPROVE，无需 reset
- **3 关键修订**: paths.ts CONFIG_DIR 双路径迁移 / Phase 1.4→1.1b 重排 / Adjustment G/I/K1 落到 Plan §8 任务表
- **执行**: /team mode，Phase 1.0 优先 10 任务 22-31h
