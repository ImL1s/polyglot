import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { getLanguageLabel, buildImmersionPrompt } from "../src/utils/immersion.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const HOOK_FILE = join(REPO_ROOT, "hooks", "user-prompt-submit.ts");
const STOP_HOOK_FILE = join(REPO_ROOT, "hooks", "stop.ts");
const POST_TOOL_HOOK_FILE = join(REPO_ROOT, "hooks", "post-tool-use.ts");
const CLI = join(REPO_ROOT, "src", "cli.ts");

let HOME: string;

function lt(args: string[], extraEnv: Record<string, string> = {}): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", ["run", CLI, ...args], {
    env: { ...process.env, HOME, ...extraEnv },
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", code: res.status ?? -1 };
}

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "polyglot-en-mix-"));
  // Setup once + seed-import once for all integration tests
  lt(["setup"]);
  lt(["seed-import"]);
});

afterAll(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("en mix-only — unit/regression guards", () => {
  test("U1: getLanguageLabel('en') returns '英文 (en)'", () => {
    expect(getLanguageLabel("en")).toBe("英文 (en)");
  });

  test("U2: buildImmersionPrompt level 0.5 en contains an English example fragment", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "en", isCode: false }) ?? "";
    // Inspect LANGUAGE_PACKS.en.exampleBilingual / exampleBilingual2 for known fragments
    expect(out.length).toBeGreaterThan(0);
    // At least one of the en bilingual examples should appear
    const hasEnExample = out.includes("Fixed it") || out.includes("Let me check the logs");
    expect(hasEnExample).toBe(true);
  });

  test("U3: buildImmersionPrompt level 1.0 en contains 'I've already fixed this bug'", () => {
    const out = buildImmersionPrompt({ level: 1.0, language: "en", isCode: false }) ?? "";
    expect(out).toContain("I've already fixed this bug");
  });

  test("U4: buildImmersionPrompt with empty string language falls back to ja pack (Layer 2 pre-existing safety net)", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "", isCode: false }) ?? "";
    // Layer 2 fallback: empty string → ctx.language || "ja" → ja pack
    // ja pack has 直しました example
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain("直しました");
  });

  test("U4b: hook source contains the literal 'profile.mix_language || profile.active_language' (Layer 1 regression guard — source-grep)", () => {
    const src = readFileSync(HOOK_FILE, "utf-8");
    expect(src).toContain("profile.mix_language || profile.active_language");
  });

  test("U5: hook source contains 'mix_language' string (wire existence guard)", () => {
    const src = readFileSync(HOOK_FILE, "utf-8");
    expect(src).toContain("mix_language");
  });

  test("U5b: hook source declares NDJSON_EVENT_SCHEMA_VERSION constant + uses it in event emits", () => {
    const src = readFileSync(HOOK_FILE, "utf-8");
    // Constant must be declared and exported
    expect(src).toContain("NDJSON_EVENT_SCHEMA_VERSION");
    expect(src).toMatch(/export\s+const\s+NDJSON_EVENT_SCHEMA_VERSION\s*=\s*\d+/);
    // Must appear at least 4 times: once for the export + 3 event emit sites
    // (ambient_skip + ambient_inject vocab branch + ambient_inject full branch)
    const occurrences = (src.match(/NDJSON_EVENT_SCHEMA_VERSION/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(4);
    // Each event emit site must reference the constant via event_schema_version key
    const eventFieldOccurrences = (src.match(/event_schema_version:\s*NDJSON_EVENT_SCHEMA_VERSION/g) ?? []).length;
    expect(eventFieldOccurrences).toBeGreaterThanOrEqual(3);
  });

  test("U6: hook source does NOT contain hardcoded \"en\" outside comments", () => {
    const src = readFileSync(HOOK_FILE, "utf-8");
    // Strip line comments before searching for "en" literal
    const stripped = src
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    // Also strip block comments (rough — adequate for this hook file)
    const noBlockComments = stripped.replace(/\/\*[\s\S]*?\*\//g, "");
    // Search for "en" with surrounding double quotes (the literal string "en")
    expect(noBlockComments).not.toMatch(/"en"/);
  });

  test("U7: hooks/stop.ts source does NOT contain 'mix_language' (Principle 5 negative guard)", () => {
    const src = readFileSync(STOP_HOOK_FILE, "utf-8");
    expect(src).not.toContain("mix_language");
  });

  test("U8: hooks/post-tool-use.ts source does NOT contain 'mix_language' (Principle 5 negative guard)", () => {
    const src = readFileSync(POST_TOOL_HOOK_FILE, "utf-8");
    expect(src).not.toContain("mix_language");
  });
});

describe("en mix-only — integration (real CLI)", () => {
  test("I1: lt mix-vocab --language en returns non-empty after seed-import", () => {
    const r = lt(["mix-vocab", "--language", "en"]);
    expect(r.code).toBe(0);
    // Output is JSON array (per cli.ts, mix-vocab outputs JSON)
    const trimmed = r.stdout.trim();
    expect(trimmed.length).toBeGreaterThan(0);
    const parsed = JSON.parse(trimmed);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    // Each item should have id, ja, zh
    expect(parsed[0].id).toMatch(/^en-vocab-/);
  });

  test("I2: lt language switch en exits 2 and stderr contains 'mix_language'", () => {
    const r = lt(["language", "switch", "en"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("mix_language");
  });

  test("I3: lt config mix_language=en persists; --show contains the field", () => {
    const setRes = lt(["config", "mix_language=en"]);
    expect(setRes.code).toBe(0);
    const showRes = lt(["config", "--show"]);
    expect(showRes.code).toBe(0);
    expect(showRes.stdout).toContain("mix_language");
    // Profile YAML on disk should also contain it
    const profilePath = join(HOME, ".config", "polyglot", "profile.yaml");
    const yaml = readFileSync(profilePath, "utf-8");
    expect(yaml).toContain("mix_language: en");
  });

  test("I4: lt config mix_language= sets empty string; buildImmersionPrompt with empty language still falls through to ja pack (Layer 2 safety net under empty-string conditions)", () => {
    // Reset to empty
    lt(["config", "mix_language="]);
    const showRes = lt(["config", "--show"]);
    expect(showRes.code).toBe(0);
    // Profile shows mix_language as empty (parseValue("") returns "")
    // But buildImmersionPrompt with empty string still produces ja content via Layer 2:
    const out = buildImmersionPrompt({ level: 0.5, language: "", isCode: false }) ?? "";
    expect(out).toContain("直しました");
  });
});
