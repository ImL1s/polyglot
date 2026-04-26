#!/bin/bash
# PostToolUse pre-gate. Two-stage gate:
#   1. dice roll vs profile.post_tool_inject_rate (avoid bun cold-start)
#   2. work-hours / DND gate via CLI
# The ts impl then re-checks tool_response.duration_ms and emits the actual
# vocab-card additionalContext when both gates pass.
set -u

exec 3<&0

PROFILE="$HOME/.config/polyglot/profile.yaml"
[ -f "$PROFILE" ] || exit 0

POST_RATE=$(grep '^post_tool_inject_rate:' "$PROFILE" | awk '{print $2}')
[ -z "$POST_RATE" ] && exit 0

ROLL=$(awk -v seed=$RANDOM 'BEGIN{srand(seed); print rand()}')
awk -v r="$ROLL" -v rate="$POST_RATE" 'BEGIN{exit !(r < rate)}' || exit 0

LT_BIN="$HOME/.local/bin/lt"
if [ ! -x "$LT_BIN" ]; then
  LT_BIN="bun /Users/setsuna-new/Documents/jp-trainer/src/cli.ts"
fi

DND_UNTIL=$(grep '^do_not_disturb_until:' "$PROFILE" | awk '{print $2}')
NOW_MS=$(($(date +%s) * 1000))
case "$DND_UNTIL" in
  ''|'null') ;;
  *)
    awk -v now="$NOW_MS" -v until="$DND_UNTIL" 'BEGIN{exit !(now < until)}' && exit 0
    ;;
esac

RESPECT_WH=$(grep '^respect_work_hours:' "$PROFILE" | awk '{print $2}')
if [ "$RESPECT_WH" = "true" ]; then
  $LT_BIN inject-decide --rate 1 --respect-work-hours >/dev/null 2>&1 || exit 0
fi

HOOKS_DIR="$HOME/.claude/jp-trainer-hooks"
[ ! -d "$HOOKS_DIR" ] && HOOKS_DIR="/Users/setsuna-new/Documents/jp-trainer/hooks"

exec bun "$HOOKS_DIR/post-tool-use.ts" <&3
