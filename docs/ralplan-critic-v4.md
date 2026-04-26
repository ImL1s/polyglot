# RALPLAN-DR Critic Verdict v4 (FINAL) — polyglot/lt

> Critic: opus (final gate, ADVERSARIAL spot-check)
> Date: 2026-04-27
> Verdict: **APPROVE**（带 5 条 Phase 1.0 inline TODO；不需要 v5 iterate）

---

## Verdict（一句话）

v4 把 v3 critic 12 项 Required Revisions 100% 行级落实，3 项 CRITICAL（paths.ts / daily backup / lt doctor）spot-check 全部命中 v3 intent 且都进了 Task 表正确位置，Architect 4 条 non-blocking TODO 经独立裁决均确认 non-blocking — APPROVE 进 /team Phase 1.0 开工，剩余 polish 在 Phase 1.0 落地时由 executor inline 处理（含 Critic v4 新挖的 cli.ts 字面量 + WAL backup API 一项需 Planner v4.1 patch release 补一行）。

---

## A. 3 项 CRITICAL Fix 抽查验收

### Fix #6 (Independent #6) — paths.ts CONFIG_DIR 双路径迁移：**PASS（带 1 条 v4.1 patch 项）**

**v3 intent**（critic v3 §145-149）：「Plan §8 Task 14 必须显式列：CONFIG_DIR 双路径 + 自动 mv migration + LOG_FILE 改名 + tests」。

**v4 落实位置**：
- Plan §8 第 374 行 Task 14 字面列出 4 项：(a) CONFIG_DIR 双路径 polyglot/jp-trainer (b) mv + symlink + NDJSON `config_dir_migrated` (c) LOG_FILE rename (d) `tests/paths-migration.test.ts`
- §5 D18 表第 247 行 paths.ts 行复述
- §7.1 第 315 行 unit test + §7.2 第 330 行 integration test + §7.4 第 344 行 NDJSON sample — 三向 cross-ref

**Spot-check verdict**: PASS — Task 14 不是「角落里塞一句」，是行级 4 项实体清单，且 unit/integration/observability 三档测试同步覆盖。

**v4.1 patch 项**（Critic v4 新挖，**不阻塞 APPROVE**）：cli.ts 实际还残留 5 处 `jp-trainer` 字面量（cli.ts:231 seeds 路径注释 / cli.ts:252 osascript display notification title / cli.ts:267 LaunchAgents plist 路径 / cli.ts:273 plist Label / cli.ts:281-282 stdout/err path），v4 §5 D18 表只列了 `src/paths.ts` 一个文件，**漏列 cli.ts**。Executor 拿 v4 跑 Task 14 时若严格按 §5 D18 表只动 paths.ts → osascript 通知和 launchd plist label 仍叫 jp-trainer。建议 Planner 在 v4.1 §5 D18 表加一行：
```
| `src/cli.ts` | LaunchAgents plist Label/path/StandardOutPath 从 `com.jp-trainer.daily` / `/tmp/jp-trainer.*` 改 `com.polyglot.daily` / `/tmp/polyglot.*` + osascript notification title 改 `polyglot/lt` + seeds 路径注释 jp-trainer→polyglot | Critic v4 字面量补完 |
```

### Fix #7 (Independent #3) — daily backup：**PASS（带 1 条 architectural TODO，Architect 已 flag）**

**v3 intent**（critic v3 §126-128）：「Plan §8 加 Task 5.5 子任务：scripts/daily-backup.sh 写 reviews.db.bak.<7-day-rolling> + install.sh 自动注册 launchd 凌晨 2 点 + lt restore --from <date> 恢复命令 + Phase 1.0 P0 不是 Phase 2 future」。

**v4 落实位置**：
- Plan §8 第 365 行 Task 5.5 字面列出 5 项 (a)-(e)，(d)/(e) 显式 quote v3 critic 原话
- Phase 1.0 P0、依赖 5（已完成的 SQLite 集成）— 与 v3 critic「P0 不是 Phase 2」诉求一致
- §10 R-V14 mitigation 第 480 行删除 vapor `lt db compact` + 引用真 backup（fix #11）
- §7.2 第 332 行 integration test「daily backup + restore」端到端覆盖

**Spot-check verdict**: PASS — Task 5.5 的实体清单与 v3 critic §128 fix 描述一一对应，Phase/Priority 也精确符合「P0 不是 Phase 2 future」诉求。

**Architectural TODO**（Architect v4 §2 Fix #7 #4 已 flag）：daily-backup.sh 用 `cp` 还是 `sqlite3 .backup` API。**Critic v4 裁决**：见 §B TODO 1（NON-BLOCKING + 必须 v4.1 patch 一行明文）。

### Fix #8 (Independent #2) — lt doctor + 项目级 settings 检测：**PASS**

**v3 intent**（critic v3 §117-123）：「Plan §8 Task 12 (install.sh) 加 substep 12.7 + Task 22 之后加 Task 27 `lt doctor` 命令」。

**v4 落实位置**：
- Task 12 第 372 行 substep 12.7 字面：「检测 cwd `.claude/settings.json` 扫描 'jp-trainer-hooks' / 'polyglot-hooks' / 'lt-' substring 提示用户审慎」— 三个 substring 全列
- Task 27 第 382 行新行 `lt doctor`：扫双 settings 路径 + TTS + profile 版本 + active_language 一致性
- §7.2 第 331 + 333 行 integration test 双覆盖（install conflict + doctor）
- §7.4 第 348 行 NDJSON `doctor_check` event 含 duplicates 数组

**Spot-check verdict**: PASS — install-time（Task 12.7）+ user-invoked any-time（Task 27）双层覆盖，比 Critic v3 要求的「Task 22 之后」更强（v4 提前到 Phase 1.0 Task 12 之后）。Architect v4 的「strictly better not deviation」判断成立。

---

## B. Architect 4 条 TODO 裁决

| TODO | Architect 严重度 | Critic 裁决 | 理由 |
|---|---|---|---|
| **TODO 1**: daily-backup.sh 用 sqlite3 `.backup` API 而非 cp（WAL stale 风险） | Medium-architectural | **NON-BLOCKING + 要求 v4.1 patch** | WAL 模式下 `cp` 拿到 stale state 是真实数据完整性风险（Adj-C 在 Phase 1.0 同步落地，恰好 transaction + busy_timeout=5000 + WAL 配置全开 → 用 cp 备份必然遇到 -wal 不一致）。但这是 1 行 shell 改动（`sqlite3 reviews.db ".backup '$BACKUP'"` 替代 `cp`），Executor 若是经验丰富的 SQLite 开发者 99% 会自查文档发现，但**为防止 Executor 漏掉留下隐性 bug**，Critic 要求 Planner 在 v4.1 §5 D18 daily-backup.sh 行明确「使用 sqlite3 .backup API（WAL-aware online backup）而非 cp」。这是 1 句话补丁，不需要 v5 critic round。 |
| **TODO 2**: Task 26 sample size 30 vs Open Q (d) 暗示 60+ 内部矛盾 | Medium-statistical | **DEFER-TO-EXECUTOR**（Phase 1.1b dogfood 期间决定） | Architect 算的 binomial test power=0.30 是按 baseline 60% / improved 75% / n=15/组算的；但实际 Phase 1.1b 跑 Task 26 时 effect size 取决于真实 ambient 强度 + mock-test 题难度，dogfood 期间根据前 1-2 周数据校准 sample size 比 Plan 阶段拍脑袋更靠谱。Open Q (d) 已 flag 这个 unknown，§11 ADR-005 follow-up 写 "confirmed/deprecated" 也允许 Phase 1.1b 中途调整。Task 26 任务行 30 题数字是「初版 starting point」不是「正式 contract」，Executor 拿这个数字开工 + 30 天内根据实际 power 校准是合理路径。不阻塞 APPROVE。 |
| **TODO 3**: Task 27 dep=12 vs 依赖图 14→27 矛盾 | Low | **NON-BLOCKING + 要求 v4.1 patch** | Architect 的语义分析正确：Task 27 lt doctor 扫描 'lt-hooks' substring 必须在 Task 14 重命名后才能正确匹配（重命名前还叫 jp-trainer-hooks，Task 27 dep=12 只在 install.sh 完成后跑 doctor 但**重命名未做** → doctor 误报「无 lt-hook」实际有 jp-trainer-hooks）。这是单字符改动（Task 27 行的「依赖：12」改「依赖：14」），与依赖图第 408 行已画的 14→27 一致。1 行 patch，不阻塞 APPROVE 但**强烈建议** Planner v4.1 修。 |
| **TODO 4**: §7 顶部缺测试基础设施总览（bun test / fixtures / CI） | Low | **NON-BLOCKING** | bun test 自动 glob `tests/**/*.test.ts` 是 bun 默认行为，Executor 不会卡住；fixtures/ 路径是 1 句约定；CI 现状用 git pre-commit hook（v4 §5 D18 line 258 已写）+ Phase 2 Gitea Actions 是 Phase 1.0 之外。这条 TODO 是「润色完整性」诉求而非「Executor 没法开工」。Phase 1.0 Executor 跑 Task 5.5 第一次写 tests/ 时自然会建立目录约定。不需要阻塞或 patch。 |

**总结**：4 条 TODO 中 2 条要求 v4.1 patch（TODO 1 architectural + TODO 3 dep 修正），2 条不需要任何动作（TODO 2 dogfood 自校准 + TODO 4 自然形成）。**v4.1 patch 是单文档单 commit，不需要走 v5 ralplan round**。

---

## C. Critic 独立盲点（6 项）

### 1. paths.ts 老路径只覆盖 jp-trainer 一种 — **NON-ISSUE**

design.md 是项目第一份文档（看 git log + 看 docs/design.md 时间戳，line 1 项目名就叫 jp-trainer，没有更早 alpha 命名）。CONFIG_DIR 历史只有 `~/.config/jp-trainer` 一种（src/paths.ts:5 verified），fallback 只需覆盖这一个路径。**v4 双路径设计正确**。

### 2. daily backup 是否含 ambient_exposures + ambient_exposures_archive — **PASS（v4 已声明）**

ambient_exposures 在 reviews.db **同一文件**（D19d 第 184 行 schema CREATE TABLE 落在主 db），daily-backup.sh 备份整个 reviews.db 文件 = 自动含 ambient_exposures + ambient_exposures_archive。Plan §5 D18 第 255 行 `daily-backup.sh` 行明文「`ambient_exposures` 含在内」声明。**已覆盖**。

### 3. lt doctor 输出格式契约（JSON vs 文本，CI exit code）— **NON-BLOCKING（Phase 1.1+ 决定）**

Phase 1.0 MVP doctor 是 user-invoked 诊断工具不是 CI gate（Plan §8 Task 27 没说 doctor 在 CI 里跑）。NDJSON event `doctor_check` (§7.4 line 348) 已含结构化输出供 log 解析。MVP 期 stdout 文本人读 + NDJSON log 机器读双轨 = 够用。**CI 集成可在 Phase 2 加，不阻塞 Phase 1.0**。Open Q 已隐含覆盖（§12 line 532 prompt_version CI 算法那条和这条同性质）。

### 4. Phase 1.1b mock-test fixture 依赖 Phase 1.3 Task 22 — **CRITICAL gap，但 Architect 已部分覆盖**

**Critic v4 新挖**：Task 26（Phase 1.1b dogfood）需要 mock-test 30 题题库；但 Task 22「mock-test」在 Phase 1.3。Phase 1.1b 跑 Task 26 时 mock-test 题库还不存在！

**进一步分析**：Task 22（v3 plan §8）写「mock-test (Architect Risk #7)」— Architect Risk #7 在 v1 Architect 文档应该就是 hold-out pool 题库基础设施。如果 Task 22 = mock-test 系统总集合（含题库 + CLI + 报告），那 Phase 1.1b Task 26 需要 mock-test 题库 → Task 22 必须在 Task 26 之前。

**v4 §8 依赖图（line 391-433）**：Task 22 dep = Task 16（韩语 seeds，Phase 1.1a），所以 Task 22 实际可以 Phase 1.1a 末就跑（不必拖到 Phase 1.3）。但 §9 Phase 表（line 447）把 Task 22 划入 Phase 1.3，与 Phase 1.1b Task 26 的 mock-test 依赖矛盾。

**裁决**：**MAJOR gap，但 NON-BLOCKING APPROVE**。理由：
1. Task 26 在 §8 line 381 dep=25（不是 22），意味着 Planner 实际意图是 Task 26 自带题库（不复用 Task 22）—— 这与「mock-test 30 题」表面冲突但解释得通：Task 26 可以是 ambient 词汇专用 hold-out（30 个 mastered 词出 30 题），自给自足
2. Phase 1.0 不跑 Task 26 不跑 Task 22，Critic v4 的 APPROVE 是放 Phase 1.0 开工，这个矛盾在 Phase 1.1a→1.1b 衔接时才暴露

**要求 v4.1 patch**：Plan §8 Task 26 行明确「mock-test 30 题 hold-out 池来源 = Task 26 自建（30 个 mastered ambient 概念 × 1 题/概念）」**或**「依赖 Task 22 提前到 Phase 1.1a」二选一。Phase 1.1a 期间补这个决策完全来得及。

### 5. 5 phase × 4-6 周的 commit hygiene + team mode 多 agent 并发 — **NON-BLOCKING（执行细节）**

v4 Plan 没规定 git commit/PR 边界——这是 ralplan 范畴外的执行 protocol，不是 plan defect。/team 模式默认按 task spawn agent → 每个 task 一组 commit + Phase 末 PR 是常规模式。但要点：Phase 1.0 Task 5-13 之间高耦合（hooks + skills + install 共用 settings.json schema），**单 executor 串行更安全**比 multi-agent 并发；Phase 1.1a/1.1b/1.2/1.3 各自相对独立，可以 phase-internal 多 agent。

**记录在 §F 推荐执行模式**，不算 plan 缺陷。

### 6. 跨 worktree install 同一 hook 多次注册 — **PASS（Architect TODO 已 surface，且 lt doctor 已 cover 单 cwd 路径）**

Architect v4 §2 Fix #8 #1 已识别这个场景：「git worktree A/B/C 各一份 lt → doctor 在 cwd=A 跑只看 A」。Critic v4 同意 Architect 立场——MVP 阶段 doctor 只检测当前 cwd 是合理的 scope，且当用户在每个 worktree 跑 lt doctor 时都能检测各自的项目级 settings。Phase 1.0 不引入 `--scan-worktrees` flag，Phase 1.1+ 再扩展。**已被 Architect 充分讨论，无新独立发现**。

---

## D. v3 vs v4 self-continuity（7 项 Independent findings 是否落实）

| # | v3 Independent finding | v4 落实位置 | Critic v4 裁决 |
|---|---|---|---|
| **1** | profile.ts 缺 Adjustment F 字段（v2 D18 已含）— 防 Executor 漏看 | §5 D18 表第 240 行顶部声明 + 列出 v2 D18 全部字段名 | **PASS** — 声明位置正确（D18 表第一段顶部不是脚注），且明示 Executor 责任 |
| **2** | 项目级 + 全局级 hook 双触发 | Task 12.7（行 372）+ Task 27 lt doctor（行 382）+ §7.2 integration test（行 331/333）+ §7.4 NDJSON（行 348）| **PASS** — install-time 单点检测 + any-time CLI doctor 双轨，比 v3 critic 要求更完整 |
| **3** | 数据丢失场景（reviews.db 损坏 = 用户 N2 准备归零）| Task 5.5 (d)+(e)（行 365）`scripts/daily-backup.sh` + `lt restore` + Phase 1.0 P0 + §10 R-V14（行 480）| **PASS-with-TODO** — 落地齐全但 sqlite3 `.backup` vs `cp` 选择是 architectural decision，需 v4.1 一行 patch（见 §B TODO 1）|
| **4** | 第一周用户体验：mix=10 但 mastered=0 → 用户不知道为啥 0 暴露 | §4.D19g 第 233 行 onboarding 注释「前 21 天可能因词汇库未积累而暴露较少」+ §4.D19e 第 221 行 stats --ambient 诊断行「本周 0 次暴露 — 原因：mastered 词库 N=X < 12（积累中），或 mix=0（已关闭）」 | **PASS** — onboarding + 诊断行双轨覆盖，原文 quote 命中 v3 critic 措辞 |
| **5** | 跨设备同步：ambient_exposures INSERT 频次 15 倍，iCloud 跟得上吗 | §12 Open Q (a)（行 531）「Phase 3 iCloud 同步是否含 ambient_exposures 表」 | **PASS** — Phase 3 deferred 是合理决策（v3 critic 自己也归 MINOR），落到 Open Q 而非任务表是正确层级 |
| **6** | paths.ts CONFIG_DIR drift | Task 14（行 374）+ §5 D18（行 247）+ tests | **PASS-with-TODO** — paths.ts 完全落地，但 cli.ts 字面量遗漏（见 §A Fix #6 v4.1 patch 项）|
| **7** | Phase 1.0 估时偏低 18-26 → 22-31 | §9 Phase 表（行 443）+ §9 算式说明（行 449）| **PASS** — 估时增量算式 (v1 18-26 + Adj A-F 1h + Task 14 2-3h + Task 5.5 1-2h) 数学合理，但 Architect §1 Fix #9 nit 提到 Task 27 ~2h 未单列 — Critic v4 同意这是 minor，不要求 v4.1 patch（22-31 区间已含 ~2h 灵活度） |

**Self-continuity 总分**：7/7 PASS，2 项带 v4.1 TODO（#3 sqlite3 .backup + #6 cli.ts 字面量）。零 regression。

---

## E. Phase 1.0 准入 / 退出清单

### 进入条件（开工前必满足）

- [ ] Plan v4 已 commit 到 `docs/ralplan-planner-v4.md` ✓（已存在）
- [ ] Architect v4 已 APPROVE_FOR_CRITIC ✓（行 11 verdict）
- [ ] Critic v4 verdict APPROVE（本文件）
- [ ] Plan v4.1 patch（**软强制**，不阻塞但应在 /team 启动前 5 分钟内完成）：
  - [ ] §5 D18 表加 cli.ts 字面量行（jp-trainer→polyglot 在 launchd plist label / osascript title / stdout-err path / seeds 注释）
  - [ ] §5 D18 表 daily-backup.sh 行加「使用 sqlite3 .backup API 而非 cp（WAL-aware online backup）」
  - [ ] §8 Task 27 行「依赖：12」改「依赖：14」
- [ ] Phase 1.0 11 个任务 ID 锁定：5.5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 27
- [ ] /team agent spawn（5 agent 推荐，见 §F）
- [ ] git worktree 状态干净（`git status` 无未提交，避免 .claude/settings.json drift）

### 退出条件（Phase 1.0 完成判定）

- [ ] **测试**：`bun test` 全绿（含 paths-migration / ambient-clean / immersion-050 / 既有所有 tests）
- [ ] **e2e ja N3-N2**：手动跑 `lt /lt` 出题 + 答 + rating + FSRS 排期生效
- [ ] **jp alias 兼容**：`jp /lt` 仍可工作（v0.2.0 兼容声明）
- [ ] **paths 迁移**：手动建 `~/.config/jp-trainer/profile.yaml` + `reviews.db` → 跑 lt → 自动迁移到 `~/.config/polyglot/` + 老路径变 symlink + NDJSON `config_dir_migrated` 落盘
- [ ] **lt doctor 报告**：`lt doctor` stdout 输出（无 hook 重复 / TTS macOS 可用 / profile 版本 ok / active_language=ja 与 immersion 一致）
- [ ] **install.sh 项目级冲突检测**：cwd 有 `.claude/settings.json` 含 'lt-' substring → install.sh 提示用户审慎
- [ ] **daily backup cron**：`launchctl list | grep com.polyglot.daily.backup` 显示 cron 已注册（02:00 触发）+ `lt restore --from <date>` 可恢复
- [ ] **ARB rebase 验证、commit hygiene**（按项目 pre-commit hook）
- [ ] **v4.1 patch 项全 absorbed 到代码**（cli.ts 字面量 = polyglot / sqlite3 .backup API / Task 27 dep=14 在 Plan 已修）

---

## F. 推荐执行模式

### `/team` mode（**首选**）

**配置**：5 agent 并行，按 Phase 1.0 任务依赖图分组：

| Agent | 任务包 | 依赖 fan-in 点 |
|---|---|---|
| **agent-A**（infra）| Task 5.5（数据完整性 + daily backup）→ Task 14（rename + paths migration）| 5 → 5.5 → 14（串行 within agent）|
| **agent-B**（content）| Task 6（seeds）→ Task 7（skills）| 5.5 → 6 → 7 |
| **agent-C**（hooks）| Task 8（hooks）→ Task 9（沉浸 wire）| 7 → 8 → 9 |
| **agent-D**（ops）| Task 10（launchd）+ Task 11（codex/gemini）| 8 |
| **agent-E**（integration）| Task 12（install + 12.7）→ Task 13（README）→ Task 27（lt doctor）| 6+7+8+9+10+11 → 12 → 13 → 14（agent-A）→ 27 |

**Commit protocol**：
- Each agent 自己 worktree（`git worktree add ../jp-trainer-task5.5` 等）防止 settings.json drift
- 每完成 1 task → bun test 局部绿 → commit → push branch
- Phase 1.0 末单 PR 合并（5 agent 各自 branch → integration branch → PR to main）
- pre-commit hook 跑 bun test + check-prompt-version.ts（Task 25 的 hook 提前在 Phase 1.0 落地是可选的）

**Review**：`/team` 自带 reviewer agent；Phase 1.0 末额外走 1 轮 Codex review（按本仓库习惯：feedback_team_means_native_team.md）。

**预计交付**：22-31h dev × 5 agent 并行 + integration overhead → 实际 6-10 工日。

### `/ralph` 备选条件（什么情况退化到 sequential）

**触发条件**：
1. /team 启动时 spawn agent 失败（环境问题）
2. Phase 1.0 中途某个 agent 反复出错（>3 次 retry 仍 fail）→ stop /team，剩余任务 ralph mode 单线程兜底
3. 用户手动指定（"我想看到每一步"）

**ralph 配置**：单 executor + verifier review 每 task 末，按依赖图严格串行。慢但安全，估时 22-31h × 1.3 (single-thread overhead) = 28-40h。

### 直接 executor（**不推荐**）

适用：用户只想跑 1-2 个特定 task（如 Task 14 paths migration 单跑）。

**Why not 推荐**：
- Phase 1.0 11 任务有跨 task 集成测试（e.g. Task 12 install.sh 需 Task 6/7/8/9/10/11 全部就位才能装到 ~/.local/bin/lt）
- 直接 executor 没 reviewer pass → 违反 OMC `<execution_protocols>` "Never self-approve"
- 22-31h 工时单 session 风险高（context 爆 / 中途打断）

---

## G. ADR Draft (final)

### ADR-005（v4 Critic verdict 确认）：polyglot/lt — D6 沉浸与 D19 ambient 合并 + 4 phase 重排 + 数据完整性 hardening

**Decision**:

1. **immersion_level 5 档谱系**（D19-0）：profile.immersion_level: float ∈ {0, 0.10, 0.25, 0.50, 1.00} 替代 v2 boolean immersion_default + v3 mix_rate 双 flag。0.50 档新定义为「双语句法混合」（短句尾整句目标语言 + 中文翻译紧随）。
2. **词汇来源 80% mastered + 20% weak**（D19b），graceful skip on 空 pool。
3. **独立 ambient_exposures + ambient_exposures_archive 表**（D19d + Adj-G），不计入 FSRS，PK = (concept_id, archived_at)，90 天 retention by `lt ambient-clean`。
4. **LLM 替换用绝对数量上限 + 句末括号 + few-shot**（D19a），prompt 版本化 by frontmatter prompt_version + git pre-commit hook（Adj-I）。
5. **Phase 重排 1.4 → 1.1b**：D19 ambient 紧跟 Phase 1.1a 多语言落地，利用 graceful skip 的渐进上线特性（v3 critic fix #1 / v4 §9 重写）。
6. **数据完整性 hardening**（v3 critic Independent #3）：Phase 1.0 P0 加 `scripts/daily-backup.sh`（launchd 凌晨 2 点 + sqlite3 `.backup` WAL-aware API + 7-day rolling）+ `lt restore --from <date>`。
7. **paths.ts CONFIG_DIR 双路径 + 自动 mv migration**（v3 critic Independent #6）：优先 `~/.config/polyglot/` + fallback `~/.config/jp-trainer/`，首次启动 mv 全目录 + 留 symlink + NDJSON 事件。
8. **lt doctor 命令**（v3 critic Independent #2 / Adj-I）：扫双 settings 路径检测 hook 重复 + TTS backend + profile 版本 + active_language 一致性。

**Drivers**: 零摩擦 (Principle 1) > 数据可恢复性 > 长期记忆通过被动暴露 (Driver 5) > FSRS 信号纯度 > 可观测性。

**Alternatives invalidated**:
- 独立并行 D6 + D19 双 flag（状态矩阵冲突无定义）
- LLM 自由选词无清单（不可控 + 替换错误词）
- FSRS rating=3 passive review（污染 elapsed_days）
- 百分比替换（LLM 不精确执行）
- 自动加压 mix_rate（用户失控感）
- Phase 1.4 deferred（与 D19b graceful skip 自相矛盾 + 5 周不可见 v3 卖点）
- daily backup 用 cp（WAL 模式下 stale state，**v4.1 patch 强制 sqlite3 .backup**）

**Consequences**:
- ✓ `lt mix 25` 一行开启 / `lt mix 0` 一行关
- ✓ graceful skip 安全 + progressive disclosure
- ✓ paths 自动迁移零数据丢失
- ✓ daily backup + restore = 6 个月积累不归零
- ✓ lt doctor 一键体检全栈
- ✗ LLM 不精确 → 靠 few-shot + prompt_version 追踪补偿
- ✗ mastered pool 初期不足 → 静默跳过（已设计 stats 诊断行）
- ✗ Phase 1.1b 30 天 dogfood 拉长 v0.4.0 release timeline → 已在 §9 估时分离

**Follow-ups**:
- Phase 1.1b Task 26 30 天 mock-test binomial test → ADR-005 confirmed/deprecated
- Plan v4.1 patch（cli.ts 字面量 + sqlite3 .backup API + Task 27 dep=14）
- §12 Open Q (a)-(d) Phase 1.1b dogfood 期间逐项收敛
- Phase 3 iCloud 跨设备同步（含 ambient_exposures） — design.md §15 deferred

---

## 摘要（回报给用户）

### (1) Verdict 一句话

**APPROVE** — v4 把 v3 critic 12 项 100% 行级落实，3 项 CRITICAL 抽查全 PASS，Architect 4 条 TODO 经裁决均 NON-BLOCKING，进 /team Phase 1.0 开工，剩余 5 条 v4.1 polish 由 Planner 单文档 patch + Phase 1.0 executor inline 处理（不需要 v5 ralplan round）。

### (2) Phase 1.0 优先开工 11 任务清单

按依赖顺序 + agent 分配：

1. **Task 5.5** (P0, agent-A) — 数据完整性 + daily backup（**v4.1 patch: 改用 sqlite3 .backup API**）
2. **Task 6** (P0, agent-B) — 种子题库 import (jonchang N5-N2 + LLM N2 grammar 100-150)
3. **Task 7** (P0, agent-B) — 5 个 skill markdown（含 Adj-E rubric）
4. **Task 8** (P0, agent-C) — 3 个 hook（含 Adj-D shell pre-gate + Adj-F profile）
5. **Task 9** (P1, agent-C) — 沉浸 + 关键词反问 wire（fold 进 Task 8.3）
6. **Task 10** (P2, agent-D) — launchd plist 模板（**v4.1 patch: Label 改 com.polyglot.daily**）
7. **Task 11** (P1, agent-D) — Codex/Gemini snippet（Adj-B honest framing）
8. **Task 12** (P0, agent-E) — install.sh + bun build + substep 12.7 项目级 settings 检测
9. **Task 13** (P0, agent-E) — README + e2e demo
10. **Task 14** (P0, agent-A) — 项目重命名 polyglot/lt + paths.ts 双路径 + **v4.1 patch: cli.ts 4 处 jp-trainer 字面量同步改 polyglot**
11. **Task 27** (P0, agent-E) — lt doctor 命令（**v4.1 patch: 依赖改 14 不是 12**）

**Phase 1.0 准入退出清单**：见 §E。

### (3) 推荐执行模式

**首选**: `/team` mode 5 agent 并行（infra/content/hooks/ops/integration）+ git worktree 隔离 + 每 task 末 bun test 局部绿 + Phase 1.0 末单 PR + Codex review pass。预计 6-10 工日。

**备选**: ralph mode（/team spawn 失败时退化到 sequential，22-40h 单线程）。

### (4) 文件路径

**Critic v4 verdict 文档**：`/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-critic-v4.md`

**v4.1 patch 应改的文档**：`/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md`（仅 §5 D18 表 2 行 + §8 Task 27 依赖字段 1 行 = 3 行改动，1 commit）

---

## References

- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:14` — v4 增量摘要 6 项变更
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:75-95` — D19-0 5 档表 + 0.50 双语句法重定义
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:108-133` — D19a 实现链路四分支
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:194-208` — D19d ambient_exposures + archive PK + ambient-clean
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:240` — §5 D18 表顶部 Critic fix #12 声明
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:247` — paths.ts 双路径 + 迁移行
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:255-258` — daily-backup.sh / check-prompt-version.ts / lt-mix skill frontmatter
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:359-388` — §8 任务表 27 任务（含 Task 5.5 / 14 / 26 / 27 行）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:391-433` — §8 任务依赖图
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:439-449` — §9 Phase 表 + Phase 1.0 估时
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:480` — R-V14 mitigation 改写
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:530-534` — §12 Open Q v4 新增 4 条
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:540-552` — §13 Final Checklist
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-architect-v4.md:11` — Architect APPROVE_FOR_CRITIC verdict
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-architect-v4.md:147-166` — Architect §2 daily backup PARTIAL（cp vs sqlite3 .backup）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-architect-v4.md:228-240` — Architect §3 Regression #5 Task 26 sample size OPEN
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-architect-v4.md:266-269` — Architect §4 Ready #2 Task 27 dep 矛盾
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-critic-v3.md:158-171` — 12 项 Required Revisions 来源
- `/Users/setsuna-new/Documents/jp-trainer/src/paths.ts:5` — CONFIG_DIR 老路径 verified
- `/Users/setsuna-new/Documents/jp-trainer/src/profile.ts:9-25` — Adj-F 缺字段 verified
- `/Users/setsuna-new/Documents/jp-trainer/src/cli.ts:231,252,267,273,281-282` — cli.ts jp-trainer 字面量 verified（v4.1 patch 漏点）

---

*Critic v4 escalation level*: ADVERSARIAL spot-check（逐条 v3 critic intent 比对 + 独立挖 6 项 + 1 项 MAJOR gap 发现 #4 mock-test fixture）。无 CRITICAL 新发现，APPROVE 进 /team。
