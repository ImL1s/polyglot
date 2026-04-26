import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, lstatSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfigDir } from "../src/paths.ts";

let tmp: string;

beforeEach(() => {
  tmp = join(tmpdir(), `polyglot-paths-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmp, { recursive: true });
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

describe("resolveConfigDir migration", () => {
  test("fresh install: neither old nor new exists → creates polyglot dir", () => {
    const dir = resolveConfigDir(tmp);
    expect(dir).toBe(join(tmp, ".config", "polyglot"));
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(tmp, ".config", "jp-trainer"))).toBe(false);
  });

  test("legacy: only ~/.config/jp-trainer exists with a profile → mv to polyglot, leave symlink, log event", () => {
    const oldDir = join(tmp, ".config", "jp-trainer");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "profile.yaml"), "level: N3\n", "utf-8");
    writeFileSync(join(oldDir, "reviews.db"), "fakeblob", "utf-8");

    const dir = resolveConfigDir(tmp);
    const newDir = join(tmp, ".config", "polyglot");
    expect(dir).toBe(newDir);

    // new dir contains the profile + db
    expect(existsSync(join(newDir, "profile.yaml"))).toBe(true);
    expect(readFileSync(join(newDir, "profile.yaml"), "utf-8")).toBe("level: N3\n");
    expect(existsSync(join(newDir, "reviews.db"))).toBe(true);

    // old path is now a symlink → polyglot
    const stat = lstatSync(oldDir);
    expect(stat.isSymbolicLink()).toBe(true);

    // log emitted
    const log = readFileSync(join(newDir, "lt.log"), "utf-8");
    expect(log).toContain('"event":"config_dir_migrated"');
    expect(log).toContain('"from"');
    expect(log).toContain('"to"');
  });

  test("already migrated: ~/.config/polyglot exists → no-op, return new dir", () => {
    const newDir = join(tmp, ".config", "polyglot");
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, "profile.yaml"), "level: N2\n", "utf-8");

    const dir = resolveConfigDir(tmp);
    expect(dir).toBe(newDir);

    // no log written (no migration happened)
    expect(existsSync(join(newDir, "lt.log"))).toBe(false);
  });

  test("idempotent: second call after migration is a no-op", () => {
    const oldDir = join(tmp, ".config", "jp-trainer");
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, "profile.yaml"), "level: N3\n", "utf-8");

    const first = resolveConfigDir(tmp);
    const logSize1 = readFileSync(join(first, "lt.log"), "utf-8").length;
    const second = resolveConfigDir(tmp);
    const logSize2 = readFileSync(join(first, "lt.log"), "utf-8").length;

    expect(second).toBe(first);
    // second call should not append a second "config_dir_migrated" line
    expect(logSize2).toBe(logSize1);
    // old path remains symlink (not re-created/replaced)
    expect(lstatSync(oldDir).isSymbolicLink()).toBe(true);
  });

  test("both new and old exist: prefers new, leaves old alone", () => {
    const oldDir = join(tmp, ".config", "jp-trainer");
    const newDir = join(tmp, ".config", "polyglot");
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(newDir, { recursive: true });
    writeFileSync(join(newDir, "profile.yaml"), "level: N2\n", "utf-8");
    writeFileSync(join(oldDir, "profile.yaml"), "level: N4\n", "utf-8");

    const dir = resolveConfigDir(tmp);
    expect(dir).toBe(newDir);
    // new is unchanged
    expect(readFileSync(join(newDir, "profile.yaml"), "utf-8")).toBe("level: N2\n");
    // old is left alone, not symlinked over
    expect(lstatSync(oldDir).isDirectory()).toBe(true);
    expect(lstatSync(oldDir).isSymbolicLink()).toBe(false);
  });

  test("dangling symlink at old path: creates new dir, ignores stale symlink", () => {
    const oldDir = join(tmp, ".config", "jp-trainer");
    mkdirSync(join(tmp, ".config"), { recursive: true });
    symlinkSync(join(tmp, "missing-target"), oldDir, "dir");

    const dir = resolveConfigDir(tmp);
    expect(dir).toBe(join(tmp, ".config", "polyglot"));
    expect(existsSync(dir)).toBe(true);
  });
});
