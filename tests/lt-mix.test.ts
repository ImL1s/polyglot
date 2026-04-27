import { describe, test, expect, beforeEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import YAML from "yaml";

/**
 * Task 4 (Critic v3 fix #2 / Adj-H) — `lt mix <preset>` and `lt immersion <state>`
 * CLI contract.
 *
 * Each test isolates ~/.config/polyglot via a fresh tmp dir so we never
 * trash the user's real profile.
 */
const REPO = join(import.meta.dir, "..");
const CLI = join(REPO, "src", "cli.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
  configDir: string;
}

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "lt-mix-test-"));
}

function runLt(args: string[], home: string): RunResult {
  const res = spawnSync("bun", [CLI, ...args], {
    encoding: "utf-8",
    timeout: 10000,
    env: { ...process.env, HOME: home },
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: typeof res.status === "number" ? res.status : 1,
    configDir: join(home, ".config", "polyglot"),
  };
}

function readProfileLevel(configDir: string): number {
  const profilePath = join(configDir, "profile.yaml");
  const raw = readFileSync(profilePath, "utf-8");
  const parsed = YAML.parse(raw) as { immersion_level?: number };
  return parsed.immersion_level ?? 0;
}

describe("lt mix — preset enforcement", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });

  test("lt mix 0 → immersion_level=0", () => {
    const r = runLt(["mix", "0"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":0');
    expect(readProfileLevel(r.configDir)).toBe(0);
  });

  test("lt mix 10 → immersion_level=0.1", () => {
    const r = runLt(["mix", "10"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":0.1');
    expect(readProfileLevel(r.configDir)).toBe(0.1);
  });

  test("lt mix 25 → immersion_level=0.25", () => {
    const r = runLt(["mix", "25"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":0.25');
    expect(readProfileLevel(r.configDir)).toBe(0.25);
  });

  test("lt mix 50 → immersion_level=0.5", () => {
    const r = runLt(["mix", "50"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":0.5');
    expect(readProfileLevel(r.configDir)).toBe(0.5);
  });

  test("lt mix 100 → immersion_level=1.0", () => {
    const r = runLt(["mix", "100"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":1');
    expect(readProfileLevel(r.configDir)).toBe(1);
  });

  test("lt mix 35 → exit 2 + helpful error message", () => {
    const r = runLt(["mix", "35"], home);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("0 / 10 / 25 / 50 / 100");
    expect(r.stderr).toContain("--custom");
  });

  test("lt mix abc → exit 2", () => {
    const r = runLt(["mix", "abc"], home);
    expect(r.code).toBe(2);
  });

  test("lt mix 99 → exit 2 (not a preset, even though valid number)", () => {
    const r = runLt(["mix", "99"], home);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--custom 99");
  });

  test("lt mix --custom 35 → bypass with custom=true marker", () => {
    const r = runLt(["mix", "--custom", "35"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"level":0.35');
    expect(r.stdout).toContain('"custom":true');
    expect(readProfileLevel(r.configDir)).toBeCloseTo(0.35, 2);
  });

  test("lt mix --custom 0 → immersion_level=0", () => {
    const r = runLt(["mix", "--custom", "0"], home);
    expect(r.code).toBe(0);
    expect(readProfileLevel(r.configDir)).toBe(0);
  });

  test("lt mix --custom 100 → immersion_level=1.0", () => {
    const r = runLt(["mix", "--custom", "100"], home);
    expect(r.code).toBe(0);
    expect(readProfileLevel(r.configDir)).toBe(1);
  });

  test("lt mix --custom 150 → exit 2 (out of range)", () => {
    const r = runLt(["mix", "--custom", "150"], home);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("0-100");
  });

  test("lt mix --custom -5 → exit 2 (negative)", () => {
    const r = runLt(["mix", "--custom", "-5"], home);
    expect(r.code).toBe(2);
  });

  test("lt mix status → returns current level as JSON (default 0)", () => {
    const r = runLt(["mix", "status"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"immersion_level":0');
  });

  test("lt mix without arg → returns current level (same as status)", () => {
    runLt(["mix", "25"], home);
    const r = runLt(["mix"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"immersion_level":0.25');
  });

  test("lt mix 100 creates IMMERSION_FLAG (back-compat with /lt-on)", () => {
    const r = runLt(["mix", "100"], home);
    expect(r.code).toBe(0);
    const flagPath = join(r.configDir, "immersion.flag");
    expect(existsSync(flagPath)).toBe(true);
  });

  test("lt mix 0 removes IMMERSION_FLAG", () => {
    runLt(["mix", "100"], home);
    const r = runLt(["mix", "0"], home);
    expect(r.code).toBe(0);
    const flagPath = join(r.configDir, "immersion.flag");
    expect(existsSync(flagPath)).toBe(false);
  });
});

describe("lt immersion — back-compat alias", () => {
  let home: string;
  beforeEach(() => {
    home = freshHome();
  });

  test("lt immersion on → immersion_level=1.0", () => {
    const r = runLt(["immersion", "on"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("immersion: on");
    expect(readProfileLevel(r.configDir)).toBe(1);
  });

  test("lt immersion off → immersion_level=0", () => {
    runLt(["immersion", "on"], home);
    const r = runLt(["immersion", "off"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("immersion: off");
    expect(readProfileLevel(r.configDir)).toBe(0);
  });

  test("lt immersion 25 → immersion_level=0.25", () => {
    const r = runLt(["immersion", "25"], home);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("level=0.25");
    expect(readProfileLevel(r.configDir)).toBe(0.25);
  });

  test("lt immersion 50 → immersion_level=0.50", () => {
    const r = runLt(["immersion", "50"], home);
    expect(r.code).toBe(0);
    expect(readProfileLevel(r.configDir)).toBe(0.5);
  });

  test("lt immersion 35 → exit 2 + suggest --custom", () => {
    const r = runLt(["immersion", "35"], home);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--custom 35");
  });

  test("lt immersion status → on/off based on profile, not flag file", () => {
    runLt(["mix", "25"], home);
    const r = runLt(["immersion", "status"], home);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe("on");
  });

  test("lt immersion toggle → flips between on/off", () => {
    let r = runLt(["immersion", "toggle"], home);
    expect(r.stdout).toContain("immersion: on");
    expect(readProfileLevel(r.configDir)).toBe(1);

    r = runLt(["immersion", "toggle"], home);
    expect(r.stdout).toContain("immersion: off");
    expect(readProfileLevel(r.configDir)).toBe(0);
  });
});
