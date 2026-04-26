import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

// End-to-end smoke test that mirrors README §5.1 — runs the actual `lt` CLI
// against an isolated HOME so it can't pollute the dev's real ~/.config/polyglot/.
//
// We invoke each subcommand the same way Claude Code / Codex / Gemini do:
// `bun run src/cli.ts <subcmd> ...` — no mocks, real bun:sqlite + ts-fsrs.

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLI = join(REPO_ROOT, "src", "cli.ts");

let HOME: string;

function lt(args: string[]): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", ["run", CLI, ...args], {
    env: { ...process.env, HOME },
    encoding: "utf-8",
    cwd: REPO_ROOT,
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: res.status ?? -1,
  };
}

beforeAll(() => {
  HOME = mkdtempSync(join(tmpdir(), "polyglot-e2e-"));
});

afterAll(() => {
  if (HOME && existsSync(HOME)) rmSync(HOME, { recursive: true, force: true });
});

describe("e2e: full-flow setup → seed → next → answer → stats → review", () => {
  test("step 1: lt setup writes profile.yaml", () => {
    const r = lt(["setup"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("profile written");

    const profilePath = join(HOME, ".config", "polyglot", "profile.yaml");
    expect(existsSync(profilePath)).toBe(true);

    const yaml = readFileSync(profilePath, "utf-8");
    expect(yaml).toContain("level: N3");
    expect(yaml).toContain("active_language: ja");
    expect(yaml).toContain("immersion_level: 0");
  });

  test("step 2: lt seed-import inserts ~6000 N5-N2 cards", () => {
    const r = lt(["seed-import"]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.inserted).toBeGreaterThan(5000);
    expect(out.files.length).toBeGreaterThanOrEqual(4); // n2/n3/n4/n5 vocab at minimum
    expect(out.files.some((f: string) => f.endsWith("n5-vocab.yaml"))).toBe(true);
  });

  test("step 3: lt next --json returns a valid concept JSON", () => {
    const r = lt(["next", "--json"]);
    expect(r.code).toBe(0);
    const concept = JSON.parse(r.stdout);
    expect(typeof concept.id).toBe("string");
    expect(concept.id.length).toBeGreaterThan(0);
    expect(["vocab", "grammar", "kanji", "expression"]).toContain(concept.type);
    expect(["N5", "N4", "N3", "N2", "N1"]).toContain(concept.level);
    expect(typeof concept.ja).toBe("string");
    expect(typeof concept.zh).toBe("string");
  });

  test("step 4: lt answer records a rating and reschedules", () => {
    const next = JSON.parse(lt(["next", "--json"]).stdout);
    const r = lt([
      "answer",
      "--concept-id",
      next.id,
      "--rating",
      "3",
      "--user-answer",
      "demo",
      "--feedback",
      "rubric_3_good: e2e test answer",
    ]);
    expect(r.code).toBe(0);
    const result = JSON.parse(r.stdout);
    expect(result.ok).toBe(true);
    expect(typeof result.next_due_at).toBe("string");
    expect(new Date(result.next_due_at).getTime()).toBeGreaterThan(0);
    expect(typeof result.stability).toBe("string");
    expect(typeof result.difficulty).toBe("string");
  });

  test("step 5: lt stats reflects the introduced + answered concept", () => {
    const r = lt(["stats"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Total concepts: \d+/);
    expect(r.stdout).toMatch(/Introduced: [1-9]/); // at least 1 introduced
    expect(r.stdout).toMatch(/Today: [1-9]\d* attempts/); // at least 1 attempt
    expect(r.stdout).toContain("By level:");
  });

  test("step 6: lt review handles 'nothing due' gracefully", () => {
    // After step 4 the only introduced concept is scheduled ~1 day out, so
    // nothing should be due right now. That's the expected README §5.1 output.
    const r = lt(["review", "--limit", "5"]);
    expect(r.code).toBe(0);
    // Either "Nothing due" message OR a list — both valid; we just want exit 0.
    expect(r.stdout.length).toBeGreaterThan(0);
  });

  test("step 7: lt due-count returns a numeric line", () => {
    const r = lt(["due-count"]);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+$/);
  });

  test("step 8: lt logs --tail returns NDJSON (or empty if no events yet)", () => {
    const r = lt(["logs", "--tail", "20"]);
    expect(r.code).toBe(0);
    // every emitted line must parse as JSON (NDJSON contract). Empty log is OK
    // in a fresh HOME since the answer path doesn't currently emit a log event.
    const lines = r.stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
