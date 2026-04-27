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
  test("skill bumped to v3 but hook still v2 → error", () => {
    const skillSnap = snapshot(SKILL);
    try {
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v2/, "prompt_version: v3"), "utf-8");
      const r = check();
      expect(r.ok).toBe(false);
      const merged = r.errors.join("\n");
      expect(merged).toContain("lt-mix.skill.md prompt_version=v3");
      expect(merged).toContain("AMBIENT_PROMPT_VERSION=v2");
    } finally {
      restore(SKILL, skillSnap);
    }
  });

  test("hook bumped to v3 but skill still v2 → error", () => {
    const hookSnap = snapshot(HOOK);
    try {
      writeFileSync(
        HOOK,
        hookSnap.replace(/AMBIENT_PROMPT_VERSION = "v2"/, 'AMBIENT_PROMPT_VERSION = "v3"'),
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
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v2/, "prompt_version: v3"), "utf-8");
      writeFileSync(
        HOOK,
        hookSnap.replace(/AMBIENT_PROMPT_VERSION = "v2"/, 'AMBIENT_PROMPT_VERSION = "v3"'),
        "utf-8",
      );
      const r = check();
      expect(r.ok).toBe(true);
    } finally {
      restore(SKILL, skillSnap);
      restore(HOOK, hookSnap);
    }
  });

  test("malformed prompt_version (e.g. v2.0.0) → error", () => {
    const skillSnap = snapshot(SKILL);
    try {
      writeFileSync(SKILL, skillSnap.replace(/prompt_version: v2/, "prompt_version: v2.0.0"), "utf-8");
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
      writeFileSync(SKILL, skillSnap.replace(/^prompt_version: v2\s*\n/m, ""), "utf-8");
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

// ---------------------------------------------------------------------------
// US-011: drift-guard mutation tests
// ---------------------------------------------------------------------------

const IMMERSION_FILE = join(import.meta.dir, "..", "src", "utils", "immersion.ts");

function withMutatedImmersion<T>(mutator: (raw: string) => string, fn: () => T): T {
  const original = readFileSync(IMMERSION_FILE, "utf-8");
  try {
    writeFileSync(IMMERSION_FILE, mutator(original));
    return fn();
  } finally {
    writeFileSync(IMMERSION_FILE, original);
  }
}

describe("hashImmersionTemplates — mutation drift guard (US-011)", () => {
  test("U9: mutating LANGUAGE_PACKS.en.exampleAmbient changes hash", () => {
    const baseline = hashImmersionTemplates();
    const mutated = withMutatedImmersion(
      (raw) => raw.replace(
        /exampleAmbient: "「这个 bug 已经修了（fixed it：搞定了）。」"/,
        'exampleAmbient: "「测试修改 (mutated for U9)。」"',
      ),
      () => hashImmersionTemplates(),
    );
    expect(mutated).not.toBe(baseline);
    expect(mutated).toMatch(/^[0-9a-f]{12}$/);
  });

  test("U10: deleting LANGUAGE_PACKS block throws", () => {
    expect(() =>
      withMutatedImmersion(
        (raw) => raw.replace(/const LANGUAGE_PACKS[\s\S]*?\n\};/m, "// LANGUAGE_PACKS removed for U10"),
        () => hashImmersionTemplates(),
      ),
    ).toThrow(/LANGUAGE_PACKS/);
  });

  test("U10b: stripping [沉浸 marker from template literals throws", () => {
    expect(() =>
      withMutatedImmersion(
        (raw) => raw.replace(/\[沉浸/g, "[REMOVED"),
        () => hashImmersionTemplates(),
      ),
    ).toThrow(/沉浸/);
  });

  test("U11: baseline hash is 12 hex chars (deterministic on unmodified source)", () => {
    const h1 = hashImmersionTemplates();
    const h2 = hashImmersionTemplates();
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{12}$/);
  });
});
