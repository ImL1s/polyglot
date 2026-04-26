import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { CONFIG_DIR } from "../../src/paths.ts";
import type { Profile } from "../../src/profile.ts";

/**
 * Adj-F throttling: respect inject_max_per_hour, inject_max_per_session,
 * do_not_disturb_until. Counts live in a per-session JSON file under
 * CONFIG_DIR/sessions/<sessionId>/inject-count.json.
 *
 * sessionId comes from $CLAUDE_CODE_SESSION_ID when present (Claude Code
 * sets it on every hook invocation), otherwise we fall back to "default".
 */

interface CountFile {
  session_total: number;
  hour_bucket_ts: number;     // ms timestamp of bucket start (floor to hour)
  hour_bucket_count: number;
}

function sessionId(): string {
  return process.env.CLAUDE_CODE_SESSION_ID ?? "default";
}

function countFile(): string {
  return join(CONFIG_DIR, "sessions", sessionId(), "inject-count.json");
}

function readCounts(): CountFile {
  const fp = countFile();
  if (!existsSync(fp)) {
    return { session_total: 0, hour_bucket_ts: 0, hour_bucket_count: 0 };
  }
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as CountFile;
  } catch {
    return { session_total: 0, hour_bucket_ts: 0, hour_bucket_count: 0 };
  }
}

function writeCounts(c: CountFile): void {
  const fp = countFile();
  if (!existsSync(dirname(fp))) mkdirSync(dirname(fp), { recursive: true });
  writeFileSync(fp, JSON.stringify(c), "utf-8");
}

function hourBucketStart(now: number): number {
  return now - (now % (60 * 60 * 1000));
}

/** Returns true if any of: DND active / hour cap hit / session cap hit. */
export function shouldThrottle(profile: Profile, now: number = Date.now()): { throttle: boolean; reason?: string } {
  if (profile.do_not_disturb_until && now < profile.do_not_disturb_until) {
    return { throttle: true, reason: "dnd" };
  }
  const counts = readCounts();
  if (counts.session_total >= profile.inject_max_per_session) {
    return { throttle: true, reason: "session_cap" };
  }
  const bucket = hourBucketStart(now);
  if (counts.hour_bucket_ts === bucket && counts.hour_bucket_count >= profile.inject_max_per_hour) {
    return { throttle: true, reason: "hour_cap" };
  }
  return { throttle: false };
}

/** Increment counters after a successful inject. Idempotent on the bucket roll. */
export function recordInject(now: number = Date.now()): void {
  const counts = readCounts();
  const bucket = hourBucketStart(now);
  if (counts.hour_bucket_ts !== bucket) {
    counts.hour_bucket_ts = bucket;
    counts.hour_bucket_count = 0;
  }
  counts.hour_bucket_count += 1;
  counts.session_total += 1;
  writeCounts(counts);
}
