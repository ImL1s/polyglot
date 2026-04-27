# polyglot — AI-native language trainer (`lt` CLI)

> Spaced-repetition Japanese / multi-language trainer that piggybacks on
> Claude Code / Codex / Gemini workflows. The `lt` CLI is the engine
> (FSRS-5 scheduling + concept DB); the LLM is the renderer + grader, anchored
> to a strict rubric.

JLPT N5–N2 vocab + N2 grammar (~6195 cards) **and Korean TOPIK 1-2 (~970 cards)**
ship in-tree (7165 total across `ja` + `ko`). Switch with `lt language switch ko`.
TTS via macOS `say` or Linux `edge-tts`; listening drill, ambient mix-language
(`lt mix 0/10/25/50/100`), mock-N2 self-test + `lt explain` 5 段教学 all in v0.2.0.
Codex / Gemini integrations are first-class within their hook limitations — see
[§3](#3-cross-tool-honest-framing).

---

## 1. Why

Practice without breaking flow. You're already in Claude Code / Codex / Gemini all day —
`polyglot` reuses those existing turns instead of asking you to open another app.

- **CLI is the engine, LLM is the renderer.** `lt next --json` decides *what*
  to ask; the LLM (any of Claude / Codex / Gemini) renders the question and
  grades the answer against a rubric.
- **One scheduler, many tools.** All three tools read and write the same
  SQLite at `~/.config/polyglot/reviews.db`. Answer in Claude Code, your next
  `lt next` from Gemini sees the updated schedule.
- **Honest about what's auto vs manual.** Only Claude Code has hooks → only
  Claude Code can ambient-inject reminders. Codex / Gemini are manual `/lt`.
  Shared progress, asymmetric ergonomics. See [§3](#3-cross-tool-honest-framing).

---

## 2. Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │            ~/.config/polyglot/              │
                 │  ┌───────────────┐  ┌──────────────────┐    │
                 │  │ profile.yaml  │  │ reviews.db (WAL) │    │
                 │  │ (level, hours)│  │ FSRS-5 schedule  │    │
                 │  └───────────────┘  └──────────────────┘    │
                 │  ┌───────────────┐  ┌──────────────────┐    │
                 │  │ lt.log (NDJSON)│ │ backup/          │    │
                 │  └───────────────┘  └──────────────────┘    │
                 └────────────▲────────────────────────────────┘
                              │  read/write
                              │
                       ┌──────┴───────┐
                       │  lt CLI      │  ←  Bun + ts-fsrs + bun:sqlite
                       │  (src/*.ts)  │
                       └──────▲───────┘
                              │ shells out
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────┴─────┐          ┌────┴─────┐          ┌────┴─────┐
   │ Claude   │          │  Codex   │          │  Gemini  │
   │ Code     │          │  CLI     │          │  CLI     │
   ├──────────┤          ├──────────┤          ├──────────┤
   │ /lt      │          │ /lt      │          │ /lt      │
   │ Stop hook│ ✅       │  (no hooks)         │  (no hooks)
   │ Prompt   │          │          │          │          │
   │   hook   │ ✅       │          │          │          │
   │ skills/  │          │ AGENTS.md│          │ GEMINI.md│
   └──────────┘          └──────────┘          └──────────┘
```

**Layers**:

- `src/cli.ts` — commander entry; 25+ subcommands (see [§11](#11-useful-subcommands))
- `src/srs.ts` — FSRS-5 wrapper around `ts-fsrs`. `recordAnswer()` runs
  `db.transaction()` for atomicity; busy_timeout + WAL pragmas in `src/db.ts`.
- `src/concepts.ts` — `getNextDue`, `dueCount`, `getStats`, `listDueConcepts`,
  language-scoped + quota-aware (`profile.daily_new_count`).
- `src/seeds.ts` — YAML → `concepts` table (with `language` field). Reads
  `data/seeds/*.yaml` (in-repo) and `~/.config/polyglot/seeds/*.yaml` (user).
- `src/profile.ts` — typed profile loader + `patchProfile()` + `per_language`
  migration (legacy v1 single fields → `per_language[active_language]`).
- `src/paths.ts` — `~/.config/polyglot/` resolver with auto-migration from the
  legacy `~/.config/jp-trainer/` path.
- `src/utils/immersion.ts` — `buildImmersionPrompt(level, language)` — 5 档
  prompt template + LANGUAGE_PACKS (ja/ko/en).
- `src/utils/code-context.ts` — `looksLikeCodeContext()` whitelist for hooks.
- `src/ambient.ts` — `ambient_exposures` engine: 80/20 mastered/weak vocab pool
  + 90-day retention + `archiveExposures` cumulative-count rollup.
- `src/tts.ts` — `speak(text, lang)` with 3 backends (macos `say` / `edge-tts` /
  none) + LANG_TO_VOICE + LANG_TO_VOICE_EDGE.
- `src/listening.ts` — `gradeListeningAnswer()` (katakana → hiragana fold + edit
  distance rubric).
- `src/explain.ts` — `buildExplainPayload()` + `cacheExplainFeedback()` for the
  5 段教学 verbose mode (token budget 8K input / 1500 char output).
- `src/mock.ts` — mock-N2 sandbox (separate `mock_questions` + `mock_attempts`
  tables) + `runAmbientValidate` (binomial test, K1 self-falsification).
- `src/doctor.ts` — 8-check install health (settings.json hooks, lt binary,
  bun version, profile/db, legacy symlink, launchd plists, schema consistency).

**Data**:

- `data/seeds/n{2,3,4,5}-vocab.yaml` + `n2-grammar.yaml` — 6195 ja cards in-tree.
- `data/seeds/ko-topik{1,2}-vocab.yaml` — 970 ko cards (TOPIK 1-2).
- `data/seeds/mock-n2.yaml` — 30 mock N2 questions (excluded from default
  `seed-import`; included only via `--include-mock`).
- `~/.config/polyglot/seeds/*.yaml` — user-added concepts (override / supplement).

---

## 3. Cross-tool honest framing

| Tool        | Auto-inject | Manual `/lt` | Shared db |
|-------------|-------------|--------------|-----------|
| Claude Code | ✅          | ✅           | ✅        |
| Codex       | ❌          | ✅           | ✅        |
| Gemini      | ❌          | ✅           | ✅        |

**Auto-inject** = Stop hook (post-turn reminders of due cards) + UserPromptSubmit
hook (probabilistic "mix in a Japanese question" probe). Only Claude Code
exposes these hook events; Codex / Gemini do not.

**Manual `/lt`** = User types `/lt` (or runs `lt` directly) to start a practice
session. Works identically in every tool because it just shells out.

**Shared db** = `~/.config/polyglot/reviews.db` (FSRS-5). Any tool that calls
`lt next` / `lt answer` reads and writes the same SQLite file.

If you live in Codex / Gemini, treat `lt` as a manual SRS CLI. If your daily
driver is Claude Code, you also get ambient nudges. Either way, the scheduler
state is consistent across tools.

Full rationale: [`docs/cross-tool-honest-framing.md`](docs/cross-tool-honest-framing.md).

---

## 4. Install

```bash
# Clone first, then run install.sh from the repo root (it expects the source tree):
git clone https://github.com/ImL1s/polyglot.git ~/Documents/polyglot
cd ~/Documents/polyglot && bash install.sh
```

`install.sh` is the canonical entry point. It performs:

1. Confirms `bun` is on `PATH` (prompts if missing — never auto-curls).
2. `bun install` to resolve deps.
3. `bun build src/cli.ts --compile` → single binary at `~/.local/bin/lt`.
4. `xattr -d com.apple.quarantine` to dodge Sequoia Gatekeeper.
5. Copies `skills/*.skill.md` → `~/.claude/skills/polyglot-<name>/SKILL.md`.
6. Copies `hooks/*` → `~/.claude/polyglot-hooks/`.
7. Schema-aware merge into `~/.claude/settings.json` (preserves existing entries).
8. `lt install-cron` to register the optional macOS daily push.
9. Registers the `daily-backup.sh` launchd plist.
10. Smoke-tests: `lt --help`, `lt setup`, `lt seed-import`.
11. **Conflict detector** (Plan v4 substep 12.7): scans cwd `.claude/settings.json`
    for `polyglot-hooks` / `jp-trainer-hooks` / `lt-` substrings and warns
    before any project-level overrides clobber the user-level wiring.

For a manual install (no curl), see [`install.sh`](install.sh) — every step is
plain bash.

### Linux fallback (TTS — `edge-tts`)

macOS users get TTS for free via the bundled `say` binary (Kyoko / Yuna /
Samantha / Tingting voices). Linux has no equivalent, so `install.sh`
transparently switches you to **edge-tts**, a Python wrapper around Microsoft
Edge's free neural TTS service. The installer:

1. Detects `uname -s = Linux`.
2. Tries to install `edge-tts` via `pipx install edge-tts` (preferred) or
   `pip3 install --user edge-tts` (fallback).
3. If neither is available, prints a manual command and continues — TTS will
   silent-skip (D13 fail-safe), the CLI keeps working.
4. Rewrites `profile.tts_engine: macos` → `tts_engine: edge` in your profile
   so all `lt say` / answer-side TTS uses edge-tts.

Voice mapping (override via `profile.tts_voice_overrides[lang]`):

| language | edge-tts voice         |
|----------|------------------------|
| `ja`     | `ja-JP-NanamiNeural`   |
| `ko`     | `ko-KR-SunHiNeural`    |
| `en`     | `en-US-JennyNeural`    |
| `zh`     | `zh-CN-XiaoxiaoNeural` |

Run `edge-tts --list-voices | grep ja-JP` to discover alternatives. To opt out
entirely set `tts_engine: none` in `profile.yaml`.

> The launchd-based daily backup plist (step 9 of `install.sh`) is macOS-only.
> Linux users should add a cron entry hitting `scripts/daily-backup.sh` daily
> if they want the same rolling backup.

**Where things live after install**:

| Path                                             | What                                                   |
|--------------------------------------------------|--------------------------------------------------------|
| `~/.local/bin/lt`                                | Compiled CLI binary (`lt` / `jp` aliases both work)    |
| `~/.config/polyglot/profile.yaml`                | User profile (level, work hours, inject rate, …)       |
| `~/.config/polyglot/reviews.db`                  | FSRS schedule + attempts (WAL mode, daily backup)      |
| `~/.config/polyglot/lt.log`                      | NDJSON event log (`lt logs --event answer_recorded`)   |
| `~/.config/polyglot/backup/reviews.db.bak.*`     | Rolling 7-day daily backups                            |
| `~/.claude/skills/polyglot-*/SKILL.md`           | Claude Code skill stubs (`/lt`, `/lt-setup`, …)        |
| `~/.claude/polyglot-hooks/*`                     | Stop / UserPromptSubmit shell hooks                    |
| `~/Library/LaunchAgents/com.polyglot.daily.plist`| macOS daily-push agent (optional)                      |

---

## 5. Quickstart

The intended flow inside Claude Code:

```
You:    /lt-setup                    # one-time, runs interactive onboarding
Claude: 你的目标级别？(N5/N4/N3/N2/N1) → N2
        练习时段？ → 09:00-19:00
        每天新词数量？ → 5
        ✅ profile.yaml 写好了

You:    /lt                          # daily training
Claude: (calls lt next --json)
        来一道 N3 vocab：「走过，越过」 → 请写出日语词 + 假名
You:    通り過ぎる、とおりすぎる
Claude: 词形 + 读音 + 含义全对，rating=4_easy。
        (calls lt answer --concept-id ja-vocab-n3-toorisugiru --rating 4 --feedback "rubric_4_easy: ...")
        next_due_at = 2026-05-04（再 7 天后复习）

You:    /lt-review                   # see what's due across all sessions
Claude: (calls lt review --limit 10)
        今天还有 12 张待复习 …

You:    /lt-on  | /lt-off            # enable/disable ambient injection
You:    lt stats                     # at any time, in any terminal
```

The same `/lt` works in Codex and Gemini after appending the snippet from
`codex/AGENTS.snippet.md` or `gemini/GEMINI.snippet.md` — but in those tools
there is no automatic Stop-hook reminder, so you must invoke `/lt` yourself.

### 5.1 What actually runs (verified end-to-end, 2026-04-27)

The five commands the LLM shells out to, recorded against an isolated
`HOME=$(mktemp -d)`:

```
$ lt setup
profile written to /Users/you/.config/polyglot/profile.yaml

$ lt seed-import
{ "inserted": 6195, "files": [".../n2-vocab.yaml", ".../n2-grammar.yaml", ".../n3-vocab.yaml", ".../n4-vocab.yaml", ".../n5-vocab.yaml"] }

$ lt next --json
{"id":"ja-vocab-n3-garagara","type":"vocab","level":"N3","ja":"がらがら","reading":"がらがら","zh":"（坚硬的物体碰撞或破裂时发出很大的声音）轰隆 …", "examples":[{"ja":"がらがらと雨戸を開ける","zh":"哗啦一声打开木板套窗"}], "pos":"副①・自動3①・ナ形⓪"}

$ lt answer --concept-id ja-vocab-n3-garagara --rating 3 --user-answer "がらがら" --feedback "rubric_3_good: 词形对，读音轻微犹豫"
{"ok":true,"next_due_at":"2026-04-26T19:47:55.683Z","stability":"3.17","difficulty":"5.28"}

$ lt stats
Total concepts: 6195
Introduced: 1
Due now: 0
Today: 1 attempts, 1 correct (100%)
By level:
  N2: 0/3045
  N3: 1/1583
  N4: 0/350
  N5: 0/1217

$ lt review --limit 5
Nothing due. ✨
```

`rating` is FSRS 1–4 (`1=again`, `2=hard`, `3=good`, `4=easy`). `--feedback`
must literal-quote the rubric line that fired (see [`skills/lt.skill.md`](skills/lt.skill.md));
this anchors FSRS stability/difficulty so a free-form LLM evaluator can't drift
the schedule.

A regression test for the same flow lives at
[`tests/e2e/full-flow.test.ts`](tests/e2e/full-flow.test.ts) — it spins up
an isolated `HOME` and runs `setup → seed-import → next → answer → stats →
review` against the real CLI on every `bun test`.

---

## 6. Profile (`~/.config/polyglot/profile.yaml`)

Edit fields with `lt config <key=value> …` or open the file directly. All
fields are optional; `lt setup` writes sensible defaults.

| Field                            | Type                          | Default       | What it does                                                                  |
|----------------------------------|-------------------------------|---------------|-------------------------------------------------------------------------------|
| `version`                        | int                           | `1`           | Profile schema version (auto-migrates on read)                                |
| `level`                          | `N5\|N4\|N3\|N2\|N1`          | `N3`          | Your current JLPT level                                                       |
| `target`                         | `N5\|N4\|N3\|N2\|N1`          | `N2`          | Target level — biases new concept selection                                   |
| `weak_areas`                     | list of `vocab\|grammar\|kanji\|listening\|speaking` | `[grammar, kanji]` | Heavier weight when picking new cards            |
| `work_hours`                     | `HH:MM-HH:MM`                 | `09:00-19:00` | Hooks only inject inside this window                                          |
| `work_days`                      | list of `Mon\|…\|Sun`         | `Mon..Fri`    | Hooks only inject on these days                                               |
| `inject_rate`                    | float 0–1                     | `0.15`        | UserPromptSubmit base injection probability                                   |
| `post_tool_inject`               | bool                          | `true`        | Stop hook on/off                                                              |
| `post_tool_min_duration_ms`      | int                           | `5000`        | Don't inject if last turn was shorter than this (ms)                          |
| `post_tool_inject_rate`          | float 0–1                     | `0.3`         | Stop hook injection probability                                               |
| `cn_probe_rate`                  | float 0–1                     | `0.05`        | Probability that a Chinese-only line triggers a Japanese probe                |
| `daily_cron`                     | `HH:MM` or `""`               | `09:00`       | macOS daily notification time (`""` disables)                                 |
| `daily_new_count`                | int                           | `5`           | Hard cap on new concepts introduced per day                                   |
| `notification_channel`           | `macos\|telegram\|none`       | `macos`       | Where the daily push goes                                                     |
| `inject_max_per_hour`            | int                           | `3`           | Hard ceiling on injections per hour                                           |
| `inject_max_per_session`         | int                           | `10`          | Hard ceiling on injections per Claude session                                 |
| `do_not_disturb_until`           | int (ms timestamp) or `null`  | `null`        | Suppress all injections until this time                                       |
| `respect_work_hours`             | bool                          | `true`        | Honor `work_hours` × `work_days`                                              |
| `immersion_level`                | `0\|0.10\|0.25\|0.50\|1.00`   | `0`           | Mix-language ambient level (see [§7](#7-immersion_level-5-档))                  |
| `tts_engine`                     | `macos\|edge\|none`           | `macos`       | TTS backend; Linux installer auto-rewrites to `edge`                          |
| `tts_rate`                       | int (words/min)               | `180`         | `say -r` rate                                                                 |
| `tts_on_answer_correct`          | bool                          | `true`        | Auto-`lt say` after rating ≥ 3                                                |
| `tts_on_answer_wrong`            | bool                          | `true`        | Auto-`lt say` (slow rate 140) after rating ≤ 2                                |
| `tts_listen_mode`                | bool                          | `true`        | Enable `lt next --type listening` flow                                        |
| `tts_voice_overrides`            | map `lang → voice`            | `{}`          | e.g. `{ja: Otoya, ko: Yuna}` to override LANG_TO_VOICE                        |
| `active_language`                | `ja\|ko`                      | `ja`          | Single active language; FSRS + hooks + stats scoped to this                   |
| `per_language`                   | map `lang → {level, target, weak_areas}` | auto-migrated from v1 top-level | Per-language overrides; `lt language switch <lang>` flips `active_language` |

Examples:

```bash
lt config level=N2 daily_new_count=8           # bump quota
lt config inject_rate=0 post_tool_inject=false # disable all auto-injection
lt config do_not_disturb_until=$(($(date +%s%3N) + 7200000))  # quiet for 2 hours
```

---

## 7. immersion_level 5 档

Mix-language is a single dial that controls how much target-language content
the LLM weaves into its replies. Five discrete steps; `lt mix --custom` is an
escape hatch.

| Level   | Name             | Behavior                                                                                             | Set with                            |
|---------|------------------|------------------------------------------------------------------------------------------------------|-------------------------------------|
| `0`     | off              | Pure Chinese (or English) replies, no language injection                                             | `lt mix 0` / `lt immersion off`     |
| `0.10`  | 偶尔点缀         | At most 1 known target-lang word per reply, with `(中文)` annotation                                  | `lt mix 10`                         |
| `0.25`  | 常见词替换       | Up to 3 known target-lang words per reply, with `(中文)` annotation                                  | `lt mix 25`                         |
| `0.50`  | 双语句法混合     | Short sentence tail rendered fully in target language, immediately followed by Chinese translation. Example: 「这个 bug 修好了。このバグは直りました。」 | `lt mix 50`                |
| `1.00`  | 全沉浸           | Full target-language replies + furigana + Chinese gloss appended                                     | `lt mix 100` / `lt immersion on`    |

Notes:

- `lt mix 35` (or any non-listed value) → stderr: "请用 0/10/25/50/100，或 `lt mix --custom 35`"
- `lt mix --custom <0-100>` always works — internally maps to nearest tier
- Legacy boolean `immersion_default: true` in old profiles auto-migrates to
  `immersion_level: 1.0`; the old `immersion.flag` file is removed
- Level only affects Claude Code (the only tool with a hook layer); Codex /
  Gemini ignore the field

---

## 8. Troubleshooting (`lt doctor`)

`lt doctor` runs 8 health checks (settings.json hooks, `lt` binary, `bun`
version, profile / reviews.db, legacy `~/.config/jp-trainer/` symlink,
launchd plists, hook schema consistency). Exit code: `0` clean, `1` warnings,
`2` critical. Add `--json` for machine-readable output.

```bash
$ lt doctor
lt doctor — 8 checks (7 ok, 0 warn, 1 error)
  [ok] lt_bin: lt binary at /Users/you/.local/bin/lt
  [err] bun: bun is not on PATH
  [ok] profile: profile.yaml present
  [ok] db: reviews.db present
  [ok] legacy_symlink: ~/.config/jp-trainer is a symlink (migration done)
  [ok] user_settings: 3/3 polyglot-hooks events wired in user settings
  [ok] launchd_daily: daily-push plist present
  [ok] launchd_backup: daily-backup plist present
```

For symptoms not surfaced by `doctor`:

| Symptom                                                                  | Check                                                                     | Fix                                                                                                       |
|--------------------------------------------------------------------------|---------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| `/lt` does nothing in Claude Code                                        | `ls ~/.claude/skills/polyglot-*/SKILL.md`                                 | Re-run `bash install.sh` from the repo root                                                               |
| Stop hook never fires                                                    | `lt logs --event hook_silent_fail --tail 20`                              | Inspect the `reason` field; common: `inject_rate=0`, outside `work_hours`, `do_not_disturb_until` set     |
| Hook fires twice or in unexpected projects                               | Search both `~/.claude/settings.json` and `<project>/.claude/settings.json` for `polyglot-hooks` / `lt-` strings | Remove the duplicate entry; project-level overrides user-level (install.sh substep 12.7 warns on this)    |
| `lt next` says "No concepts due and daily new quota reached"             | `lt stats` and check `daily_new_count`                                    | `lt config daily_new_count=10` to bump the cap                                                            |
| `lt seed-import` reports 0 inserted                                      | `ls data/seeds/*.yaml`                                                    | Make sure you're running it from the repo root (or have `~/.config/polyglot/seeds/*.yaml`)                |
| `bun: command not found`                                                 | `command -v bun`                                                          | `curl -fsSL https://bun.sh/install \| bash`, then `export PATH="$HOME/.bun/bin:$PATH"`                    |
| Database locked / `SQLITE_BUSY` errors                                   | Two `lt` processes running concurrently? `ps aux \| grep lt`              | WAL + 5s `busy_timeout` should handle it; if persistent, `lt restore --from <yesterday>`                  |
| Daily push never fires                                                   | `launchctl list \| grep com.polyglot.daily`                               | `lt install-cron` to (re)install; check `tail /tmp/polyglot.err`                                          |
| Old `~/.config/jp-trainer/` not migrating                                | `lt logs --event config_dir_migrated`                                     | Auto-migration runs on first launch; if it failed, `mv ~/.config/jp-trainer ~/.config/polyglot` manually  |
| Old `com.jp-trainer.daily` plist still loaded                            | `launchctl list \| grep jp-trainer`                                       | `lt install-cron` (auto-unloads + removes legacy plist; emits `old_plist_migrated` NDJSON event)          |
| TTS silent on macOS                                                      | `say -v Kyoko こんにちは`                                                 | `lt config tts_engine=none` to disable, or install a Japanese voice in System Settings → Accessibility    |

Recovering from a corrupt schedule:

```bash
ls ~/.config/polyglot/backup/                    # 7-day rolling backup files
lt restore --from Mon                            # restores reviews.db.bak.Mon
lt restore --from /abs/path/to/some.bak          # or restore from any snapshot
```

---

## 9. Roadmap

| Phase  | Tasks                                              | Status                                                |
|--------|----------------------------------------------------|-------------------------------------------------------|
| 1.0    | Core CLI · seeds · skills · hooks · install.sh · README · `lt doctor` | **Done** (v0.1.0)                                     |
| 1.1a   | Multi-language schema · Korean TOPIK seeds (~970) · multi-lang hooks | **Done** (v0.2.0)                                     |
| 1.1b   | `immersion_level` 5 档 (0/0.10/0.25/0.50/1.0) · ambient_exposures + `lt ambient-clean` 90 天 retention · `lt mix-vocab` 80/20 mastered/weak pool · prompt_version CI | **Done** (v0.2.0)                                     |
| 1.2    | macOS `say` TTS backend (5 voices) · `lt say` · `lt next --type listening` + `lt grade-listening` 假名听写 | **Done** (v0.2.0)                                     |
| 1.3    | `lt explain` 5 段教学 + 答错自动调 · edge-tts Linux fallback · mock-N2 题库 + `lt mock-test` + `lt ambient-validate` (binomial p<0.05 K1 自我证伪) | **Done** (v0.2.0)                                     |
| 1.1b.x | 30-day dogfood window: run `lt ambient-validate` after 30 days of immersion_level > 0 to verify ambient mix improves retention | Pending real-world data                               |

The full plan with tradeoffs and decision logs lives in
[`docs/ralplan-planner-v4.md`](docs/ralplan-planner-v4.md) (planner) and
[`docs/ralplan-architect-v{1,3,4}.md`](docs/) (architect rebuttals).

---

## 10. Daily flow (Claude Code)

```
You:    /lt
Claude: 先调 lt next, 拿到 ja-vocab-n3-...; 给你出一道 vocab 题：
        中文意思：「走过，越过」 → 请写出日语词 + 假名
You:    通り過ぎる、とおりすぎる
Claude: 评分 rating=4_easy（词形 + 读音 + 含义全对）。
        调用 lt answer ... → next_due_at = 2026-05-04
        下次复习时间：5 月 4 日。
```

In Codex / Gemini, type `/lt` and the snippet drives the same loop.

---

## 11. Useful subcommands

### Core training (Phase 1.0)

| Command                                                       | Use                                                                |
|---------------------------------------------------------------|--------------------------------------------------------------------|
| `lt setup [--force]`                                          | Write default `profile.yaml`                                       |
| `lt next [--json] [--type vocab\|grammar\|kanji\|listening] [--level N5..N1\|TOPIK1..6] [--difficulty easy\|hard]` | Pick next concept (quota-aware, language-scoped) |
| `lt answer --concept-id ID --rating 1\|2\|3\|4 [--user-answer S] [--feedback S] [--source manual\|hook\|cron\|review]` | Record + reschedule (FSRS-5 transactional) |
| `lt review [--limit N] [--json]`                              | List concepts due now                                              |
| `lt due-count`                                                | Just the integer                                                   |
| `lt stats [--json]`                                           | Total / introduced / due / by-level (current `active_language`)    |
| `lt config <key=value> …` / `lt config --show`                | Read/update profile fields                                         |
| `lt seed-import [--include-mock]`                             | Re-import `data/seeds/` + `~/.config/polyglot/seeds/` (idempotent) |
| `lt daily-push`                                               | Fire today's notification (called by launchd)                      |
| `lt install-cron`                                             | (Re-)install the macOS launchd daily-push plist                    |
| `lt logs [--tail N] [--event NAME]`                           | Tail NDJSON event log                                              |
| `lt restore --from Mon\|Tue\|…\|Sun\|/abs/path`               | Restore `reviews.db` from rolling backup (atomic mv via `.tmp`)    |
| `lt doctor [--json]`                                          | 8-check install health (exit 0/1/2 = ok/warn/critical)             |

### Multi-language (Phase 1.1a)

| Command                                | Use                                                                 |
|----------------------------------------|---------------------------------------------------------------------|
| `lt language list`                     | List supported languages (`* ja` marks active)                      |
| `lt language switch <ja\|ko>`          | Flip `active_language`; FSRS scope follows                          |

### Ambient mix-language (Phase 1.1b)

| Command                                            | Use                                                       |
|----------------------------------------------------|-----------------------------------------------------------|
| `lt mix <0\|10\|25\|50\|100>` / `lt mix status`    | Set / read `immersion_level` 5 档                         |
| `lt mix --custom <0-100>`                          | Escape hatch (always succeeds, maps to nearest tier)      |
| `lt mix-vocab --limit N [--json]`                  | 80/20 mastered/weak vocab pool (used by hooks)            |
| `lt ambient-log --concept-ids id1,id2 [--source S] [--session-id ID]` | Log an ambient exposure batch                |
| `lt ambient-stats [--json]`                        | Top exposures + totals + diagnostic line                  |
| `lt ambient-clean [--keep-days 90]`                | Archive rows older than N days into `ambient_exposures_archive` |
| `lt immersion <on\|off\|toggle\|status\|0\|10\|…>` | v1 alias (delegates to `lt mix`)                          |

### TTS + listening (Phase 1.2)

| Command                                                                              | Use                                                  |
|--------------------------------------------------------------------------------------|------------------------------------------------------|
| `lt say <concept-id>` / `lt say --text "<text>" [--lang ja\|ko\|en\|zh\|es] [--rate N] [--voice V] [--full] [--blocking] [--json]` | Speak concept reading or arbitrary text (engine = `tts_engine`) |
| `lt next --type listening`                                                           | Pick a listening drill (vocab with non-null `reading`) |
| `lt grade-listening --concept-id ID --user-answer "<kana>"`                          | Score a listening attempt (kana fold + edit distance) |

### Verbose explain + mock (Phase 1.3)

| Command                                                                       | Use                                                              |
|-------------------------------------------------------------------------------|------------------------------------------------------------------|
| `lt explain <concept-id> [--json]`                                            | 5 段教学 payload (concept + 5 recent attempts + stats)            |
| `lt mock-test --count N [--type vocab\|grammar\|listening\|reading] [--level N2] [--language ja]` | Pull N mock questions for a sit-down test       |
| `lt mock-record --question-id Q --user-choice IDX --correct true\|false`     | Record a mock answer                                             |
| `lt mock-report [--window-hours 24] [--json]`                                 | Aggregate mock score by type                                     |
| `lt ambient-validate [--window-days 30] [--threshold 7] [--json]`             | K1 self-falsification: binomial test (p<0.05) on `≥7 exposures` vs `<7` over the window |

---

## 12. Reliability

- **Atomic writes** (`src/srs.ts`): `recordAnswer()` wraps card UPDATE +
  attempts INSERT in `db.transaction()`. If either fails, neither commits.
- **WAL pragmas** (`src/db.ts`): `journal_mode=WAL`,
  `synchronous=NORMAL`, `busy_timeout=5000`, `wal_autocheckpoint=1000`.
  Multiple `lt` invocations from different tools won't collide.
- **Daily backup** (`scripts/daily-backup.sh`): rolling 7-day
  `reviews.db.bak.{Mon..Sun}` snapshots. Restore via `lt restore --from <day>`.
- **Path migration** (`src/paths.ts`): legacy `~/.config/jp-trainer/`
  auto-renamed to `~/.config/polyglot/` on first launch + symlink left behind.
- **launchd Label migration** (`src/cli.ts`): old
  `com.jp-trainer.daily.plist` is `launchctl unload`-ed and removed before the
  new `com.polyglot.daily` plist is loaded; an `old_plist_migrated` NDJSON
  event is emitted.

---

## 13. Tests

`bun test` runs ~300 cases across the core CLI + Phase 1.1-1.3 surfaces.

**Phase 1.0** — paths migration / SRS transaction atomicity / skill frontmatter
/ cron-install / install.sh schema-aware merge / hook pre-gate / e2e full-flow
(`tests/{paths-migration,srs-transaction,skill-frontmatter,cron-install,install,hook-pre-gate,e2e/full-flow,fetch-jlpt-vocab,seeds,immersion-wire}.test.ts`).

**Phase 1.1a** — multi-language schema migration (legacy v1 → `per_language`),
TOPIK seeds count by level, multi-lang hook label switching
(`tests/{lang-migration,topik-seeds,multilang-hook,immersion-multilang}.test.ts`).

**Phase 1.1b** — `immersion_level` 5 档 prompt snapshots (incl. 0.50 双语句法),
`lt mix` preset/custom CLI gate, ambient_exposures retention 200K-row archive,
prompt_version drift detection (skill ↔ hook double-sided)
(`tests/{immersion-050,lt-mix,ambient-clean,prompt-version}.test.ts`).

**Phase 1.2** — TTS backend dispatch (macos / edge / none) + ENOENT silent skip
+ LANG_TO_VOICE + voice overrides; listening kana-fold + edit-distance rubric
(`tests/{tts,listening}.test.ts`).

**Phase 1.3** — `lt explain` payload + truncation + cache; mock-N2 selection
+ recording; `ambient-validate` binomial test (incl. p-value sanity);
`tts-edge` LANG_TO_VOICE_EDGE
(`tests/{explain,mock-test,ambient-validate,tts-edge}.test.ts`).

`tests/e2e/full-flow.test.ts` is the canonical regression: spawns `lt` against
an isolated `HOME=$(mktemp -d)` and asserts on real CLI output (no mocks) for
`setup → seed-import → next → answer → stats → review → due-count → logs`.

---

## 14. Layout

```
polyglot/
├── src/                          # Bun TypeScript CLI
│   ├── cli.ts                    # commander entry (`lt` + `jp` alias)
│   ├── srs.ts                    # FSRS-5 wrapper (atomic recordAnswer)
│   ├── concepts.ts               # next-due / quota / stats (language-scoped)
│   ├── seeds.ts                  # YAML → concepts upsert (with `language`)
│   ├── db.ts                     # bun:sqlite + WAL pragmas + ambient_exposures + mock_*
│   ├── paths.ts                  # ~/.config/polyglot/ resolver + jp-trainer migration
│   ├── profile.ts                # typed profile + per_language migration
│   ├── work-hours.ts             # work_days × work_hours window check
│   ├── ambient.ts                # 80/20 vocab pool + retention + archive (Phase 1.1b)
│   ├── tts.ts                    # macos/edge/none backends + LANG_TO_VOICE (Phase 1.2)
│   ├── listening.ts              # gradeListeningAnswer kana fold + edit distance (1.2)
│   ├── explain.ts                # 5 段教学 payload + cache (Phase 1.3)
│   ├── mock.ts                   # mock-N2 + ambient-validate binomial (Phase 1.3)
│   ├── doctor.ts                 # 8-check install health
│   └── utils/
│       ├── code-context.ts       # looksLikeCodeContext whitelist
│       └── immersion.ts          # buildImmersionPrompt 5 档 × 3 LANGUAGE_PACKS
├── data/seeds/
│   ├── n{2,3,4,5}-vocab.yaml     # 6195 ja cards
│   ├── n2-grammar.yaml           # ja N2 grammar
│   ├── ko-topik{1,2}-vocab.yaml  # 970 ko cards (Phase 1.1a)
│   └── mock-n2.yaml              # 30 mock-N2 questions (Phase 1.3)
├── skills/                       # 6 Claude Code skills
│   ├── lt.skill.md               # main entry + rubric
│   ├── lt-setup.skill.md         # 7-question onboarding
│   ├── lt-review.skill.md        # due-list drill
│   ├── lt-mix.skill.md           # ambient mix-language (Phase 1.1b)
│   ├── lt-on.skill.md            # alias for lt mix 100
│   └── lt-off.skill.md           # alias for lt mix 0
├── hooks/
│   ├── stop.{sh,ts}              # post-turn ambient injection
│   ├── user-prompt-submit.{sh,ts}# pre-turn immersion + cn probe + due reminder
│   ├── post-tool-use.{sh,ts}     # long-running tool word-card injection
│   └── lib/{common,limiter,hook-utils}.ts  # safeFail + Adj-F throttle + runLt helper
├── codex/AGENTS.snippet.md       # Append to ~/.codex/AGENTS.md
├── gemini/GEMINI.snippet.md      # Append to ~/.gemini/GEMINI.md
├── templates/com.polyglot.daily.plist  # launchd plist template
├── scripts/
│   ├── daily-backup.sh           # sqlite3 .backup rolling Mon..Sun
│   ├── fetch-jlpt-vocab.ts       # JLPT csv → seed yaml (with yōon slug)
│   ├── fetch-topik-vocab.ts      # TOPIK 1-2 → seed yaml + hangul→romaja
│   ├── install-hooks.mjs         # schema-aware ~/.claude/settings.json merge
│   └── check-prompt-version.ts   # pre-commit hook: skill↔hook prompt drift
├── install.sh                    # canonical installer
├── tests/                        # bun:test (~300 cases, Phase 1.0–1.3)
│   └── e2e/                      # end-to-end flow tests
└── docs/
    ├── design.md                 # high-level design
    ├── cross-tool-honest-framing.md  # §3 rationale
    └── ralplan-{planner,architect,critic}-v*.md  # RALPLAN-DR consensus history
```

---

## 15. License

TBD.
