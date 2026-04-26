import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_FILE } from "../../paths.ts";

/**
 * Hooks must never block the user's shell flow. Any unexpected condition
 * inside a hook calls safeFail() which records a single NDJSON line and
 * exits 0 so Claude Code / Codex / Gemini keeps running.
 */
export function safeFail(reason: string): never {
  const event = {
    ts: Date.now(),
    event: "hook_silent_fail",
    reason,
  };
  try {
    if (!existsSync(dirname(LOG_FILE))) mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // even logging is allowed to fail silently — never throw out of safeFail
  }
  process.exit(0);
}
