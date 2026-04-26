#!/bin/bash
# UserPromptSubmit pre-gate. Always invokes bun (cheap path: due-count probe +
# immersion + cn detection). Pre-gate bails early when:
#   1. profile.yaml is missing (fresh install — nothing to inject)
#   2. do_not_disturb_until is in the future
#   3. respect_work_hours=true and we're outside the configured window
# All other branches let the ts impl decide (it's the orchestration point for
# session-start due-count, immersion, and Chinese reverse-prompt).
set -u

exec 3<&0

PROFILE="$HOME/.config/polyglot/profile.yaml"
[ -f "$PROFILE" ] || exit 0

DND_UNTIL=$(grep '^do_not_disturb_until:' "$PROFILE" | awk '{print $2}')
NOW_MS=$(($(date +%s) * 1000))
case "$DND_UNTIL" in
  ''|'null') ;;
  *)
    if awk -v now="$NOW_MS" -v until="$DND_UNTIL" 'BEGIN{exit !(now < until)}'; then
      exit 0
    fi
    ;;
esac

LT_BIN="$HOME/.local/bin/lt"
if [ ! -x "$LT_BIN" ]; then
  LT_BIN="bun /Users/setsuna-new/Documents/jp-trainer/src/cli.ts"
fi

RESPECT_WH=$(grep '^respect_work_hours:' "$PROFILE" | awk '{print $2}')
if [ "$RESPECT_WH" = "true" ]; then
  $LT_BIN inject-decide --rate 1 --respect-work-hours >/dev/null 2>&1 || exit 0
fi

HOOKS_DIR="$HOME/.claude/jp-trainer-hooks"
[ ! -d "$HOOKS_DIR" ] && HOOKS_DIR="/Users/setsuna-new/Documents/jp-trainer/hooks"

exec bun "$HOOKS_DIR/user-prompt-submit.ts" <&3
