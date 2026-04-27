#!/bin/bash
# polyglot / lt installer.
#
# Steps:
#   1. ensure bun is on PATH (prompt user if missing — never auto-curl)
#   2. bun install (resolve deps)
#   3. bun build → ~/.local/bin/lt single binary
#   4. xattr -d com.apple.quarantine to dodge Sequoia Gatekeeper
#   5. copy skills/*.skill.md → ~/.claude/skills/polyglot-<name>/SKILL.md
#   6. copy hooks/* → ~/.claude/polyglot-hooks/
#   7. node scripts/install-hooks.mjs to wire ~/.claude/settings.json
#   8. lt install-cron (if profile.daily_cron set)
#   9. register daily-backup.sh launchd plist (Critic fix #2)
#   10. smoke tests
#   11. (Critic fix #8) substep 12.7: scan cwd .claude/settings.json for
#       'jp-trainer-hooks'/'polyglot-hooks'/'lt-' substrings and warn.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST_BIN="$HOME/.local/bin/lt"
DEST_HOOKS="$HOME/.claude/polyglot-hooks"
DEST_SKILLS="$HOME/.claude/skills"

log() { printf '[install] %s\n' "$*"; }
warn() { printf '[install:warn] %s\n' "$*" >&2; }
err()  { printf '[install:err] %s\n' "$*" >&2; }

# 1. bun availability
if ! command -v bun >/dev/null 2>&1; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    err "bun not found on PATH. Install bun first: https://bun.sh — then re-run this script."
    exit 1
  fi
fi
log "bun: $(command -v bun) ($(bun --version))"

# 2. resolve deps
log "bun install"
( cd "$REPO_DIR" && bun install --silent ) || { err "bun install failed"; exit 1; }

# 3. compile single binary
mkdir -p "$(dirname "$DEST_BIN")"
log "bun build → $DEST_BIN"
( cd "$REPO_DIR" && bun build src/cli.ts --compile --outfile "$DEST_BIN" ) || { err "bun build failed"; exit 1; }
chmod +x "$DEST_BIN"

# Compiled binary expects templates next to it (cli.ts probes
# dirname(execPath)/../templates and ~/.local/share/polyglot/templates).
TEMPLATES_DEST="$HOME/.local/share/polyglot/templates"
mkdir -p "$TEMPLATES_DEST"
cp "$REPO_DIR"/templates/*.plist "$TEMPLATES_DEST/" 2>/dev/null || true
log "templates copied to $TEMPLATES_DEST"

# 4. drop Sequoia quarantine bit (silent if not on macOS)
if command -v xattr >/dev/null 2>&1; then
  xattr -d com.apple.quarantine "$DEST_BIN" 2>/dev/null || true
fi

# 5. copy skills
mkdir -p "$DEST_SKILLS"
for skill in "$REPO_DIR"/skills/*.skill.md; do
  [ -f "$skill" ] || continue
  name="$(basename "$skill" .skill.md)"
  target_dir="$DEST_SKILLS/polyglot-$name"
  mkdir -p "$target_dir"
  cp "$skill" "$target_dir/SKILL.md"
done
log "skills installed under $DEST_SKILLS/polyglot-*"

# 6. copy hooks
mkdir -p "$DEST_HOOKS"
mkdir -p "$DEST_HOOKS/lib"
cp "$REPO_DIR"/hooks/*.sh "$DEST_HOOKS/" 2>/dev/null || true
cp "$REPO_DIR"/hooks/*.ts "$DEST_HOOKS/" 2>/dev/null || true
cp "$REPO_DIR"/hooks/lib/*.ts "$DEST_HOOKS/lib/" 2>/dev/null || true
chmod +x "$DEST_HOOKS"/*.sh 2>/dev/null || true
log "hooks installed under $DEST_HOOKS"

# 7. wire ~/.claude/settings.json (schema-aware merge — Adj-A)
log "merging hook entries into ~/.claude/settings.json"
if ! ( cd "$REPO_DIR" && bun run scripts/install-hooks.mjs ); then
  warn "install-hooks.mjs reported a problem — review its output and rerun if needed"
fi

# 8. daily cron (if user opted in)
if [ -f "$HOME/.config/polyglot/profile.yaml" ]; then
  CRON_VAL=$(grep '^daily_cron:' "$HOME/.config/polyglot/profile.yaml" | awk '{print $2}')
  if [ -n "$CRON_VAL" ] && [ "$CRON_VAL" != '""' ] && [ "$CRON_VAL" != "''" ]; then
    log "registering daily push cron via lt install-cron"
    "$DEST_BIN" install-cron || warn "lt install-cron failed (non-fatal)"
  fi
fi

# 8.5. Linux: offer to install edge-tts (D13 Linux fallback for TTS).
#      macOS users skip this whole block — the `say` binary is built-in.
if [ "$(uname -s)" = "Linux" ]; then
  log "Linux detected — checking edge-tts (Python TTS fallback for D13)"
  if ! command -v edge-tts >/dev/null 2>&1; then
    if command -v pipx >/dev/null 2>&1; then
      log "installing edge-tts via pipx"
      pipx install edge-tts || warn "pipx install edge-tts failed — install manually: pipx install edge-tts"
    elif command -v pip3 >/dev/null 2>&1; then
      log "installing edge-tts via pip3 --user"
      pip3 install --user edge-tts || warn "pip3 install --user edge-tts failed — install manually"
    else
      warn "neither pipx nor pip3 found. Install Python 3.8+ then run: pipx install edge-tts"
      warn "Without edge-tts, lt will silent-skip TTS on Linux (D13 fallback)."
    fi
  else
    log "edge-tts already installed: $(command -v edge-tts)"
  fi

  # Auto-set tts_engine=edge in profile if user is on Linux and didn't override.
  if [ -f "$HOME/.config/polyglot/profile.yaml" ]; then
    if grep -q "^tts_engine: macos" "$HOME/.config/polyglot/profile.yaml"; then
      log "rewriting profile.tts_engine: macos → edge (Linux default)"
      # use sed -i.bak for portability across GNU/BSD; remove backup after.
      sed -i.bak 's/^tts_engine: macos/tts_engine: edge/' "$HOME/.config/polyglot/profile.yaml" || true
      rm -f "$HOME/.config/polyglot/profile.yaml.bak"
    fi
  fi
fi

# 9. daily backup launchd (Critic fix #2). macOS-only — Linux users should
#    set up an equivalent cron entry manually.
PLIST="$HOME/Library/LaunchAgents/com.polyglot.daily-backup.plist"
if [ "$(uname -s)" = "Darwin" ] && [ ! -f "$PLIST" ]; then
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.polyglot.daily-backup</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/daily-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/polyglot-backup.log</string>
  <key>StandardErrorPath</key><string>/tmp/polyglot-backup.err</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST" || warn "launchctl load failed (non-fatal)"
  log "daily-backup launchd plist installed: $PLIST"
fi

# 10. smoke tests
log "smoke: lt --version"
"$DEST_BIN" --version
log "smoke: hooks/stop.sh on empty stdin"
bash "$DEST_HOOKS/stop.sh" </dev/null
log "smoke: lt due-count"
"$DEST_BIN" due-count >/dev/null

# 11. Critic fix #8 — scan cwd .claude/settings.json for legacy / duplicate hook refs
CWD_SETTINGS="$(pwd)/.claude/settings.json"
if [ -f "$CWD_SETTINGS" ]; then
  matches=$(grep -E "jp-trainer-hooks|polyglot-hooks|lt-" "$CWD_SETTINGS" || true)
  if [ -n "$matches" ]; then
    warn "[12.7] cwd .claude/settings.json contains polyglot/lt hook references:"
    printf '%s\n' "$matches" | sed 's/^/  /' >&2
    warn "  Project-level hooks may run *in addition to* user-level ones — review manually."
    warn "  Run \"lt doctor\" after install to audit duplicates."
  fi
fi

log "done. lt --version → $($DEST_BIN --version)"
