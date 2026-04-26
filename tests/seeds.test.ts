import { describe, test, expect, beforeAll } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { importSeeds } from "../src/seeds.ts";
import { DB_FILE } from "../src/paths.ts";

// Seeds import is idempotent (UPSERT on id) so it's safe to run on the real
// configured DB. We assert structural invariants over the seed yaml + the
// resulting concepts table, not the user's per-card review state.
describe("seeds yaml import", () => {
  beforeAll(() => {
    importSeeds();
  });

  test("yaml files exist for all four levels (vocab) plus N2 grammar", () => {
    const seedsDir = join(import.meta.dir, "..", "data", "seeds");
    const files = readdirSync(seedsDir).filter((f) => f.endsWith(".yaml"));
    expect(files).toContain("n5-vocab.yaml");
    expect(files).toContain("n4-vocab.yaml");
    expect(files).toContain("n3-vocab.yaml");
    expect(files).toContain("n2-vocab.yaml");
    expect(files).toContain("n2-grammar.yaml");
  });

  test("N3 has at least 500 concepts", () => {
    const db = new Database(DB_FILE);
    const row = db.query("SELECT COUNT(*) AS n FROM concepts WHERE level = 'N3'").get() as { n: number };
    expect(row.n).toBeGreaterThanOrEqual(500);
    db.close();
  });

  test("each level has at least 300 concepts", () => {
    const db = new Database(DB_FILE);
    for (const lvl of ["N5", "N4", "N3", "N2"]) {
      const row = db.query(`SELECT COUNT(*) AS n FROM concepts WHERE level = '${lvl}'`).get() as { n: number };
      expect(row.n).toBeGreaterThanOrEqual(300);
    }
    db.close();
  });

  test("N2 has both vocab and grammar entries", () => {
    const db = new Database(DB_FILE);
    const vocab = db.query("SELECT COUNT(*) AS n FROM concepts WHERE level = 'N2' AND type = 'vocab'").get() as { n: number };
    const grammar = db.query("SELECT COUNT(*) AS n FROM concepts WHERE level = 'N2' AND type = 'grammar'").get() as { n: number };
    expect(vocab.n).toBeGreaterThan(0);
    expect(grammar.n).toBeGreaterThanOrEqual(100);
    db.close();
  });

  test("seed-imported concepts all have non-empty ja and zh", () => {
    const db = new Database(DB_FILE);
    // ignore synthetic test rows like __test_txn_* used by other tests
    const row = db.query(
      "SELECT COUNT(*) AS n FROM concepts WHERE id NOT LIKE '__test_%' AND (ja IS NULL OR ja = '' OR zh IS NULL OR zh = '')",
    ).get() as { n: number };
    expect(row.n).toBe(0);
    db.close();
  });
});
