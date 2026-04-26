# Cross-tool honest framing (v1 Adjustment B)

`polyglot` ships as a single `lt` CLI plus a per-tool integration layer.
The FSRS scheduling database is shared across all tools, but **only Claude Code has
a hook layer** — so automatic injection ("ambient" practice) only works there.

| Tool | Auto-inject | Manual `/lt` | Shared db |
|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ |
| Codex | ❌ | ✅ | ✅ |
| Gemini | ❌ | ✅ | ✅ |

## Column meaning

- **Auto-inject** — Stop hook (post-turn reminders of due cards) + UserPromptSubmit
  hook (probabilistic "mix in a Japanese question" probe). Only Claude Code exposes
  these hook events; Codex / Gemini do not.
- **Manual `/lt`** — User explicitly types `/lt` (or invokes the `lt` CLI) to start
  a practice session. Works identically in every tool because it just shells out.
- **Shared db** — `~/.config/polyglot/reviews.db` (FSRS-5 schedule). Any tool that
  calls `lt next` / `lt answer` reads and writes the same SQLite file, so progress
  made in Claude Code shows up next time you run `lt next` from Codex or Gemini.

## What this means for users

- If your daily driver is Claude Code, you get the full ambient experience: daily
  due-count nudges + occasional in-flight probes.
- If you live in Codex or Gemini, `lt` becomes a manual SRS CLI. You must remember
  to type `/lt` (or just run `lt next` in a terminal). The shared db ensures you
  don't lose progress when bouncing between tools.
- The `lt install-cron` macOS daily notification is tool-agnostic — it fires at
  `profile.daily_cron` regardless of which CLI you happen to be in that day.

## Why we kept it this way

Plan v1 Principle 2 originally read "single source of truth across Claude /
Codex / Gemini / CLI". Architect review (T3 / P2) flagged this as misleading
because shared-reads ≠ shared-experience: only one tool actually surfaces the
practice prompts unprompted. v4 + Adjustment B keeps the cross-tool db (real
benefit) and is upfront about the auto-injection asymmetry (the real limit).
