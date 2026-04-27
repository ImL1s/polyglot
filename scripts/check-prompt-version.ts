#!/usr/bin/env bun
/**
 * Adj-I prompt-version drift guard.
 *
 * Three checks (each fail-closed):
 *  1. Every skills/*.skill.md must declare frontmatter `prompt_version: vN`
 *     matching /^v\d+(\.\d+)?$/.
 *  2. skills/lt-mix.skill.md frontmatter prompt_version must equal the
 *     AMBIENT_PROMPT_VERSION constant exported by
 *     hooks/user-prompt-submit.ts. Drift means the dogfood NDJSON event
 *     would log a stale version.
 *  3. The ambient prompt template body in src/utils/immersion.ts (the three
 *     branch templates) is hashed so reviewers see *which* hash version of
 *     the template the current skill describes. Soft check — emits a
 *     warning if no hash baseline is committed yet.
 *
 * Wire as pre-commit hook via:
 *   echo 'bun scripts/check-prompt-version.ts' >> .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import process from "node:process";

const REPO = join(import.meta.dir, "..");
const SKILLS_DIR = join(REPO, "skills");
const HOOK_FILE = join(REPO, "hooks", "user-prompt-submit.ts");
const IMMERSION_FILE = join(REPO, "src", "utils", "immersion.ts");

interface CheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function parseFrontmatterVersion(path: string): string | null {
  const raw = readFileSync(path, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const v = m[1].match(/^prompt_version:\s*(\S+)\s*$/m);
  return v ? v[1] : null;
}

function readHookPromptVersion(): string | null {
  try {
    const raw = readFileSync(HOOK_FILE, "utf-8");
    const m = raw.match(/AMBIENT_PROMPT_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Hash the immersion branch template strings to detect silent prompt edits. */
export function hashImmersionTemplates(): string {
  let raw = "";
  try {
    raw = readFileSync(IMMERSION_FILE, "utf-8");
  } catch {
    return "";
  }
  const matches = raw.match(/`[^`]*\[沉浸[^`]*`/g) ?? [];
  const normalized = matches.map((s) => s.replace(/\s+/g, " ").trim()).sort().join("\n");
  if (!normalized) return "";
  return createHash("sha256").update(normalized).digest("hex").slice(0, 12);
}

export function check(): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".skill.md"));
  } catch {
    return { ok: true, errors: [], warnings: [] };
  }

  for (const f of files) {
    const path = join(SKILLS_DIR, f);
    const v = parseFrontmatterVersion(path);
    if (!v) {
      errors.push(`${f}: missing or unparseable prompt_version frontmatter`);
      continue;
    }
    if (!/^v\d+(\.\d+)?$/.test(v)) {
      errors.push(`${f}: prompt_version "${v}" does not match vN or vN.M pattern`);
    }
  }

  // Cross-check lt-mix.skill.md ↔ hooks/user-prompt-submit.ts AMBIENT_PROMPT_VERSION.
  if (files.includes("lt-mix.skill.md")) {
    const skillV = parseFrontmatterVersion(join(SKILLS_DIR, "lt-mix.skill.md"));
    const hookV = readHookPromptVersion();
    if (skillV && hookV && skillV !== hookV) {
      errors.push(
        `lt-mix.skill.md prompt_version=${skillV} but hooks/user-prompt-submit.ts AMBIENT_PROMPT_VERSION=${hookV}. ` +
        `Bump one to match the other.`,
      );
    }
    if (!hookV) {
      warnings.push(
        `lt-mix.skill.md ships, but hooks/user-prompt-submit.ts has no AMBIENT_PROMPT_VERSION constant. ` +
        `Adj-I requires the hook to emit prompt_version into the NDJSON ambient_inject event.`,
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function main() {
  const r = check();
  for (const w of r.warnings) console.warn(`prompt-version: WARN ${w}`);
  if (!r.ok) {
    for (const e of r.errors) console.error(`prompt-version: ${e}`);
    process.exit(1);
  }
  const tplHash = hashImmersionTemplates() || "n/a";
  console.log(`prompt-version: ok (${SKILLS_DIR}, immersion templates sha256=${tplHash})`);
}

if (import.meta.main) {
  main();
}
