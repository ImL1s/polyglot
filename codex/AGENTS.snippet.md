## polyglot Language Trainer (lt CLI)

`lt` CLI is in `$PATH`. When the user says `/lt` or asks to practice (Japanese, vocab, grammar, etc.), drive a session against the shared FSRS scheduler:

### Practice flow

1. `lt next --json` → returns the next concept due for review as JSON (id, level, kind, prompt, rubric_hints).
2. Render a question to the user based on the concept JSON. Apply the rubric in `~/.claude/skills/lt/lt.skill.md` if you have access; otherwise apply general level expectations (N5/N4 = recognition + meaning, N3 = production + collocation, N2 = nuance + register).
3. After the user answers, evaluate against the rubric and record the result:
   ```
   lt answer --concept-id <id> --rating <again|hard|good|easy> --user-answer "<verbatim answer>" --feedback "rubric_line: <one-line eval>"
   ```
4. Repeat until the user stops or `lt due-count` is 0.

### Other useful commands

- `lt review` — list all due concepts (default 20)
- `lt stats` — show progress (mastered / learning / due-today)
- `lt due-count` — quick due integer
- `lt config <key=value>` — read or update profile fields
- `lt logs --event answer_recorded --tail 10` — tail NDJSON event log

### Profile + data location

- User profile: `~/.config/polyglot/profile.yaml`
- FSRS database: `~/.config/polyglot/reviews.db` (shared with Claude / Gemini)
- Event log: `~/.config/polyglot/lt.log`

### Honest cross-tool framing (v1 Adjustment B)

**Codex does not support hooks.** That means:

- Ambient injection (Stop-hook style "今日还有 N 题待复习" reminders) is **not available** in Codex.
- The UserPromptSubmit hook that auto-mixes a Japanese probe into your prompt is **not available** in Codex.
- Users in Codex must invoke `/lt` manually whenever they want to train.

What still works in Codex:
- The `reviews.db` FSRS schedule is shared across Claude Code / Codex / Gemini, so progress made in one tool shows up in the others.
- All `lt` commands (`next`, `answer`, `review`, `stats`) work identically.
- `lt install-cron` schedules a daily macOS notification at `profile.daily_cron` regardless of which tool the user lives in.

If the user wants automatic nudges, recommend they run their main practice session inside Claude Code; otherwise tell them to type `/lt` whenever they want a card.
