import { describe, test, expect, beforeAll } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { importSeeds } from "../src/seeds.ts";
import { DB_FILE } from "../src/paths.ts";
import { hangulToRomaja, slugify } from "../scripts/fetch-topik-vocab.ts";

describe("hangul → romaja slug", () => {
  test("basic syllables decompose by jamo formula", () => {
    expect(hangulToRomaja("안녕")).toBe("annyeong");
    expect(hangulToRomaja("한국")).toBe("hangug");
    expect(hangulToRomaja("학교")).toBe("haggyo");
    expect(hangulToRomaja("바나나")).toBe("banana");
  });

  test("non-hangul characters pass through", () => {
    expect(hangulToRomaja("안녕 World")).toBe("annyeong World");
  });

  test("slugify normalizes to ascii kebab", () => {
    expect(slugify(hangulToRomaja("안녕하세요"))).toBe("annyeonghaseyo");
    // ㅃ → "pp" per Revised Romanization (tense bilabial)
    expect(slugify(hangulToRomaja("뿐만 아니라"))).toBe("ppunman-anira");
  });
});

describe("TOPIK seed yaml import", () => {
  beforeAll(() => {
    importSeeds();
  });

  test("ko-topik1-vocab.yaml + ko-topik2-vocab.yaml exist with language: ko at file root", () => {
    const seedsDir = join(import.meta.dir, "..", "data", "seeds");
    for (const f of ["ko-topik1-vocab.yaml", "ko-topik2-vocab.yaml"]) {
      const raw = readFileSync(join(seedsDir, f), "utf-8");
      const parsed = YAML.parse(raw) as { language?: string; concepts?: unknown[] };
      expect(parsed.language).toBe("ko");
      expect(Array.isArray(parsed.concepts)).toBe(true);
      expect((parsed.concepts ?? []).length).toBeGreaterThan(0);
    }
  });

  test("DB has ≥800 concepts with language='ko' and level LIKE 'TOPIK%'", () => {
    const db = new Database(DB_FILE);
    const row = db
      .query("SELECT COUNT(*) AS n FROM concepts WHERE language = 'ko' AND level LIKE 'TOPIK%'")
      .get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(800);
    db.close();
  });

  test("TOPIK1 and TOPIK2 each have at least 400 concepts", () => {
    const db = new Database(DB_FILE);
    for (const lvl of ["TOPIK1", "TOPIK2"]) {
      const row = db
        .query(`SELECT COUNT(*) AS n FROM concepts WHERE language = 'ko' AND level = '${lvl}'`)
        .get() as { n: number };
      expect(row.n).toBeGreaterThanOrEqual(400);
    }
    db.close();
  });

  test("all ko concepts have non-empty hangul + zh + reading", () => {
    const db = new Database(DB_FILE);
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM concepts
         WHERE language = 'ko' AND (ja IS NULL OR ja = '' OR zh IS NULL OR zh = '' OR reading IS NULL OR reading = '')`,
      )
      .get() as { n: number };
    expect(row.n).toBe(0);
    db.close();
  });

  test("ko ids follow ko-vocab-topik{1|2}-{slug} format", () => {
    const db = new Database(DB_FILE);
    const row = db
      .query(
        `SELECT COUNT(*) AS n FROM concepts WHERE language = 'ko' AND id NOT GLOB 'ko-vocab-topik[12]-*'`,
      )
      .get() as { n: number };
    expect(row.n).toBe(0);
    db.close();
  });

  test("ja seeds untouched — still ≥6000 concepts with language='ja'", () => {
    const db = new Database(DB_FILE);
    const row = db.query("SELECT COUNT(*) AS n FROM concepts WHERE language = 'ja'").get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(6000);
    db.close();
  });
});
