#!/usr/bin/env bun
/**
 * Adj-I prompt-version drift guard. Phase 1.0 baseline check: every skill
 * file under skills/ must declare frontmatter `prompt_version: vN`. If a
 * skill carries an immersion / mix prompt, it must agree with the version
 * embedded in the corresponding hook source.
 *
 * For Phase 1.0 we only enforce that lt.skill.md / lt-setup / lt-review /
 * lt-on / lt-off all have prompt_version set. Phase 1.1b (Task 25) extends
 * this to hash-compare skills/lt-mix.skill.md against
 * hooks/user-prompt-submit.ts ambient prompt block.
 *
 * Wire as pre-commit hook via:
 *   echo 'bun scripts/check-prompt-version.ts' >> .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const REPO = join(import.meta.dir, "..");
const SKILLS_DIR = join(REPO, "skills");

interface CheckResult {
  ok: boolean;
  errors: string[];
}

function parseFrontmatterVersion(path: string): string | null {
  const raw = readFileSync(path, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const v = m[1].match(/^prompt_version:\s*(\S+)\s*$/m);
  return v ? v[1] : null;
}

export function check(): CheckResult {
  const errors: string[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".skill.md"));
  } catch {
    return { ok: true, errors: [] }; // no skills dir yet — nothing to enforce
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

  return { ok: errors.length === 0, errors };
}

function main() {
  const r = check();
  if (!r.ok) {
    for (const e of r.errors) console.error(`prompt-version: ${e}`);
    process.exit(1);
  }
  console.log(`prompt-version: ok (${SKILLS_DIR})`);
}

if (import.meta.main) {
  main();
}
