#!/usr/bin/env bash
# Daily backup of polyglot reviews.db.
#
# Uses the SQLite online backup API (.backup) instead of cp because polyglot
# runs in WAL mode — `cp reviews.db` would miss in-flight writes living in the
# -wal file. The .backup API is WAL-aware and produces a consistent snapshot
# even while the database is open and being written.
#
# Retention: 7-day weekday rolling (Mon..Sun). At any time at most 7 backups
# exist; each weekday's backup is overwritten once a week.
set -euo pipefail

CONFIG_DIR="${POLYGLOT_CONFIG_DIR:-$HOME/.config/polyglot}"
DB="$CONFIG_DIR/reviews.db"
BAK_DIR="$CONFIG_DIR/backup"
LOG_FILE="$CONFIG_DIR/lt.log"

log_event() {
  local payload="$1"
  mkdir -p "$CONFIG_DIR"
  printf '%s\n' "$payload" >> "$LOG_FILE"
}

if [ ! -f "$DB" ]; then
  log_event "{\"ts\":$(date +%s)000,\"event\":\"daily_backup_skipped\",\"reason\":\"no_db\",\"db\":\"$DB\"}"
  exit 0
fi

mkdir -p "$BAK_DIR"
# Force C locale so weekday is always Mon..Sun regardless of system LANG.
WEEKDAY="$(LC_ALL=C date +%a)"
TARGET="$BAK_DIR/reviews.db.bak.$WEEKDAY"
TMP="$TARGET.tmp"

# .backup writes through a fresh connection; transient lock-busy is rare but
# we still rely on busy_timeout=5000 set on every polyglot connection.
sqlite3 "$DB" ".backup '$TMP'"
mv "$TMP" "$TARGET"

SIZE="$(wc -c < "$TARGET" | tr -d ' ')"
log_event "{\"ts\":$(date +%s)000,\"event\":\"daily_backup_ok\",\"target\":\"$TARGET\",\"size_bytes\":$SIZE}"
echo "backup ok: $TARGET ($SIZE bytes)"
