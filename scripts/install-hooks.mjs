#!/usr/bin/env bun
/**
 * Schema-aware Claude Code settings.json hook merge (v1 Adjustment A).
 *
 * Claude Code's user-level ~/.claude/settings.json has historically used a
 * "flat" hook form { matcher, command }, while project-level
 * .claude/settings.json uses a "nested" form
 * { matcher, hooks: [{ type, command, timeout }] }. Mixing forms inside the
 * same event array is undefined — install must detect what's already there
 * and emit the matching shape (or abort if mixed).
 *
 * Idempotent: if a polyglot-hooks entry already exists for the event, the
 * script is a no-op (substring match on "polyglot-hooks").
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import process from "node:process";

const SETTINGS = join(homedir(), ".claude", "settings.json");
const HOOKS_DIR = join(homedir(), ".claude", "polyglot-hooks");

const EVENTS = /** @type {const} */ ([
  { event: "Stop", matcher: "*", script: "stop.sh" },
  { event: "UserPromptSubmit", matcher: "*", script: "user-prompt-submit.sh" },
  { event: "PostToolUse", matcher: "*", script: "post-tool-use.sh" },
]);

const FORCE_NESTED = process.argv.includes("--force-nested");

function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS, "utf-8"));
  } catch (err) {
    console.error(`error: ${SETTINGS} is not valid JSON; aborting.`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

function writeSettings(obj) {
  if (!existsSync(dirname(SETTINGS))) mkdirSync(dirname(SETTINGS), { recursive: true });
  // back up first
  if (existsSync(SETTINGS)) {
    copyFileSync(SETTINGS, `${SETTINGS}.bak.${Date.now()}`);
  }
  writeFileSync(SETTINGS, JSON.stringify(obj, null, 2) + "\n", "utf-8");
}

function detectShape(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "empty";
  let flat = 0;
  let nested = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.hooks)) nested++;
    else if (typeof entry.command === "string") flat++;
  }
  if (flat > 0 && nested > 0) return "mixed";
  if (flat > 0) return "flat";
  if (nested > 0) return "nested";
  return "empty";
}

function alreadyInstalled(arr, scriptName) {
  if (!Array.isArray(arr)) return false;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const cmd = typeof entry.command === "string" ? entry.command : "";
    const nestedCmd = Array.isArray(entry.hooks)
      ? entry.hooks.map((h) => (h && typeof h.command === "string" ? h.command : "")).join("\n")
      : "";
    const haystack = `${cmd}\n${nestedCmd}`;
    if (haystack.includes("polyglot-hooks") && haystack.includes(scriptName)) return true;
  }
  return false;
}

function buildEntryFlat(matcher, scriptName) {
  return {
    matcher,
    command: `bash ${join(HOOKS_DIR, scriptName)}`,
  };
}

function buildEntryNested(matcher, scriptName) {
  return {
    matcher,
    hooks: [
      {
        type: "command",
        command: `bash ${join(HOOKS_DIR, scriptName)}`,
        timeout: 5000,
      },
    ],
  };
}

function main() {
  const settings = readSettings();
  if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};

  const errors = [];
  const summary = [];

  for (const { event, matcher, script } of EVENTS) {
    const arr = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
    const shape = detectShape(arr);

    if (alreadyInstalled(arr, script)) {
      summary.push(`${event}: already installed → skip`);
      continue;
    }

    let useShape = shape;
    if (FORCE_NESTED) useShape = "nested";

    if (useShape === "mixed") {
      errors.push(`${event}: existing hooks mix flat + nested form. Clean up manually or rerun with --force-nested.`);
      continue;
    }

    const entry =
      useShape === "flat" ? buildEntryFlat(matcher, script) : buildEntryNested(matcher, script);

    settings.hooks[event] = [...arr, entry];
    summary.push(`${event}: installed (${useShape === "flat" ? "flat" : "nested"})`);
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${e}`);
    process.exit(2);
  }

  writeSettings(settings);
  for (const s of summary) console.log(s);
}

if (import.meta.main) {
  main();
}

// Re-exported helpers so tests can drive merge logic without spawning a process.
export { detectShape, alreadyInstalled, buildEntryFlat, buildEntryNested };
