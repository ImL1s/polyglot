# RALPLAN-DR Architect Review — jp-trainer Planner v1

> Architect: opus
> Date: 2026-04-27
> Verdict: **Continue with adjustments** (DELIBERATE mode)

---

## Verdict (one line)

Planner v1 is architecturally sound at the macro level (CLI engine + skills + hooks + SQLite single-source-of-truth), but **5 concrete adjustments** must land before Executor begins Task 6.

## Top 3 Must-Fix (highest impact on success)

1. **Hook settings.json schema is a moving target — the merge script must detect and emit both legacy flat and nested-array forms** (current user-level `~/.claude/settings.json` mixes both; pushing only one form silently breaks the dispatcher chain). See §4 Risk #1 + §5 Adjustment A.
2. **Cross-tool single-source-of-truth is partially false advertising** — Codex/Gemini have no hook layer, so "FSRS 排期共享" only works for `jp` CLI calls, not for spontaneously injected practice. Need explicit principle restatement + UX honesty in onboarding. See §3 Violation P2 + §5 Adjustment B.
3. **`recordAnswer` in `srs.ts:69-93` is two non-transactional writes** (UPDATE reviews + INSERT attempts). With cross-process WAL contention, a Ctrl-C between statements leaves attempt-without-review-update or vice versa. Plan §4 Scenario 2 mentions this, but Task 8 step plan doesn't list the patch. See §4 Risk #3 + §5 Adjustment C.

---

## 1. Steelman Antithesis (3 strongest counter-paths)

### A1. "Just use Anki + AnkiConnect MCP — wheel reinvention is engineering waste"

**Strongest defense**: Anki has 15 years of SRS research, ~200k vocab/grammar decks for JLPT, mobile sync, audio TTS, image occlusion, hint masking, custom card templates with HTML/JS. AnkiConnect exposes the entire DB as JSON-RPC. A Claude Code skill could literally be 80 lines: `/jp` → call `findCards "is:due deck:N2"` → read card → render → user answers → call `addReview cardID ease`. Same FSRS-5 (Anki has it native since 23.10), same single source of truth, same cross-tool (any LLM can hit AnkiConnect over localhost:8765).

**Architect rebuttal**: not fatal because:
- AnkiConnect requires Anki desktop running — violates Principle 1 (zero friction); user has to launch Anki
- Anki cards are static rendered HTML — kills D1's mixed-mode advantage (LLM-generated question variation per attempt)
- AnkiConnect is HTTP localhost only — hooks would still need a bridge
- Decks are user-curated and noisy; same N2 grammar exists in 5 decks with different IDs → no stable concept_id
- License/distribution: shipping a curated deck with AnkiConnect dependency is heavier than shipping a 25MB single-binary CLI

**Verdict**: not fatal, but Planner should add ADR §8 "Alternatives considered" line: `Anki + AnkiConnect → rejected because requires Anki running (zero-friction violation) + cards are HTML-rendered (loses D1 mixed-mode benefit)`.

### A2. "Hook injection on every Stop will degrade Claude Code session experience and induce uninstall"

**Strongest defense**: bun cold-start (30-50ms) + SQLite open + FSRS query + JSON serialize ≈ 100-200ms. Even at `inject_rate=0.15`, the hook **always runs** (the dice roll happens inside the hook); only injection is gated. Three guaranteed bun spawns per turn × 100 prompts/day × 50ms = 15s/day pure overhead.

**Architect rebuttal**: not fatal but **mandates Adjustment D**: hook entry-point is `.sh` with shell-side gate, only invokes bun when the gate passes. Plan must amend Task 8 step 8.5 from "hook 都 chmod +x，每个开头 #!/usr/bin/env bun" to "shell wrapper does pre-roll dice + work-hours check; bun called only when needed".

### A3. "LLM-generated questions are inconsistent — same concept might be MCQ one turn, free recall the next, with wildly different difficulty calibration → FSRS rating becomes meaningless noise"

**Strongest defense**: FSRS-5 trusts that "rating 3" always means roughly the same level of recall confidence. If LLM evaluates differently across sessions (lenient vs strict), card stability/difficulty trajectory is garbage. Static decks (Anki, Bunpro) have calibrated rubrics per card type — you don't.

**Architect rebuttal**: this is **the deepest unfixed flaw**. Plan acknowledges abstractly (likelihood M, impact L) but proposed mitigation "concept_id hash 做题型轮换种子" is wrong:
1. Hashing makes question-type stable per concept forever, killing D1's variation benefit
2. Even if type is stable, LLM grading rubric isn't anchored

**Mandates Adjustment E**: store evaluation rubric per concept type, skill prompt enforces "rate using rubric: rating_3 = ...".

### Synthesis

None of the three antitheses kills the project. Each surfaces a real adjustment:
- A1 → ADR §8 must explicitly reject Anki with reasoning
- A2 → Task 8 wrap with shell pre-gate
- A3 → Task 7 skill markdown must include rubric template per type

---

## 2. Tradeoff Tensions (4 unresolved)

### T1. "依附工作流不打断" vs "留下学习痕迹"

Hook design is opt-out by inject_rate; success means user **doesn't notice** training is happening. Collides with Driver 3 (N2 通过率): without **felt progress**, motivation drops and user disables hooks before training accumulates. `jp daily-push` only sends "今日 N 题待复习" (cli.ts:243-255), which is task list not progress.

**Trap**: design biased toward minimizing intrusion at expense of motivation feedback. Phase 1 will technically work and emotionally fail.

**Adequacy**: insufficient. Need weekly digest mechanism — cron pushes Friday "本周已答 23 题，正确率 68%, 攻克 N2 概念 +5".

### T2. "LLM 现场生成 → 题型多样" vs "FSRS 排期需要稳定 difficulty signal"

Already covered in A3. Cleanest reading: D1 chose mixed mode for cross-tool stability of concept_id, but didn't extend the contract to rubric. If LLM acts as both renderer AND grader, it must do both consistently.

**Trap**: plan conflates "题型多样" (good UX) with "评分自由" (bad signal). They can be decoupled: question type randomized per attempt, but grading rubric anchored.

### T3. "Cross-tool 单一真相" vs "Codex/Gemini 没 hooks → 实际只有手动 /jp"

Plan §1 Principle 2 + §9 Codex section claim shared db = shared experience. Technically true but functionally misleading — value prop is "any tool nudges you", but only Claude users get nudges.

**Trap**: marketing/principle drift. Cross-tool selling point is half real.

**Adequacy**: marginal. Principle 2 should be downgraded to "**reviews.db is single source for any tool that runs `jp`; only Claude Code has automatic injection**".

### T4. "失败安全 silent fail" vs "用户调试 hook 不工作怎么排查"

Principle 5 says hooks must silent-fail (exit 0, empty additionalContext). Risk Scenario 3 mentions debugging — but how would user even know hooks fired? `~/.config/jp-trainer/jp.log` mentioned in §5.4 Observability with NDJSON events. Task 8 step 8.2-8.4 doesn't explicitly list "log every hook entry/exit event".

**Trap**: silent-fail without observable trail = unfixable production bug class.

**Adequacy**: enforce `hooks/lib/common.ts:safeFail()` always logs to NDJSON before returning. Add `jp logs --hook stop` filter.

---

## 3. Principle Violations (DELIBERATE mode)

| # | Principle | Violation | Severity | Where |
|---|---|---|---|---|
| **P1** | "依附工作流不打断" | Bun cold-start unconditionally on every Stop/PromptSubmit/PostToolUse — 85%+ invocations do nothing but cost 50-150ms each | **High** | Task 8 step 8.5 — Adjustment D |
| **P2** | "错题本是单一真相 跨 Claude/Codex/Gemini/CLI 共享" | True for db reads, false for automatic injection. Misleading framing. | **Medium** | Plan §1 Principle 2 — Adjustment B |
| **P3** | "CLI 是核心引擎，LLM 是渲染层" | LLM is also evaluation layer (rates 1-4) but not constrained by CLI-side rubric. Drift breaks FSRS calibration. | **High** | Task 7 — Adjustment E |
| **P4** | "概率触发 + 工作时间感知" | `inject_max_per_hour` / `inject_max_per_session` promised in Plan §3 D2 but missing from Profile schema profile.ts:9-25 | **Medium** | profile.ts gap — Adjustment F |
| **P5** | "失败安全 + 可一键关闭" | "可一键关闭" interpreted as "edit settings.json delete entry" — install.sh §12 doesn't ship `jp uninstall-hooks` CLI subcommand | **Low** | Task 12 — minor polish |

P3 and P1 are the meaningful ones. P2 is honesty. P4 is a schema-drift bug. P5 is polish.

---

## 4. Concrete Architectural Risks

### Risk #1 — settings.json schema mixing breaks dispatcher (L=H, I=H)

`~/.claude/settings.json` (user-level) uses **flat form**: `{ "matcher": "Bash", "command": "..." }`. `customer-im-client/.claude/settings.json` (project) uses **nested form**: `{ "matcher": "...", "hooks": [{"type":"command",...}] }`. Mixing schemas inside the same event array is undefined behavior.

`scripts/install-hooks.mjs` (Task 12 step 12.2) describes "push a hook entry" with no schema discriminator. If existing settings.json has flat-form hooks for the same event, appended nested-form entry may either silently disable existing hooks or be silently skipped.

- **Mitigation in plan**: D5 says "幂等检测 hook 已存在则 skip" — checks `command` substring. Doesn't address schema-form coexistence.
- **Strengthen**: install-hooks.mjs must (a) detect existing schema form per event, (b) emit matching form, (c) refuse if mixed. Add `tests/integration/install.test.ts` covering both schemas + mixed.

### Risk #2 — bun:sqlite cross-process WAL on macOS APFS (L=L, I=H)

WAL works *most of the time* across processes when all writers use the same SQLite library. bun:sqlite is a custom build. When `jp` runs from `~/.local/bin/jp` (compiled binary) vs `bun run src/cli.ts` (dev mode), they may bind two libsqlite versions to the same `.db`.

- **Mitigation in plan**: busy_timeout + transaction + retry + daily backup. 80% sufficient.
- **Strengthen**: db.ts:13 add `PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=1000`. Document bun upgrade may require `sqlite3 reviews.db .recover`.

### Risk #3 — `recordAnswer` srs.ts:69-93 not transactional (L=M, I=M)

```ts
db.run(`UPDATE reviews ...`);  // line 78-84
db.run(`INSERT INTO attempts ...`);  // line 86-90
```

If process killed between, reviews shows new schedule but attempts table missing the row, OR vice versa. Poisons FSRS data subtly.

- **Mitigation in plan**: Scenario 2 mentions transaction wrap.
- **Adequacy**: mentioned but not in step plan. Task 8 doesn't say "patch srs.ts:69".
- **Strengthen**: new Task 5.5 "data integrity hardening" — wrap recordAnswer in `db.transaction()`, add busy_timeout=5000.

### Risk #4 — Claude Code hooks API contract drift (L=M, I=H)

Plan binds tightly to hook contract: `hookSpecificOutput.additionalContext`, hookEventName, exit codes, `tool_response.duration_ms`. Anthropic shifts hook schema across Claude Code versions. Plan §10 Open Question #3 acknowledges PostToolUse "tool 失败 skip" detection is open.

- **Mitigation in plan**: none.
- **Strengthen**: (a) `hooks/lib/contract.ts` wraps stdin parsing + version detection + safe defaults; (b) install-time "I support Claude Code ≥ 1.0.x" assertion; (c) `jp doctor` CLI command pings hooks API surface and reports incompatibilities.

### Risk #5 — bun --compile binary breaks on arch transition / quarantine (L=M, I=M)

(a) macOS Sequoia (26.x) quarantines binaries downloaded via curl/network; `curl -L install.sh | bash` may produce Gatekeeper-blocked `jp`. (b) bun version drift: user updates bun → re-runs install → new binary uses different ABI for bun:sqlite.

- **Mitigation in plan**: Risk row mentions fallback to `bun run src/cli.ts`.
- **Strengthen**: install.sh runs `xattr -d com.apple.quarantine ~/.local/bin/jp` after build. Pin `engines.bun: ">=1.1.40 <2"` in package.json.

### Risk #6 — profile.yaml schema evolution (L=M, I=M)

`readProfile()` profile.ts:49-58 does `{ ...DEFAULT_PROFILE, ...parsed }` which **silently drops** unknown keys.

- **Strengthen**: enforce `version: 1` field check; if profile.version > current code version, warn user. `patchProfile` writes `profile.yaml.bak.<timestamp>` for rollback.

### Risk #7 — N2 通过率 unfalsifiable (L=H, I=Outcome-fatal)

Driver 3 says "N2 通过率... 6-12 个月后能不能过 JLPT N2... 覆盖率不足 / 题面与考试形式偏差大 = 项目失败". Plan has **zero way to measure this** before the actual N2 exam.

- **Mitigation in plan**: none.
- **Strengthen**: Phase 1.1 must add **periodic mock test** (`/jp mock-n2` serves 30 official-format questions from held-out set, projects "predicted N2 score"). Held-out set in `data/seeds/n2-mock-pool.yaml` (excluded from default seed-import).

### Risk #8 — Concurrency on `daily_new_count` gating (L=L, I=L)

`getNextDue` (concepts.ts:38) checks `todayNewIntroducedCount() >= profile.daily_new_count`. Two simultaneous `jp next` calls (Claude + Codex same minute) can both read count=4, both pick a new concept. Off-by-one.

- **Mitigation**: accept as-is. Low impact, do not over-engineer.

---

## 5. Synthesis — Concrete Adjustments

### Adjustment A — Schema-aware install-hooks.mjs (Risk #1, P1)

**Where**: Task 12 step 12.2 (`scripts/install-hooks.mjs`).
**Change**:
- Before write, scan each event array (Stop, UserPromptSubmit, PostToolUse) and detect schema: flat (`{matcher, command}`) vs nested (`{matcher, hooks:[{type,command,timeout}]}`).
- If event array non-empty + flat-form, emit jp entry in flat form.
- If empty, prefer nested form.
- If mixed, abort with: "Existing hooks for event X mix schemas. Manually clean up first or run `jp install --force-nested`".
- Add `tests/integration/install.test.ts` cases: empty / flat-only / nested-only / jp-already-present (idempotent).

### Adjustment B — Honest cross-tool framing (T3, P2)

**Where**: Plan §1 Principle 2 + Task 7 jp-setup.skill.md + README §3.
**Change**:
- Rewrite Principle 2: "**reviews.db is the single source of truth across `jp` invocations from any tool. Automatic injection only available in Claude Code (hook layer); Codex/Gemini users invoke `/jp` manually.**"
- jp-setup.skill.md step 5 adds "你主要在哪个 tool 用 jp？(Claude / Codex / Gemini / 多个)" → if not Claude, set `inject_rate=0` + explain.
- README §3 prominent table: Tool | Auto-inject | Manual /jp | Shared db.

### Adjustment C — Data integrity hardening (Risk #3, T4)

**Where**: New Task 5.5 inserted before Task 6 OR fold into Task 8 step 8.0.
**Change**:
- `srs.ts:69-93` `recordAnswer`: wrap UPDATE+INSERT in `db.transaction(() => {...})()`.
- `db.ts:13` add `PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA wal_autocheckpoint = 1000;`.
- New `hooks/lib/common.ts:safeFail(reason)` always appends NDJSON `{ts, event:"hook_silent_fail", reason}` to `~/.config/jp-trainer/jp.log` before exit 0.
- Add `jp logs --tail N --event <name>` CLI command.

### Adjustment D — Shell pre-gate for hooks (Risk #1 perf, P1)

**Where**: Task 8 step 8.5.
**Change**: instead of `#!/usr/bin/env bun` at top, write `hooks/stop.sh`:
```bash
#!/bin/bash
exec 3<&0
PROFILE=~/.config/jp-trainer/profile.yaml
[ -f "$PROFILE" ] || exit 0
RATE=$(grep '^inject_rate:' "$PROFILE" | awk '{print $2}')
ROLL=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); print rand()}')
awk -v r=$ROLL -v rate=$RATE 'BEGIN{exit !(r < rate)}' || exit 0
exec bun ~/.claude/jp-trainer-hooks/stop.ts <&3
```
- Same pattern for user-prompt-submit.sh (work-hours + immersion flag stat) and post-tool-use.sh.
- Bun cold-start happens only on the ~15% of turns that will inject. 100ms × 15 = 15ms/day overhead vs 100ms × 100 = 10s/day.

### Adjustment E — Rubric-anchored skill prompts (A3, P3, T2)

**Where**: Task 7 step 7.1 jp.skill.md.
**Change**: Define rubric per concept type:

```yaml
# vocab rubric
rating_4_easy: word + correct reading + correct meaning, no hesitation
rating_3_good: word correct, minor reading hesitation OR partial meaning
rating_2_hard: meaning correct but had to be prompted, OR wrong reading
rating_1_again: didn't recall, needed full disclosure

# grammar rubric
rating_4_easy: produced form correctly + understood subtle meaning + can give counter-example
rating_3_good: form correct, meaning right, no counter-example
rating_2_hard: form correct but meaning vague, or vice versa
rating_1_again: form wrong or didn't recognize
```

- jp.skill.md instruction: **"You MUST evaluate using the rubric above; quote the rubric line you matched in `--feedback` argument when calling `jp answer`."**
- Question type rotation: random *within* rubric-stable types.

### Optional Adjustment F — Profile schema completion (P4)

**Where**: profile.ts:9-25 + Task 8 step 8.1.
**Change**: add `inject_max_per_hour`, `inject_max_per_session`, `do_not_disturb_until`, `respect_work_hours`. `hooks/lib/common.ts:incrementInjectCount(sessionId)` writes `~/.config/jp-trainer/sessions/<id>/inject-count.json`. New `jp dnd <duration>` CLI.

---

## 6. Open Questions for Critic (max 3)

### Q1. Hook entry-point: shell wrapper (Adjustment D) vs always-bun?

Shell pre-gate saves ~85ms × 100 turns = ~8.5s/day per hook. Cost: 3 small bash files, awk dependency. **Recommendation: yes.**

### Q2. Mock-N2 measurement (Risk #7): Phase 1 or Phase 2?

Without periodic mock tests, Driver 3 ("N2 通过率") unfalsifiable for 6-12 months. Adding held-out 200-question pool + `jp mock-n2` is ~1 day. **Recommendation: Phase 1.1 minimum.**

### Q3. inject_rate default: 0.10 vs 0.15?

Planner internally inconsistent. **Recommendation: 0.10** for v0.1.0 unknown-user-base; user can `jp config inject_rate=0.15` to escalate.

---

## References

- `docs/ralplan-planner-v1.md:36-50` — Principles 1-5 (subject to P2 rephrase)
- `docs/ralplan-planner-v1.md:184-200` — Scenario 1 mitigation (0.10 vs 0.15 inconsistency)
- `docs/ralplan-planner-v1.md:202-215` — Scenario 2 mitigation transaction wrap
- `docs/ralplan-planner-v1.md:332-344` — Task 8 step plan, missing shell pre-gate
- `docs/ralplan-planner-v1.md:457-466` — ADR-001 alternatives missing Anki rebuttal
- `src/srs.ts:69-93` — `recordAnswer` non-transactional (Risk #3)
- `src/db.ts:13` — only journal_mode=WAL (Risk #2)
- `src/profile.ts:9-25` — Profile interface missing fields (P4)
- `src/profile.ts:49-58` — `readProfile` silent default-merge (Risk #6)
- `src/cli.ts:198-210` — `inject-decide` exit-code pattern template
- `src/concepts.ts:38` — `daily_new_count` race condition (Risk #8, accept)
- `~/.claude/settings.json` — flat-form evidence
- `customer-im-client/.claude/settings.json` — nested-form evidence

---

**Hand-off to Critic**: 5 adjustments + 3 open questions. Critic should focus on Q1-Q3 binding decisions, completeness of Risk #7 mitigation, and whether Adjustment E rubric design is detailed enough.
