# polyglot — AI-native language trainer (`lt` CLI)

> A spaced-repetition Japanese / multi-language trainer that piggybacks on
> Claude Code / Codex / Gemini workflows. The `lt` CLI is the engine
> (FSRS-5 scheduling + concept DB); the LLM is the renderer + grader, anchored
> to a strict rubric.

JLPT N5–N2 vocab seeds ship in-tree. Codex / Gemini integrations are first-class
(within their hook limitations — see below).

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

- `src/cli.ts` — commander entry; subcommands `setup` / `next` / `answer` /
  `review` / `stats` / `seed-import` / `daily-push` / `install-cron` / `logs` /
  `restore` / `config` / `immersion` / `inject-decide` / `detect-cn`.
- `src/srs.ts` — FSRS-5 wrapper around `ts-fsrs`. `recordAnswer()` runs
  `db.transaction()` for atomicity; busy_timeout + WAL pragmas in `src/db.ts`.
- `src/concepts.ts` — `getNextDue`, `dueCount`, `getStats`, `listDueConcepts`.
  Quota-aware (`profile.daily_new_count`).
- `src/seeds.ts` — YAML → `concepts` table. Reads `data/seeds/*.yaml` (in-repo)
  and `~/.config/polyglot/seeds/*.yaml` (user override).
- `src/profile.ts` — typed profile loader + `patchProfile()` for `lt config`.
- `src/paths.ts` — `~/.config/polyglot/` resolver with auto-migration from the
  legacy `~/.config/jp-trainer/` path (PR `a6a9bb4`).

**Data**:

- `data/seeds/n{2,3,4,5}-vocab.yaml` — 6070 JLPT vocab cards in-tree.
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

> **Status**: an automated `install.sh` that wires up Claude Code skills, Codex
> `AGENTS.md` snippet, and Gemini `GEMINI.md` snippet is on the roadmap
> (Plan v4 Task 12). Until that lands, install manually:

```bash
# 1) Clone + install Bun deps
git clone <this-repo> && cd jp-trainer
bun install

# 2) Compile the lt CLI to ~/.local/bin/lt
bun run install-bin
# (or for development: alias lt="bun run /abs/path/to/jp-trainer/src/cli.ts")

# 3) Initialize the profile + db
lt setup
# → ~/.config/polyglot/profile.yaml created with sane N3→N2 defaults

# 4) Import the in-tree JLPT vocab seeds (idempotent)
lt seed-import
# → "inserted": 6070 (N2/N3/N4/N5 vocab)

# 5) (Claude Code only) Symlink the skills so /lt / /lt-setup / /lt-on /lt-off / /lt-review work
mkdir -p ~/.claude/skills
for f in skills/*.skill.md; do
  ln -sf "$(pwd)/$f" "$HOME/.claude/skills/$(basename $f)"
done

# 6) (Optional) Daily macOS notification at profile.daily_cron (default 09:00)
lt install-cron
# → loads ~/Library/LaunchAgents/com.polyglot.daily.plist

# 7) (Optional, Codex / Gemini) Append the integration snippets:
cat codex/AGENTS.snippet.md      >> ~/.codex/AGENTS.md      # if you use Codex
cat gemini/GEMINI.snippet.md     >> ~/.gemini/GEMINI.md     # if you use Gemini
```

**Where things live after install**:

| Path                                       | What                                                      |
|--------------------------------------------|-----------------------------------------------------------|
| `~/.local/bin/lt`                          | Compiled CLI binary (one of `lt` / `jp` aliases work)     |
| `~/.config/polyglot/profile.yaml`          | User profile (level, work hours, inject rate, …)          |
| `~/.config/polyglot/reviews.db`            | FSRS schedule + attempts (WAL mode, daily backup)         |
| `~/.config/polyglot/lt.log`                | NDJSON event log (`lt logs --event answer_recorded`)      |
| `~/.config/polyglot/backup/reviews.db.bak.*` | Rolling 7-day daily backups (`scripts/daily-backup.sh`) |
| `~/.claude/skills/lt*.skill.md`            | Claude Code skill stubs (`/lt`, `/lt-setup`, …)           |
| `~/Library/LaunchAgents/com.polyglot.daily.plist` | macOS daily-push agent (optional)                  |

---

## 5. End-to-end demo (verified 2026-04-27)

This is exactly what `bun run src/cli.ts ...` does today, recorded against an
isolated `HOME=$(mktemp -d)`:

### 5.1 `lt setup`

```
$ lt setup
profile written to /Users/you/.config/polyglot/profile.yaml
Run /jp-setup in Claude Code for the interactive onboarding.
```

Generated `profile.yaml` (excerpt):

```yaml
version: 1
level: N3
target: N2
weak_areas: [grammar, kanji]
work_hours: 09:00-19:00
inject_rate: 0.15
daily_cron: 09:00
daily_new_count: 5
notification_channel: macos
immersion_level: 0
tts_engine: macos
active_language: ja
```

### 5.2 `lt seed-import`

```
$ lt seed-import
{
  "inserted": 6070,
  "updated": 0,
  "skipped": 0,
  "files": [
    "/.../data/seeds/n3-vocab.yaml",
    "/.../data/seeds/n4-vocab.yaml",
    "/.../data/seeds/n2-vocab.yaml",
    "/.../data/seeds/n5-vocab.yaml"
  ]
}
```

### 5.3 `lt next --json`

The LLM (any tool) calls this to get the next concept and renders a question:

```json
$ lt next --json
{
  "id": "ja-vocab-n3-toorisugiru",
  "type": "vocab",
  "level": "N3",
  "ja": "通り過ぎる",
  "reading": "とおりすぎる",
  "zh": "走过，越过",
  "examples": [{"ja": "挨拶もしないで通り過ぎる", "zh": "连招呼都没打就走过去"}],
  "tags": [],
  "pos": "自動2"
}
```

### 5.4 `lt answer` — write the result back

```
$ lt answer \
    --concept-id ja-vocab-n3-toorisugiru \
    --rating 3 \
    --user-answer "通り過ぎる" \
    --feedback "rubric_3_good: 词形对，读音轻微犹豫"

{"ok":true,"next_due_at":"2026-04-26T19:47:55.683Z","stability":"3.17","difficulty":"5.28"}
```

`rating` is FSRS 1–4 (`1=again`, `2=hard`, `3=good`, `4=easy`). `--feedback`
must literal-quote the rubric line that fired (see [`skills/lt.skill.md`](skills/lt.skill.md));
this is what anchors FSRS stability/difficulty so a free-form LLM evaluator
can't drift the schedule.

### 5.5 `lt review` + `lt stats`

```
$ lt review --limit 5
Nothing due. ✨

$ lt stats
Total concepts: 6070
Introduced: 1
Due now: 0
Today: 1 attempts, 1 correct (100%)
By level:
  N2: 0/2920
  N3: 1/1583
  N4: 0/350
  N5: 0/1217
```

The single concept we touched is now scheduled ~1 day out (FSRS-5 default for
rating=good on a brand-new card), so it doesn't show in `review` until tomorrow.

---

## 6. Daily flow

In Claude Code:

```
You: /lt
Claude: 先调 lt next, 拿到 ja-vocab-n3-...; 给你出一道 vocab 题：
        中文意思：「走过，越过」 → 请写出日语词 + 假名
You: 通り過ぎる、とおりすぎる
Claude: 评分 rating=4_easy（词形 + 读音 + 含义全对）。
        调用 lt answer ... → next_due_at = 2026-05-04
        下次复习时间：5 月 4 日。
```

In Codex / Gemini, type `/lt` and the snippet drives the same loop.

---

## 7. Useful subcommands

| Command                                               | Use                                              |
|-------------------------------------------------------|--------------------------------------------------|
| `lt next [--json]`                                    | Pick next concept (respects daily new quota)     |
| `lt answer --concept-id ID --rating 1\|2\|3\|4 …`     | Record + reschedule (FSRS-5 transactional)       |
| `lt review [--limit N]`                               | List concepts due now                            |
| `lt due-count`                                        | Just the integer                                 |
| `lt stats`                                            | Total / introduced / due / by-level breakdown    |
| `lt config <key=value> …`                             | Read/update profile fields                       |
| `lt immersion <0\|10\|25\|50\|100>`                   | Mix-language ambient level (Claude Code only)    |
| `lt seed-import`                                      | Re-import `data/seeds/` + `~/.config/polyglot/seeds/` (idempotent upsert) |
| `lt daily-push`                                       | Fire today's notification (called by launchd)    |
| `lt install-cron`                                     | Install the macOS launchd plist                  |
| `lt logs --event answer_recorded --tail 20`           | Tail NDJSON event log                            |
| `lt restore --from Mon`                               | Restore reviews.db from `backup/reviews.db.bak.Mon` |

---

## 8. Reliability

- **Atomic writes** (`src/srs.ts:69-93`): `recordAnswer()` wraps card UPDATE +
  attempts INSERT in `db.transaction()`. If either fails, neither commits.
- **WAL pragmas** (`src/db.ts:13`): `journal_mode=WAL`,
  `synchronous=NORMAL`, `busy_timeout=5000`, `wal_autocheckpoint=1000`.
  Multiple `lt` invocations from different tools won't collide.
- **Daily backup** (`scripts/daily-backup.sh`): rolling 7-day
  `reviews.db.bak.{Mon..Sun}` snapshots. Restore via `lt restore --from <day>`.
- **Path migration** (`src/paths.ts:30-71`): legacy `~/.config/jp-trainer/`
  auto-renamed to `~/.config/polyglot/` on first launch + symlink left behind.
- **launchd Label migration** (`src/cli.ts:259-326`): old
  `com.jp-trainer.daily.plist` is `launchctl unload`-ed and removed before the
  new `com.polyglot.daily` plist is loaded; an `old_plist_migrated` NDJSON
  event is emitted.

---

## 9. Tests

```
$ bun test
bun test v1.3.13

 23 pass
 0 fail
 99 expect() calls
Ran 23 tests across 4 files.
```

Coverage:

- `tests/paths-migration.test.ts` — fresh / legacy / already-migrated /
  idempotent paths cases.
- `tests/srs-transaction.test.ts` — answer atomicity under simulated failure.
- `tests/skill-frontmatter.test.ts` — every `skills/*.skill.md` has the
  required frontmatter fields.
- `tests/cron-install.test.ts` — `renderPlist` substitutes correctly,
  `findPlistTemplate` resolves to repo template, Label is `com.polyglot.daily`,
  edge values (0/23/59) render properly.

---

## 10. Layout

```
jp-trainer/
├── src/                 # Bun TypeScript CLI
│   ├── cli.ts           # commander entry (`lt`)
│   ├── srs.ts           # FSRS-5 wrapper
│   ├── concepts.ts      # next-due / quota / stats
│   ├── seeds.ts         # YAML → concepts upsert
│   ├── db.ts            # bun:sqlite + pragmas
│   ├── paths.ts         # ~/.config/polyglot/ resolver + migration
│   ├── profile.ts       # typed profile + patchProfile()
│   └── work-hours.ts    # work_days × work_hours window check
├── data/seeds/          # n{2,3,4,5}-vocab.yaml (6070 cards in-tree)
├── skills/              # Claude Code skill stubs (lt / lt-setup / lt-on / lt-off / lt-review)
├── codex/AGENTS.snippet.md     # Append to ~/.codex/AGENTS.md
├── gemini/GEMINI.snippet.md    # Append to ~/.gemini/GEMINI.md
├── templates/com.polyglot.daily.plist   # launchd plist template
├── scripts/daily-backup.sh     # called by launchd or cron
├── tests/                      # bun:test
└── docs/
    ├── cross-tool-honest-framing.md  # the §3 table + rationale
    ├── design.md                     # high-level design
    └── ralplan-{planner,architect,critic}-v*.md   # full RALPLAN-DR consensus history
```

---

## 11. License

TBD.
