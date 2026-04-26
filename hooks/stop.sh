#!/bin/bash
# Stop hook pre-gate. Avoids bun cold-start ~85% of the time (Adjustment D).
# Reads inject_rate from profile.yaml; rolls a die in awk; only invokes bun
# when the gate passes. Falls back to silent exit on any unexpected condition.
set -u

# Preserve stdin so bun can read the Claude Code hook payload.
exec 3<&0

PROFILE="$HOME/.config/polyglot/profile.yaml"
[ -f "$PROFILE" ] || exit 0

RATE=$(grep '^inject_rate:' "$PROFILE" | awk '{print $2}')
[ -z "$RATE" ] && exit 0

ROLL=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); print rand()}')
awk -v r="$ROLL" -v rate="$RATE" 'BEGIN{exit !(r < rate)}' || exit 0

# Optional: gate work-hours via the existing CLI. Falls back to bun runtime
# if the compiled binary is not on PATH yet.
LT_BIN="$HOME/.local/bin/lt"
if [ ! -x "$LT_BIN" ]; then
  LT_BIN="bun /Users/setsuna-new/Documents/jp-trainer/src/cli.ts"
fi
$LT_BIN inject-decide --rate 1 --respect-work-hours >/dev/null 2>&1 || exit 0

HOOKS_DIR="$HOME/.claude/jp-trainer-hooks"
[ ! -d "$HOOKS_DIR" ] && HOOKS_DIR="/Users/setsuna-new/Documents/jp-trainer/hooks"

exec bun "$HOOKS_DIR/stop.ts" <&3
