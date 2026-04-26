import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_FILE } from "../../src/paths.ts";

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

/** Read raw stdin payload from Claude Code as JSON, or return null on any failure. */
export async function readHookPayload<T = Record<string, unknown>>(): Promise<T | null> {
  try {
    if (process.stdin.isTTY) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Emit a Claude Code hook response to stdout. Empty additionalContext = no inject. */
export function emitHook(eventName: string, additionalContext: string): void {
  const out = additionalContext
    ? { hookSpecificOutput: { hookEventName: eventName, additionalContext } }
    : {};
  process.stdout.write(JSON.stringify(out));
}

/** Append a NDJSON event to lt.log for observability. */
export function logEvent(event: Record<string, unknown>): void {
  try {
    if (!existsSync(dirname(LOG_FILE))) mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", "utf-8");
  } catch {
    // best-effort
  }
}
