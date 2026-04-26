import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const SKILLS_DIR = join(import.meta.dir, "..", "skills");
const REQUIRED = ["lt", "lt-setup", "lt-review", "lt-on", "lt-off"];

interface Frontmatter {
  name: string;
  description: string;
  prompt_version: string;
  prompt_max_tokens: number;
  trigger?: string[];
}

function parseFrontmatter(path: string): Frontmatter {
  const raw = readFileSync(path, "utf-8");
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`no frontmatter in ${path}`);
  return YAML.parse(m[1]) as Frontmatter;
}

describe("skills/*.skill.md frontmatter", () => {
  test("all 5 required skill files exist", () => {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".skill.md")).sort();
    expect(files).toEqual(REQUIRED.map((n) => `${n}.skill.md`).sort());
  });

  for (const name of REQUIRED) {
    test(`${name}.skill.md frontmatter is valid`, () => {
      const fm = parseFrontmatter(join(SKILLS_DIR, `${name}.skill.md`));
      expect(fm.name).toBe(name);
      expect(typeof fm.description).toBe("string");
      expect(fm.description.length).toBeGreaterThan(0);
      expect(fm.prompt_version).toBe("v1");
      expect(fm.prompt_max_tokens).toBe(250);
      // every skill must list the lt-prefixed slash command in its trigger
      expect(Array.isArray(fm.trigger)).toBe(true);
      const ltTrigger = name === "lt" ? "/lt" : `/${name}`;
      expect(fm.trigger).toContain(ltTrigger);
    });
  }

  test("lt.skill.md body contains all 4 type rubrics with all 4 rating tiers", () => {
    const body = readFileSync(join(SKILLS_DIR, "lt.skill.md"), "utf-8");
    for (const t of ["vocab", "grammar", "kanji", "expression"]) {
      expect(body).toContain(`### ${t}`);
    }
    for (const r of ["rating_4_easy", "rating_3_good", "rating_2_hard", "rating_1_again"]) {
      // each tier must appear (at minimum once for the global rubric pass)
      expect(body).toMatch(new RegExp(`\`?${r}\`?`));
    }
  });
});
