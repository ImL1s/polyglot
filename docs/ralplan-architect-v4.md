# RALPLAN-DR Architect Review v4 — polyglot/lt

> Architect: opus (verification mode)
> Date: 2026-04-27
> Verdict: **APPROVE_FOR_CRITIC**（带 4 条 non-blocking 行级 nit 给 Critic v4 收尾）

---

## Verdict（一句话）

v4 把 Critic v3 的 12 项 Required Revisions **全部行级落实**到 §4/§5/§7/§8/§9/§10/§12，3 项 CRITICAL（paths.ts 双路径 / daily backup / lt doctor）抽查均通过架构 sanity check，未引入新 architectural regression；4 个候选 regression 点经验证不构成阻塞，剩余 4 条 nit（NEEDS-MORE 在边缘——retention 幂等 / wal cp 一致性 / Task 26 sample size / 0.50 prompt template 文本）应作为 Phase 1.0 开工时的 inline TODO，而不应阻塞 Critic v4 给 APPROVE 走 /team。

**统计**：12 项 Critic fix → **12 PASS / 0 NEEDS-MORE / 0 FAIL**（落实层面 100%）；3 项 CRITICAL 抽查 → **2 PASS / 1 PARTIAL**（daily backup 缺 WAL `.backup` API 选择说明）；5 个候选 regression → **4 PASS / 1 OPEN**（Task 26 sample size 已在 Open Q (d) flag 但 Task 26 任务行未 update sample size = 6 题或 60 题）；4 项 readiness → **4 PASS**。

---

## 1. 12 项 Fix 落实验证（逐条 PASS/NEEDS-MORE/FAIL）

### Fix #1 — §9 Phase 1.4→1.1b + §8 依赖图重画 → **PASS**

**Evidence**:
- §9 表第 444-446 行：Phase 1.0 / 1.1a / **1.1b**（Task 23-26）/ 1.2 / 1.3 — 4 phase 重排已落地，**Phase 1.4 已删除**
- §9 第 451-463 行新增整段「为什么 D19 放 Phase 1.1b 而不再是 Phase 1.4」，显式承认 v3 dogfood gating 与 D19b graceful skip 自相矛盾，列出 4 条 1.1b 紧跟 1.1a 的理由 + Alternative invalidation 段
- §8 任务依赖图第 391-433 行：Phase 1.1b 块 Task 23 → 24 → 25 → 26 串行，Phase 1.2 仍由 Task 18 (TTS) 起步且 Task 17 是其前置（不再依赖 Phase 1.4 完成）

**Architect verify**：依赖链无环，Phase 1.1b 入口 Task 23 的 dep 是 Task 17（multi-lang hooks），出口 Task 26 不阻塞 Phase 1.2 起步（Phase 1.2 Task 18 dep = Task 15 schema migration，与 1.1b 并行可行）。Critic v3 fix #1 落实正确。

### Fix #2 — §4 D19-0 0.50 档「双语句法混合」+ D19a 四分支 + 0.50 unit test → **PASS**

**Evidence**:
- §4 D19-0 第 82 行表第 4 行明文：「**0.50 双语句法混合 — 短句尾以整句目标语言呈现 + 中文翻译紧随**（例："这个 bug 修好了。このバグは直りました。"）— 介于词替换与全沉浸的中间态」
- §4 D19a 第 108-133 行实现链路扩展为**四分支**：=0 / =1.00 / **=0.50 双语句法 prompt** / =0.10 或 0.25 ambient mix prompt — 0.50 分支 prompt template 完整列出，含 looksLikeCodeContext gate
- §7.1 第 312 行：`tests/immersion-050.test.ts` — 「level=0.50 → prompt template 输出含「双语句法」指令 + 示例格式」
- §8 Task 23 第 378 行明文「UserPromptSubmit hook **四分支**处理（=0 / 0.10\|0.25 ambient / 0.50 双语句法 / 1.0 全沉浸）+ tests/immersion-050.test.ts 覆盖 0.50 档 prompt」

**Architect verify**：四分支路径互斥（=0 → 短路、=1.00 → 全沉浸 prompt 路径与 0.10/0.25/0.50 分支无重叠），Critic 重定义 0.50 档「断层修复」诉求满足。

### Fix #3 — §8 Task 24 加 Adj-G 5 行 → **PASS**

**Evidence**:
- §8 Task 24 第 379 行内含全部 5 项：(a) `src/ambient.ts` 加 `cleanOldExposures` + `archiveExposures`；(b) `db v3 ambient_exposures` 表；(c) `ambient_exposures_archive` 表 **PK: (concept_id, archived_at)**；(d) `lt ambient-clean [--keep-days 90]` CLI；(e) `daily-push` 检测 >100K 提示；(f) `tests/ambient-clean.test.ts`（200K 行归档测试）
- §4 D19d 第 194-202 行 SQL DDL 显式列 `PRIMARY KEY (concept_id, archived_at)` — collision 避免落地
- §5 D18 表第 249 行也复述了 ambient.ts 的 `cleanOldExposures + archiveExposures` 函数签名

**Architect verify**：PK 选择 `(concept_id, archived_at)` 允许同一 concept 多次归档（每次 archive 增加一行），与 archive 语义一致。Critic v3 fix #3 落实正确。

### Fix #4 — §8 Task 25 加 Adj-I 3 行 → **PASS**

**Evidence**:
- §8 Task 25 第 380 行明文 3 项：(a) `/lt-mix` skill **frontmatter `prompt_version: v1` + `prompt_max_tokens: 250`**；(b) `scripts/check-prompt-version.ts` **pre-commit hook**；(c) **NDJSON `ambient_inject` event 加 `prompt_version` 字段**
- §5 D18 表第 257-258 行复述
- §7.4 第 345 行 NDJSON sample 含 `"prompt_version":"v1"` 字段

**Architect verify**：3 项均在 Task 25 行级列出，与 §5 D18 表 cross-ref 一致。Critic v3 fix #4 落实正确。

### Fix #5 — §8 加 Task 26 ambient 效果验证 → **PASS**

**Evidence**:
- §8 第 381 行新行：「**26 (NEW)** 【Critic fix #5 / Adj-K1】ambient 效果验证：Phase 1.1b 落地后 30 天每周跑 mock-test 30 题 + cron 自动统计 + `lt ambient-validate` binomial test (p<0.05) → ADR-005 confirmed/deprecated」
- §9 表 1.1b 行第 446 行：估时 `9-12h + 30 天 dogfood`，明示 Task 26 dogfood 期不计入 dev work 估时
- §11 ADR-005 第 506 行 follow-up：「Phase 1.1b 30 天 mock-test 验证（Task 26 / K1）→ confirmed/deprecated」

**Architect verify**：Task 26 单独成行（不 fold 进 Task 22），Phase 标 `1.1b dogfood`、依赖 25、估时与开发工时分离 — Critic v3 fix #5 「单独 task 编号」诉求满足。

### Fix #6 — §8 Task 14 加 paths.ts 4 行 → **PASS**

**Evidence**:
- §8 Task 14 第 374 行明文 4 项：(a) `src/paths.ts` CONFIG_DIR **双路径**（优先 `~/.config/polyglot/` fallback `~/.config/jp-trainer/`）；(b) **首次启动 mv + symlink + NDJSON logged**；(c) **LOG_FILE `jp.log` → `lt.log`**；(d) **`tests/paths-migration.test.ts`**
- §5 D18 表第 247 行 paths.ts 行复述
- §7.1 第 315 行 unit test + §7.2 第 330 行 integration test 双覆盖

**Architect verify**：4 项均在 Task 14 行级列出，与 §5 D18 表 + §7 test plan 三向 cross-ref 一致。Critic v3 fix #6 (Independent #6) 落实正确。**但 §2 抽查发现 mv 原子性 / 幂等性细节缺失，标 PARTIAL，下文 Section 2 详述（不阻塞 PASS 落实判定，因为 Critic v3 没要求落到任务行级别）。**

### Fix #7 — §8 加 Task 5.5 daily backup → **PASS**

**Evidence**:
- §8 Task 5.5 第 365 行明文 5 项：(a) srs.ts:69 transaction；(b) db.ts WAL 配置；(c) safeFail NDJSON；(d) **`scripts/daily-backup.sh` 写 `reviews.db.bak.<7-day-rolling>` + install.sh 注册 launchd 凌晨 2 点**；(e) **`lt restore --from <date>` 恢复命令**
- Phase 标 1.0、优先级 P0、依赖 5（已完成的 SQLite + ts-fsrs 集成）
- §10 R-V14 第 480 行 mitigation 已删 vapor `lt db compact`，引用 Adj-G `lt ambient-clean`

**Architect verify**：daily backup 进 Phase 1.0 P0、cron 注册写在 install.sh 内（Task 12 衔接）、restore CLI 公开。Critic v3 fix #7 (Independent #3) 落实正确。**但 §2 抽查发现 retention 滚动策略 + WAL cp 一致性 + ambient_exposures 含在备份内 三项细节缺失，下文 Section 2 详述。**

### Fix #8 — §8 Task 12 加 12.7 + Task 27 lt doctor → **PASS**

**Evidence**:
- §8 Task 12 第 372 行明文「substep 12.7：检测 cwd `.claude/settings.json` 扫描 'jp-trainer-hooks' / 'polyglot-hooks' / 'lt-' substring 提示用户审慎」
- §8 第 382 行新行 Task 27：「`lt doctor` 命令：扫描 `~/.claude/settings.json` + cwd `.claude/settings.json` 检测 lt hook 重复并报告 + TTS backend 诊断 + profile 版本检测 + active_language vs immersion flag 一致性」
- §8 任务依赖图第 408 行：Task 27 在 Task 14 之后（与 Critic v3 「Task 22 之后加 Task 27」一致 — Task 22 在 Phase 1.3，Task 14 在 Phase 1.0；v4 把 doctor 提前到 Phase 1.0 是 strictly better，不算偏离 fix #8）

**Architect verify**：install-time 检测（12.7）+ user-invoked any-time 检测（doctor）双层覆盖。Critic v3 fix #8 (Independent #2) 落实正确。**但 §2 抽查发现「跨 worktree 检测 / 修复建议 / 误报防护」三项细节缺失，下文 Section 2 详述。**

### Fix #9 — §9 Phase 1.0 估时 22-31h，总 55-77h → **PASS**

**Evidence**:
- §9 表 Phase 1.0 第 443 行：「**22-31h**」
- §9 第 449 行 Critic fix #9 标注：「Phase 1.0 估时 22-31h（v1 18-26 + Adj A-F 细化 ~1h + Task 14 重命名 2-3h + Task 5.5 数据完整性+backup 1-2h）。**总估时 55-77h**（不含 Task 26 的 30 天 dogfood 等待期）」
- v3 总估时 51-73h；v4 总 55-77h = +4h（与 Phase 1.0 +4h 一致，Phase 1.1a/1.1b/1.2/1.3 时长不变）

**Architect verify**：估时增量与新增任务（5.5 daily backup +1-2h、14 paths migration +1h、27 lt doctor 推断 ~2h 但 v4 估时表未单列 — 可能 fold 进 Phase 1.0 总时。**轻微 nit**：Task 27 估时未在第 449 行的算式里出现，建议 Critic v4 让 Planner 在 §9 算式补一行 `+ Task 27 lt doctor ~2h`，使 Phase 1.0 估时算式完整。不阻塞 PASS。

### Fix #10 — §12 Open Questions 加 4 条 → **PASS**

**Evidence**:
- §12 第 530-534 行明确小节「【Critic fix #10】v4 新增 4 条」，逐条列出 (a) Phase 3 iCloud sync 含 ambient_exposures、(b) prompt_version CI 算法、(c) 0.50 档 prompt template 设计、(d) Phase 1.1b mock-N2 含 production-side 题型
- 每条带具体 quantitative 描述（INSERT 频次 15 倍、binomial test 统计功效等）

**Architect verify**：4 条 Open Q 与 Critic v3 fix #10 列出的 4 条 (a-d) 一一对应。落实正确。

### Fix #11 — §10 R-V14 mitigation 改写 → **PASS**

**Evidence**:
- §10 表第 480 行 R-V14 mitigation 改写：「**【Critic fix #11】`lt ambient-clean [--keep-days 90]` + archive 表（Adj-G）+ daily-push >100K 提示**（删除 vapor 的 "lt db compact"）」 — vapor 已显式删除并替换为 Task 24 实落地的 `lt ambient-clean`
- Owner 改为 Task 24（与新 mitigation 实现位置一致）

**Architect verify**：vapor 删 + 新 mitigation 引用真实 Task — Critic v3 fix #11 落实正确。

### Fix #12 — §5 D18 表顶部加声明 → **PASS**

**Evidence**:
- §5 第 240 行明文：「**【Critic fix #12】声明：以下 v3/v4 增量在 v2 §4 D18 已含 Adjustment A-F 字段（version 2 + active_language + per_language + inject_max_per_hour + inject_max_per_session + do_not_disturb_until + tts_engine + tts_voice_overrides + tts_on_* 等）基础上叠加；v2 字段不重复列出。Executor 落地 profile.ts 时必须同时包含 v2 D18 表全部字段。**」
- 列出了 Adjustment F 所有具体字段名，避免 Executor 仅看 v4 D18 增量表漏掉 inject_max_per_hour 等

**Architect verify**：声明位置在 §5 表第一段（顶部），明确 Executor 责任 — Critic v3 fix #12 落实正确。

---

## 2. Fix 是否真解决原始问题（3 项 CRITICAL 抽查）

### CRITICAL Fix #6 — paths.ts CONFIG_DIR drift：**PASS-ish (覆盖 50%, 4 个细节 NEEDS-MORE)**

**v4 §8 Task 14 / §5 D18 / §7.1+§7.2 tests 已覆盖**：
- ✓ 双路径优先级（优先 polyglot fallback jp-trainer）
- ✓ mv migration + symlink
- ✓ NDJSON `config_dir_migrated` 事件
- ✓ LOG_FILE 改名
- ✓ paths-migration.test.ts unit + integration

**NEEDS-MORE 细节**（应作为 Critic v4 给 Planner 的 inline TODO，不阻塞 APPROVE_FOR_CRITIC）：

1. **mv 原子性**：v4 Task 14 写 `mv` 但未明确「mv 中途失败（部分文件已移、部分未移）」的 recovery。**建议**：Plan §4/§5 加一句「mv 走 try/catch；失败则保留原路径不创建 symlink + NDJSON `config_dir_migrate_failed` event 让用户手工处理」。
2. **多次启动幂等**：第二次启动检测到 symlink 已存在不应重复 mv。**建议**：paths.ts:CONFIG_DIR 解析时先 `lstat` 判断老路径是 symlink 还是 dir；symlink → 跳过 mv（已迁移）；dir → 走 mv + 创建 symlink。Plan §5 paths.ts 行只说「优先读 + fallback + mv」未明确这个判断分支。
3. **lt.log 内容合并**：老 jp.log 存在 + 新 lt.log 不存在 → mv jp.log 到 lt.log 是 append 还是 overwrite？**建议**：mv 整个 CONFIG_DIR 时 jp.log 自动跟过来（path 同一目录下），重命名为 lt.log = append 不存在（mv 是 atomic rename）。但 Plan 应澄清 lt.log 是否独立文件还是 mv 后改名。
4. **profile.yaml 用户已手动改过**：用户在 `~/.config/jp-trainer/profile.yaml` 手动改过 — mv 整目录会保留改动，但是否会触发 v3→v4 schema migration（profile.version 字段升 + 字段补全）？**建议**：mv 后立即触发 `readProfile()` → 触发 v3→v4 migration 逻辑（已有 v1→v2 patten 复用）。

**架构裁决**：以上 4 项是「细节充分性」而非「设计缺陷」。Critic v3 fix #1 的核心诉求（避免 silent data loss）已完全达成，剩余是 Executor 层 polish。**PASS（带 4 条 inline TODO）**。

### CRITICAL Fix #7 — daily backup：**PARTIAL PASS（3 个细节 NEEDS-MORE，1 个 architectural concern）**

**v4 §8 Task 5.5 已覆盖**：
- ✓ scripts/daily-backup.sh 写 `reviews.db.bak.<7-day-rolling>`
- ✓ launchd 凌晨 2 点
- ✓ `lt restore --from <date>` 命令

**NEEDS-MORE 细节**：

1. **Retention 策略**：「7-day-rolling」字面意义是 7 天滚动，但 implementation 是 `bak.YYYYMMDD` 7 个文件覆盖循环，还是 `bak.<weekday>` (Mon/Tue/.../Sun) 7 个固定名？**建议**：Plan §5 D18 daily-backup.sh 行明确 naming convention，避免 Executor 选错（前者更易看历史日期，后者文件数恒定）。
2. **备份 location**：v4 §5 D18 第 255 行只说「`reviews.db.bak.<7-day-rolling>`」未指定父目录。同盘 ~/.config/polyglot/ 还是 ~/Library/Application Support/polyglot/backups/？前者磁盘 corrupt 时一起没；后者跨数据卷分离更安全但需新建目录。**建议**：放 ~/Library/Application Support/polyglot/backups/（与 macOS 惯例一致 + 跨盘一定程度防护）。
3. **lt restore 原子性**：「中途崩溃留下 partial restore」—— restore 应该是 (a) cp bak 到 tmp 路径 → (b) integrity check (`sqlite3 .schema`) → (c) atomic rename 到 reviews.db。Plan 未明确这个 3-step 流程。**建议**：Plan §5 D18 lt restore 行加「3-step atomic restore」描述。

**Architectural concern**（NEEDS-MORE 但实际是 fix #7 + Adj-C 交互）：

4. **WAL 模式下 cp reviews.db 是否 consistent**：SQLite WAL 模式下，`cp reviews.db` 不会拷贝 `-wal` 文件 → 备份是「上次 checkpoint 时的状态」。如果 daily backup cron 在 Phase 1.0 Adj-C 写入事务进行中触发，可能拷到 stale state（不损坏，但缺最近未 checkpoint 的写入）。**正确做法**：daily-backup.sh 用 `sqlite3 reviews.db ".backup '$BACKUP_PATH'"` API（SQLite native online backup，自动处理 WAL 一致性）而非 `cp`。**建议**：Plan §5 D18 daily-backup.sh 行明确「使用 sqlite3 .backup API 而非 cp」。

5. **ambient_exposures 表是否含在备份内**：reviews.db 是单一文件 → daily-backup.sh 备份整个文件 → ambient_exposures 自动含在内。**架构上 PASS**，无需额外处理。但 Plan 可以一句话明示「reviews.db.bak 含所有 v3 表（attempts / reviews / ambient_exposures / ambient_exposures_archive）」让 Executor 不二次怀疑。

**架构裁决**：core 落地（cron + script + restore）齐全，但 sqlite3 `.backup` vs `cp` 的选择是 architectural-level 决定，应在 Plan 层级明确而非留给 Executor 临场判断。**PARTIAL PASS（标 1 项 architectural NEEDS-MORE 给 Critic v4 让 Planner 补一句话）**。

### CRITICAL Fix #8 — lt doctor + 项目级 settings 检测：**PASS（3 个细节 NEEDS-MORE）**

**v4 §8 Task 12 + Task 27 已覆盖**：
- ✓ install.sh 12.7 检测 cwd .claude/settings.json
- ✓ lt doctor 扫描 ~/.claude + cwd .claude
- ✓ TTS backend 诊断 + profile 版本检测 + active_language 一致性

**NEEDS-MORE 细节**：

1. **跨 worktree 检测**：用户 git worktree 多个 cwd（worktree A/B/C）每个 cwd 都装过 lt → doctor 在 cwd=A 跑只看 A 的 .claude/settings.json，看不到 B/C。**建议**：doctor 加 `--scan-worktrees` flag，遍历 `git worktree list` 输出的所有路径检查 .claude/settings.json。**或**：明确 doctor 只检查 cwd（不跨 worktree），让用户在每个 worktree 跑一次。Plan 应澄清这一立场。
2. **修复建议（auto-fix）**：v4 Task 27 只说「检测重复并报告」未说能否 `lt doctor --fix` 自动删除项目级冲突项。**建议**：MVP 阶段 doctor 只检测 + 给修复指令字符串（如「执行 `jq 'del(.hooks.Stop[] | select(.command | contains("lt-")))' .claude/settings.json`」），不 auto-fix（避免误删）。Plan §5 D18 lt doctor 行应明示「report-only 不 auto-fix」。
3. **误报防护（用户故意装两份 lt）**：用户在 work/personal worktree 各装一份 lt 且配不同 profile（语言 ja vs ko）—— doctor 报「重复」但实际是合法配置。**建议**：doctor 区分「同一 lt-hook 跨 settings 重复（误报，应警告）」vs「不同语言 profile 但共享 hook（合法，不报）」。技术上 doctor 检测 hook command 字符串里的 active_language 参数，相同 → 报警，不同 → 不报。Plan §5 D18 lt doctor 行应加这个 disambiguation 逻辑。

**架构裁决**：core 落地（双层检测）齐全，3 项细节是 polish — Phase 1.0 MVP 可以「report only + 单 cwd + 不分 active_language」交付，Phase 1.1+ 再扩展。**PASS（带 3 条 inline TODO）**。

---

## 3. v4 新 regression 检查（5 个候选点）

### Regression candidate 1 — Phase 1.4→1.1b 重排是否引入新 risk → **PASS**

**v4 reasoning（§9 第 451-463 行）合理**：
- D19b graceful skip 设计明确 pool=0 → hook 不注入 → log `ambient_skip:empty_pool` → 用户无感知
- 「渐进上线」给用户「ambient 随学习渐渐生效」的体验，是 progressive disclosure 而非 broken UX
- 独立回滚仍可行（1.1b 翻车只回滚 Task 23-25 不影响 1.0）

**Architect 额外验证**（D19a 四分支的 = 0 分支被新触发频次 vs hook overhead）：
- v4 的 hook 入口是 `hooks/user-prompt-submit.ts`（v1 Adj-D 已有 shell pre-gate）
- shell 在 immersion_level=0 时**不调用 bun**（profile 读取在 shell 层 awk 完成）
- 因此 = 0 分支的 hook overhead = ~5ms shell awk + grep，与 v3 持平
- **无 regression**

### Regression candidate 2 — 0.50 档「双语句法混合」prompt 跨语言通用性 → **PASS-ish (1 nit)**

**v4 §4.D19a 第 113-120 行 0.50 prompt template**：
- 例句用日语：「这个 bug 修好了。このバグは直りました。」
- prompt 里用 `{active_language}` 占位符 — **架构上**支持跨语言

**Nit**：例句固定日语，韩语用户看到「(范例为日语)」可能困惑。**建议**：Plan §12 Open Q (c) 已 flag「0.50 档 prompt template 具体设计 — Phase 1.1b 实测调优」覆盖此问题，但可强调「跨 active_language 各准备一组 few-shot 例句」。**不阻塞 PASS**。

**§7.1 unit test 覆盖性**：`tests/immersion-050.test.ts` 在 §7.1 第 312 行只说「level=0.50 → prompt template 输出含「双语句法」指令 + 示例格式」—— **未明示 active_language=ja/ko 各跑一次**。**建议**：Critic v4 让 Planner 在 §7.1 加一条「parameterize over active_language ∈ {ja, ko, en}」。

### Regression candidate 3 — Task 27 lt doctor 与 Task 12 install.sh 12.7 重复 → **PASS**

**两者职责清晰**：
- Task 12.7：install **at install time** 一次性检测项目级 settings 冲突（防止安装时静默重复）
- Task 27：doctor **at any time user-invoked** 检测重复（防止 install 后用户手动改 settings 引入冲突）

**no overlap**：install.sh 不调用 lt doctor，doctor 不调用 install。**self-update**：用户改完 settings 后下次跑 doctor 自然检测最新 — 设计无 race。

**架构无 regression**。

### Regression candidate 4 — Task 5.5 daily backup 与 Adj-C transaction wrap 交互 → **PARTIAL（已在 §2 详述）**

**concern**：daily backup cron 触发时如果 transaction 在跑 — SQLite WAL 模式下 `cp` 拿到的是 stale state。
**正确解**：用 `sqlite3 .backup` API（automatically WAL-aware）。
**v4 现状**：未明确选 `cp` 还是 `.backup`。

**裁决**：见 §2 Fix #7 PARTIAL 项 #4。

### Regression candidate 5 — Task 26 ambient 效果验证 binomial test 30 题 → **OPEN**

**§7.5 + §8 Task 26 设计**：30 题 mock-test，分 ambient ≥7 次 vs <7 次两组 → 每组 ~15 题 binomial test。

**统计 power 问题**：
- 假设 baseline 答对率 60%，ambient 提升到 75% — n=15 时 binomial test power ≈ 0.30（远低于 0.80 标准）
- 即便 ambient 真有效也很可能 p > 0.05 → ADR-005 误标 deprecated → 自我证伪机制触发误信号

**§12 Open Q (d) 第 534 行**已 flag「sample size 可能需要 60+」，但 §8 Task 26 任务行（第 381 行）仍写「30 题」，未 update。

**裁决**：v4 内部不一致 — Task 26 写 30 题 + Open Q (d) 暗示要扩 60+，Executor 拿到 v4 不知道按 30 还是 60 干。**建议 Critic v4 让 Planner 二选一**：(a) Task 26 改写「30 题/周 × 4 周 = 120 题累计」（每周不重复 → 30 题 hold-out 池要扩到 ≥120 题）；(b) Task 26 改写「60 题/周」（hold-out 池要 ≥240 题）；(c) 接受弱 power 但 ADR-005 触发条件改为「30 天后 effect size ≥ 0.15」（不靠 p < 0.05）。

**这是 v4 唯一明确的内部矛盾**，但仍 non-blocking：Phase 1.1b dogfood 期间 Task 26 sample size 可以在 Phase 1.0/1.1a 跑的时候由 Critic v4 让 Planner 补一行决策。**OPEN，不 reject**。

---

## 4. /team Phase 1.0 ready check（4 项 readiness）

### Ready check #1 — Phase 1.0 任务清单完整 → **PASS**

**Phase 1.0 任务**：5.5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 27 = 11 个任务（与 §9 表第 443 行「Task 5.5-14, 27」一致）。

**verify 命令具体度抽查**：
- Task 5.5 verify：`bun test tests/srs.test.ts` + `lt restore --from 20260427` 跑回 — 具体到 CLI
- Task 14 verify：`bun test tests/paths-migration.test.ts` + 手动 mv ~/.config/jp-trainer 后跑 lt → 老路径自动迁移到新路径
- Task 27 verify：`lt doctor` 输出含「duplicates: ['Stop:polyglot-hooks/stop.sh']」（§7.4 NDJSON sample 第 348 行已显示）
- Task 12 verify：cwd 有 .claude/settings.json 含 lt hook → install.sh 检测 + 报告（§7.2 第 331 行 integration test）

**verify 抽象 vs 具体**：每个 Phase 1.0 任务都有具体 CLI / test file 命令，**无抽象「跑测」陈述**。Critic v3 §7 「四档齐全」评级在 v4 保留。**PASS**。

### Ready check #2 — 依赖图无环 → **PASS**

**§8 第 391-433 行依赖图**（Phase 1.0 部分）：
```
5.5 → 6 → 7 → 8 → {9, 10, 11} → 12 → 13 → 14 → 27
```
- 所有任务串行 + Task 9/10/11 三并行 fan-out 后 fan-in 12 — 标准 DAG
- 27 在 14 之后，14 dep on 12 — 27 dep on 12（Task 27 行第 382 行明示）

**裁决**：依赖图无环，Task 12 → 27 → 14 vs Task 12 → 14 → 27 二选一在 v4 选了 12 → 14 → 27（§8 任务依赖图第 401-408 行）—— 与 §8 任务行第 382 行 Task 27 dep=12 不一致（Task 27 dep=12 但依赖图画 14 → 27）。

**轻微 nit**：Task 27 dep 应该是 14（项目重命名后才有 lt-hook substring 可扫），不是 12。Task 27 任务行第 382 行写「依赖：12」，依赖图画「14 → 27」 — 二者矛盾。**建议 Critic v4 让 Planner 把 Task 27 dep 改 14**（与依赖图一致，且语义上正确：先重命名再扫 lt-hook substring）。

**裁决**：依赖图本身无环，但 Task 27 dep 与依赖图冲突需修正。**PASS（带 1 条 inline 修正建议）**。

### Ready check #3 — 执行顺序无 ambiguity → **PASS**

**team agent 拿到 v4 plan 知道开工顺序**：
- §8 任务依赖图 + 优先级（P0 / P1 / P2）双重指引
- Phase 1.0 内全部 P0（除了 Task 9 P1、Task 10 P2、Task 11 P1）—— P1/P2 可推后但不阻塞 dogfood
- 「**Phase 1.0 准入**: bun test 全绿 + e2e ja N3-N2 跑通 + jp alias 工作 + 老路径迁移测试 + lt doctor 报告 + daily backup cron 注册」（v4 第 575-576 行）—— 准入条件具体可验证

**裁决**：执行顺序清晰，Critic v3 「Re-review 通过后 Phase 1.0 优先开工任务清单 10 项」与 v4 §14 第 575 行准入清单一致（v4 加了 27 = 11 项）。**PASS**。

### Ready check #4 — 测试基础设施齐全 → **PASS（1 nit）**

**§7.1 unit / §7.2 integration / §7.3 e2e / §7.4 observability / §7.5 mock-test 五档**：
- **bun test 跑哪个目录**：v4 §7 未显式说「`bun test` 跑 tests/ 整个目录」—— Executor 默认行为（bun test 自动 glob `tests/**/*.test.ts`）正确，但未 spell out
- **CI 怎么跑**：v4 §5 D18 第 258 行写 `scripts/check-prompt-version.ts` 是 git pre-commit hook —— 但是 GitHub Actions / Gitea CI 没提
- **test fixture 数据从哪来**：§7.1 第 310-316 行各 unit test 描述了 case，未提 fixture 文件路径（如 `tests/fixtures/profile-v1.yaml`）

**Nit**：v4 测试基础设施在 task plan 层够用，但缺一行「`tests/` 目录约定 + bun test workflow」总览。**建议 Critic v4 让 Planner 在 §7 顶部加一段「测试基础设施约定」**：
- 测试运行：`bun test`（自动 glob tests/**/*.test.ts）
- Fixture 路径：tests/fixtures/
- Pre-commit：lefthook 或 husky 跑 `bun test --bail` + check-prompt-version.ts
- CI：（开放 — Phase 1.0 暂用 local pre-commit + Phase 2 加 Gitea Actions）

**裁决**：基础设施可以 inferred 出来，Executor 拿 v4 能开工 — 但「无歧义」诉求需要 1 段总览。**PASS（带 1 条 inline 改进建议）**。

---

## 5. Architect 给 Critic 的 binding decisions（如有）

**无新 binding decision**。

v3 Architect 5 个 Adjustments G/H/I/J/K + 3 binding Q4/Q5/Q6 在 v4 全部以行级 fix 落地（验证见 §1）。Critic v3 12 项 Required Revisions 在 v4 100% 落实（验证见 §1）。

Architect v4 不引入新决策，只 surface 4 条 inline TODO 给 Critic v4 让 Planner 在 v5（如需）补充。这些 TODO 都是 polish 层面，**Phase 1.0 Executor 拿 v4 开工不会被 block**：

| TODO | Section | 严重度 | 阻塞 Phase 1.0？ |
|---|---|---|---|
| daily-backup.sh 用 `sqlite3 .backup` API 而非 cp | §2 Fix #7 #4 | Medium-architectural | 否（Executor 默认应该会查文档发现 cp 在 WAL 下不安全） |
| Task 26 sample size = 30 vs 60 vs 120 | §3 Regression #5 | Medium-statistical | 否（Phase 1.0 不跑 Task 26，Phase 1.1b dogfood 才跑） |
| Task 27 dep 改 14（与依赖图一致） | §4 Ready #2 | Low | 否（Executor 看依赖图执行就行） |
| §7 顶部加测试基础设施总览 | §4 Ready #4 | Low | 否 |

---

## 6. References

- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:14` — v4 增量摘要 6 项变更
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:75-95` — D19-0 5 档表 + 0.50 双语句法重定义（fix #2）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:108-133` — D19a 实现链路四分支（fix #2）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:194-208` — D19d ambient_exposures + archive PK + ambient-clean（fix #3 / Adj-G）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:240` — §5 D18 表顶部 Critic fix #12 声明
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:247` — paths.ts 双路径 + 迁移行（fix #1 CRITICAL）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:255-258` — daily-backup.sh / check-prompt-version.ts / lt-mix skill frontmatter（fix #2 / fix #4 / Adj-I）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:359-388` — §8 任务表 27 任务（含 Task 5.5 / 14 / 26 / 27 行）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:391-433` — §8 任务依赖图 v4
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:439-449` — §9 Phase 表 4 phase + Phase 1.0 估时 22-31h（fix #1 / fix #9）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:451-463` — §9 Phase 1.4→1.1b 理由（fix #1）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:480` — R-V14 mitigation 改写（fix #11）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:530-534` — §12 Open Q v4 新增 4 条（fix #10）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-planner-v4.md:540-552` — §13 Final Checklist（12 项 fix self-attest）
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-critic-v3.md:158-171` — 12 项 Required Revisions 来源
- `/Users/setsuna-new/Documents/jp-trainer/docs/ralplan-architect-v3.md:163-249` — 5 Adjustments G-K
- `/Users/setsuna-new/Documents/jp-trainer/src/paths.ts:1-12` — 老 paths.ts（仍未改，符合 v4 「src/*.ts 不动」声明）
- `/Users/setsuna-new/Documents/jp-trainer/src/profile.ts:9-25` — 老 Profile interface（待 Adj-F + immersion_level 落地）

---

## Hand-off to Critic v4

**Architect verdict**: APPROVE_FOR_CRITIC

12 项 fix 全 PASS，3 项 CRITICAL 抽查 2 PASS / 1 PARTIAL（daily backup 用 cp 还是 sqlite3 .backup），5 个候选 regression 4 PASS / 1 OPEN（Task 26 sample size），4 项 readiness 全 PASS（Task 27 dep 改 14 是 1-行修正）。

**Critic v4 应做的事**：
1. 给 Planner 让其在 v4 → v4.1（patch release）补 4 条 inline TODO（§5 表）
2. 给 final APPROVE 让 /team 按 §14 Phase 1.0 准入清单开工
3. **不要** reset 走 v5 — v4 已经吃透 v3 全部反馈，没新 architectural surprise
