import { describe, test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { check, hashImmersionTemplates } from "../scripts/check-prompt-version.ts";

/**
 * Adj-I prompt-version drift guard tests.
 *
 * Locks the contract that:
 *   - lt-mix.skill.md frontmatter prompt_version
 *   - hooks/user-prompt-submit.ts AMBIENT_PROMPT_VERSION
 *
 * stay in lockstep. Tests mutate real files and restore on teardown so we
 * don't need a tmpfs.
 */
const REPO = join(import.meta.dir, "..");
const SCRIPT = join(REPO, "scripts", "check-prompt-version.ts");
const HOOK = join(REPO, "hooks", "user-prompt-submit.ts");
const SKILL = join(REPO, "skills", "lt-mix.skill.md");

function snapshot(path: string): string {
  return readFileSync(path, "utf-8");
}

function restore(path: string, content: string): void {
  writeFileSync(path, content, "utf-8");
}

function runScript(): { stdout: string; stderr: string; code: number } {
  const res = spawnSync("bun", [SCRIPT], { encoding: "utf-8", timeout: 5000 });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: typeof res.status === "number" ? res.status : 1,
  };
}

describe("check-prompt-version — baseline pass", () => {
  test("script runs and exits 0 on the committed tree", () => {
    const r = runScript();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("prompt-version: ok");
  });

  test("output includes immersion templates sha256 fingerprint", () => {
    const r = runScript();
    expect(r.stdout).toMatch(/sha256=[a-f0-9]{12}/);
  });

  test("check() programmatic API returns ok=true", () => {
    const r = check();
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

describe("check-prompt-version — drift detection", () => {
  test("skill bumped to v2 but hook still v1 → error", () => {
    const skillSnap = snapshot(SKILL);
    try {
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v1/, "prompt_version: v2"), "utf-8");
      const r = check();
      expect(r.ok).toBe(false);
      const merged = r.errors.join("\n");
      expect(merged).toContain("lt-mix.skill.md prompt_version=v2");
      expect(merged).toContain("AMBIENT_PROMPT_VERSION=v1");
    } finally {
      restore(SKILL, skillSnap);
    }
  });

  test("hook bumped to v3 but skill still v1 → error", () => {
    const hookSnap = snapshot(HOOK);
    try {
      writeFileSync(
        HOOK,
        hookSnap.replace(/AMBIENT_PROMPT_VERSION = "v1"/, 'AMBIENT_PROMPT_VERSION = "v3"'),
        "utf-8",
      );
      const r = check();
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain("AMBIENT_PROMPT_VERSION=v3");
    } finally {
      restore(HOOK, hookSnap);
    }
  });

  test("both sides bumped together → ok", () => {
    const skillSnap = snapshot(SKILL);
    const hookSnap = snapshot(HOOK);
    try {
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v1/, "prompt_version: v2"), "utf-8");
      writeFileSync(
        HOOK,
        hookSnap.replace(/AMBIENT_PROMPT_VERSION = "v1"/, 'AMBIENT_PROMPT_VERSION = "v2"'),
        "utf-8",
      );
      const r = check();
      expect(r.ok).toBe(true);
    } finally {
      restore(SKILL, skillSnap);
      restore(HOOK, hookSnap);
    }
  });

  test("malformed prompt_version (e.g. v1.0.0) → error", () => {
    const skillSnap = snapshot(SKILL);
    try {
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v1/, "prompt_version: v1.0.0"), "utf-8");
      const r = check();
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain("does not match vN or vN.M pattern");
    } finally {
      restore(SKILL, skillSnap);
    }
  });

  test("missing prompt_version → error", () => {
    const skillSnap = snapshot(SKILL);
    try {
      writeFileSync(SKILL, skillSnap.replace(/^prompt_version: v1\s*\n/m, ""), "utf-8");
      const r = check();
      expect(r.ok).toBe(false);
      expect(r.errors.join("\n")).toContain("missing or unparseable prompt_version frontmatter");
    } finally {
      restore(SKILL, skillSnap);
    }
  });
});

describe("hashImmersionTemplates — drift fingerprint", () => {
  test("returns a 12-char hex string", () => {
    const h = hashImmersionTemplates();
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });

  test("hash is deterministic across calls", () => {
    expect(hashImmersionTemplates()).toBe(hashImmersionTemplates());
  });
});
