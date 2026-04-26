## polyglot Language Trainer (lt CLI)

`lt` CLI is in `$PATH`. When the user says `/lt` or asks to practice (Japanese vocab/grammar, JLPT review, etc.), drive a session against the shared FSRS scheduler.

### Practice flow

1. `lt next --json` → next due concept as JSON (id, level, kind, prompt, rubric_hints).
2. Render a question; apply the rubric (see `~/.claude/skills/lt/lt.skill.md` if accessible) or general level heuristics (N5/N4 = meaning + recognition, N3 = production, N2 = nuance + register).
3. After the user answers, record:
   ```
   lt answer --concept-id <id> --rating <again|hard|good|easy> --user-answer "<verbatim>" --feedback "rubric_line: <eval>"
   ```
4. Loop until stop or `lt due-count` returns 0.

### Other commands

- `lt review` — list due concepts (default 20)
- `lt stats` — progress summary
- `lt due-count` — integer count
- `lt config <key=value>` — read/update profile
- `lt logs --event answer_recorded --tail 10` — NDJSON tail

### Profile + data

- Profile: `~/.config/polyglot/profile.yaml`
- DB: `~/.config/polyglot/reviews.db` (shared FSRS schedule across Claude / Codex / Gemini)
- Log: `~/.config/polyglot/lt.log`

### Honest cross-tool framing (v1 Adjustment B)

**Gemini CLI does not provide a hook layer comparable to Claude Code's Stop / UserPromptSubmit hooks.** That means:

- Ambient daily-due reminders **are not auto-injected** in Gemini sessions.
- Keyword-based probes (auto-mixing a Japanese question into your prompt) **are not available**.
- Users must invoke `/lt` manually to start a practice round.

What still works:
- Shared `reviews.db` — answering in Claude Code shows up next time you run `lt next` from Gemini.
- All `lt` subcommands work identically across tools.
- `lt install-cron` macOS daily notification is tool-agnostic.

> **Note**: Gemini-specific slash command / system prompt syntax may vary between Gemini CLI versions. If `/lt` does not auto-trigger this snippet, the user can invoke `lt` directly in a terminal step or paste this snippet into the active Gemini session as a system reminder. Adjust to your Gemini CLI's conventions as needed.

If the user wants automatic nudges, recommend they run their main practice session inside Claude Code; otherwise tell them to type `/lt` whenever they want a card.
