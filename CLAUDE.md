# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`polyglot` (binary: `lt`, alias `jp`) is a Bun + TypeScript CLI that piggybacks on Claude Code / Codex / Gemini sessions. The CLI is the engine (FSRS-5 scheduler + concept SQLite at `~/.config/polyglot/reviews.db`), the LLM is the renderer + grader. JLPT N5–N2 vocab + N2 grammar (~6195 cards) and Korean TOPIK 1-2 (~970 cards) ship in `data/seeds/*.yaml`.

`README.md` is the canonical user-facing doc. It is unusually load-bearing — sections §2 (architecture), §3 (cross-tool framing), §6 (profile fields), and §11 (subcommand list) are kept in lock-step with the code and updated as part of feature work. Touch them when CLI surface changes.

## Common commands

```bash
bun install                         # resolve deps
bun test                            # full suite (~300 cases incl. e2e)
bun test tests/srs-transaction.test.ts   # single file
bun test --test-name-pattern "atomic"    # single test by name
bun run src/cli.ts <subcmd>         # dev — equivalent to `lt <subcmd>`
bun run scripts/check-prompt-version.ts  # pre-commit drift guard (skill ↔ hook prompt_version)

bun build src/cli.ts --compile --outfile dist/lt        # local binary
bun build src/cli.ts --compile --outfile ~/.local/bin/lt   # `bun run install-bin`

bash install.sh                     # full install: build + skills + hooks + launchd + smoke
```

There is no lint step and no formatter — `tsconfig.json` is `noEmit: true` (type-check only). The compiler runs as part of `bun build`/`bun test`.

`bun test` invokes the real CLI in `tests/e2e/full-flow.test.ts` against an isolated `HOME=$(mktemp -d)`. It is the canonical regression — keep it green.

## Architecture

### Two-layer split (CLI engine ↔ LLM renderer)

Every tool (Claude Code / Codex / Gemini) drives the same flow: `lt next --json` returns a concept; the LLM renders the question, grades the answer, and calls `lt answer --concept-id <id> --rating 1|2|3|4 --feedback "<rubric_line>"`. **Ratings are rubric-anchored**: the LLM must literal-quote a line from the per-type rubric in `skills/lt.skill.md` into `--feedback`. Free-form grading drifts FSRS stability/difficulty, so any grading-related change has to keep the rubric and skill in sync.

### Shared state (`~/.config/polyglot/`)

| Path                                   | What                                                    |
|----------------------------------------|---------------------------------------------------------|
| `profile.yaml`                         | typed profile (see `src/profile.ts`)                    |
| `reviews.db` (WAL)                     | concepts / reviews / attempts / `ambient_exposures` / `mock_*` |
| `lt.log`                               | NDJSON event log (`lt logs --tail`)                     |
| `seeds/*.yaml`                         | user-added concepts (override + supplement `data/seeds/`) |
| `backup/reviews.db.bak.{Mon..Sun}`     | rolling 7-day backup written by `scripts/daily-backup.sh` |

`src/paths.ts` resolves the dir and **auto-migrates** the legacy `~/.config/jp-trainer/` → `~/.config/polyglot/` on first launch (atomic rename + symlink left behind, NDJSON `config_dir_migrated` event). Any new code that writes config must go through `CONFIG_DIR` from `paths.ts`, never `homedir() + "/.config/jp-trainer"`.

### Source layout (only the non-obvious parts)

- `src/cli.ts` — single commander entry; 25+ subcommands (the README §11 table is authoritative).
- `src/srs.ts` — `recordAnswer()` wraps `UPDATE reviews` + `INSERT attempts` in `db.transaction()`. **Never split** these writes; FSRS state and the attempt log must stay consistent or restore-from-backup is the only recovery.
- `src/db.ts` — single `getDb()` singleton + WAL pragmas (`journal_mode=WAL`, `busy_timeout=5000`, `synchronous=NORMAL`, `wal_autocheckpoint=1000`). Multiple `lt` invocations from different tools rely on these pragmas; do not weaken them. Schema migration runs on every `getDb()` (idempotent `CREATE TABLE IF NOT EXISTS` + ad-hoc `ALTER TABLE` in `migrateConceptsLanguage`).
- `src/profile.ts` — `patchProfile()` is the only sanctioned write path. Handles v1 → v2 `per_language` migration (legacy single-language top-level fields → `per_language[active_language]`). Don't read or write `profile.yaml` directly elsewhere.
- `src/concepts.ts` — `getNextDue` / `dueCount` / `getStats` are all language-scoped to `profile.active_language` and respect `daily_new_count`. Adding a new query: scope it the same way unless you have a concrete reason not to.
- `src/ambient.ts` — `ambient_exposures` engine: 80/20 mastered/weak vocab pool feeds the `lt mix` hooks, 90-day retention via `lt ambient-clean` (rolls into `ambient_exposures_archive` with `cumulative_count`).
- `src/utils/immersion.ts` — `buildImmersionPrompt(level, language)` produces the 5-档 prompt strings the hooks inject. **Edits here are tracked by `scripts/check-prompt-version.ts`** (immersion template hash), so when the wording changes, bump the matching `prompt_version` in `skills/lt-mix.skill.md` and `AMBIENT_PROMPT_VERSION` in `hooks/user-prompt-submit.ts`.
- `src/mock.ts` — sandboxed mock-N2 (`mock_questions` / `mock_attempts`, isolated from FSRS). `runAmbientValidate` is the K1 self-falsification gate: binomial p<0.05 over a configurable window — do not loosen the threshold without updating `tests/ambient-validate.test.ts`.
- `src/doctor.ts` — 9 install-health checks (the 9th, `mix_lang_seeds`, fires conditionally when `profile.mix_language` is set; info-level, doesn't affect exit code). Exit codes `0` ok / `1` warn / `2` critical. Add a check here when you ship something the user can break by editing settings.json or migrating across machines.

### Hooks (Claude Code only)

`hooks/{stop,user-prompt-submit,post-tool-use}.{sh,ts}` are the auto-injection layer. They exist **only for Claude Code** because Codex / Gemini do not expose hook events. The flow is `*.sh` thin wrapper → `bun run *.ts` body → `runLt()` shells out to the compiled `lt` binary.

Three invariants every hook must keep:

1. **`safeFail(reason)` on any error** (`hooks/lib/common.ts`). Hooks never crash the user's shell — they emit `hook_silent_fail` NDJSON and `exit 0`. Always wrap risky logic in try/catch and route to `safeFail`.
2. **Pre-gate work-hours / inject-rate / DND** before doing any DB work. `src/work-hours.ts` + `profile.respect_work_hours` + `do_not_disturb_until` + `inject_max_per_hour` / `inject_max_per_session` (the limiter in `hooks/lib/limiter.ts`) all matter. Skipping the gate is the #1 cause of "Stop hook fired in the wrong project".
3. **Emit one NDJSON event per branch**. Even silent-skip paths must log a `reason` so `lt logs --event hook_silent_fail` can diagnose.

Hooks land in `~/.claude/polyglot-hooks/` and are wired into `~/.claude/settings.json` via `scripts/install-hooks.mjs` (schema-aware merge, never clobbers existing entries). `install.sh` substep 12.7 also scans the `cwd` `.claude/settings.json` for project-level overrides and warns — that warning is real, project-level entries shadow user-level ones.

### Skills

`skills/*.skill.md` are Claude Code skill stubs (`/lt`, `/lt-setup`, `/lt-review`, `/lt-mix`, `/lt-on`, `/lt-off`). `install.sh` copies them to `~/.claude/skills/polyglot-<name>/SKILL.md`. `skills/lt.skill.md` carries the FSRS rating rubric and is the source of truth for grading; if you change rating semantics, change it here first, then the tests.

### Cross-tool packs

`codex/AGENTS.snippet.md` and `gemini/GEMINI.snippet.md` are append-only snippets users paste into `~/.codex/AGENTS.md` / `~/.gemini/GEMINI.md`. They contain the same rubric as `skills/lt.skill.md`; if the rubric changes, update all three plus the prompt-version drift check.

### prompt_version drift guard

`scripts/check-prompt-version.ts` is wired as a pre-commit hook. It enforces:

1. Every `skills/*.skill.md` declares a `prompt_version: vN[.M]` frontmatter.
2. `skills/lt-mix.skill.md` `prompt_version` == `AMBIENT_PROMPT_VERSION` constant in `hooks/user-prompt-submit.ts`.
3. (soft) Hash of the immersion templates in `src/utils/immersion.ts` is reported so reviewers can spot silent prompt edits.

Whenever you change ambient-injection wording, bump both the skill frontmatter and the hook constant in the same commit.

## Conventions

- **Always go through `getDb()`**, never construct a fresh `Database`. The pragmas + migrations are bound to that singleton.
- **Always go through `patchProfile()`** for profile writes — direct YAML writes bypass the v1 → v2 migration. Note: `profile.mix_language` is a new nullable field that overrides which `LANGUAGE_PACK` the user-prompt-submit hook renders for ambient prompts, independently of `active_language`. Default `null` means "use active_language". `en` is a mix-only language: it's NOT in `SUPPORTED_LANGUAGES = ["ja", "ko"]`, but `LANGUAGE_PACKS.en` is reachable through the hook's `mix_language || active_language` resolution at `hooks/user-prompt-submit.ts`. Other hooks (`hooks/stop.ts`, `hooks/post-tool-use.ts`) are intentionally FSRS-scoped and do NOT consume `mix_language` — Principle 5.
- **Tests run real code, not mocks.** `tests/e2e/full-flow.test.ts` spawns `bun run src/cli.ts` against `mkdtempSync()`-ed HOME. Many other tests (`paths-migration`, `cron-install`, `install`, `srs-transaction`) follow the same pattern. When adding tests for new CLI surface, prefer this style over mocking the DB.
- **Source ts files import other ts files with the `.ts` extension** (`allowImportingTsExtensions: true` in `tsconfig.json`). Bun resolves them; do not strip extensions.
- **Compiled binary lookups**: `cli.ts` probes `dirname(execPath)/../templates` and `~/.local/share/polyglot/templates` for the launchd plist template. `install.sh` copies `templates/*.plist` to the latter; if you add a new template, update both the install script and any code path that reads it.
- **`~/.config/jp-trainer/` is legacy.** Don't reference it in new code paths. The migration in `src/paths.ts` is one-shot; new features can assume `CONFIG_DIR` is `~/.config/polyglot/`.
- **launchd labels**: `com.polyglot.daily` (push) and `com.polyglot.daily-backup` (backup). The legacy `com.jp-trainer.daily` plist is auto-unloaded by `lt install-cron` (emits `old_plist_migrated` NDJSON). Never re-introduce the `jp-trainer` label.

## Roadmap status

Phase 1.0–1.3 = Done (v0.2.0). Phase 1.1b.x ("30-day dogfood validation of `lt ambient-validate`") is pending real-world data — see the README §9 table for the authoritative status. The decision logs live in `docs/ralplan-{planner,architect,critic}-v*.md` (RALPLAN-DR consensus history).
