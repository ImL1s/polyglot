import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";

/**
 * Phase 1.1b Task 5 / Adj-G — ambient_exposures engine + retention.
 *
 * Each test gets its own :memory: SQLite DB injected via the testHooks API.
 * This avoids racing with other agents' shared filesystem and keeps tests
 * deterministic. Real-DB integration is covered by tests/lt-mix.test.ts +
 * tests/ambient-cli.test.ts (CLI shell-out tests).
 */
import {
  setDbForTesting,
  getMixVocab,
  logAmbientExposures,
  cleanOldExposures,
  archiveExposures,
  getAmbientStats,
} from "../src/ambient.ts";

const MS_PER_DAY = 24 * 3600 * 1000;
const MASTERED_THRESHOLD_MS = 7 * MS_PER_DAY;

function freshDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE concepts (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, level TEXT NOT NULL,
      ja TEXT NOT NULL, reading TEXT, zh TEXT NOT NULL,
      examples TEXT, tags TEXT, pos TEXT, created_at INTEGER NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja'
    );
    CREATE TABLE reviews (
      concept_id TEXT PRIMARY KEY REFERENCES concepts(id),
      due_at INTEGER NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL,
      elapsed_days REAL NOT NULL DEFAULT 0, scheduled_days REAL NOT NULL DEFAULT 0,
      reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
      state INTEGER NOT NULL DEFAULT 0, last_review INTEGER
    );
    CREATE TABLE ambient_exposures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id TEXT NOT NULL REFERENCES concepts(id),
      language TEXT NOT NULL DEFAULT 'ja',
      source TEXT NOT NULL DEFAULT 'mix',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE ambient_exposures_archive (
      concept_id TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'ja',
      cumulative_count INTEGER NOT NULL,
      archived_at INTEGER NOT NULL,
      PRIMARY KEY (concept_id, archived_at)
    );
  `);
  return db;
}

function seedConcept(db: Database, id: string, language = "ja") {
  db.exec(`INSERT INTO concepts (id, type, level, ja, reading, zh, examples, tags, pos, created_at, language)
           VALUES ('${id}', 'vocab', 'N3', '${id}_ja', '${id}_kana', '${id}_zh', NULL, NULL, NULL, ${Date.now()}, '${language}')`);
}

function seedReview(db: Database, conceptId: string, opts: { state: number; stability: number; lapses?: number }) {
  db.exec(`INSERT INTO reviews (concept_id, due_at, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review)
           VALUES ('${conceptId}', ${Date.now()}, ${opts.stability}, 5.0, 0, 0, 0, ${opts.lapses ?? 0}, ${opts.state}, ${Date.now()})`);
}

let db: Database;

beforeEach(() => {
  db = freshDb();
  setDbForTesting(db);
});

describe("ambient.getMixVocab — 80/20 mastered/weak pool", () => {
  test("empty mastered pool → returns [] (graceful skip)", () => {
    seedConcept(db, "c1");
    seedReview(db, "c1", { state: 1, stability: MS_PER_DAY }); // Learning, not mastered
    expect(getMixVocab("ja", { limit: 15 })).toEqual([]);
  });

  test("12 mastered + 3 weak → pool of 15 (80/20)", () => {
    for (let i = 0; i < 20; i++) {
      seedConcept(db, `m${i}`);
      seedReview(db, `m${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    for (let i = 0; i < 5; i++) {
      seedConcept(db, `w${i}`);
      seedReview(db, `w${i}`, { state: 1, stability: 100, lapses: 1 });
    }
    const out = getMixVocab("ja", { limit: 15 });
    expect(out.length).toBe(15);
    const m = out.filter((v) => v.id.startsWith("m")).length;
    const w = out.filter((v) => v.id.startsWith("w")).length;
    expect(m).toBe(12);
    expect(w).toBe(3);
  });

  test("mastered=20 weak=0 → returns 12 mastered (no hard-fill)", () => {
    for (let i = 0; i < 20; i++) {
      seedConcept(db, `m${i}`);
      seedReview(db, `m${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    expect(getMixVocab("ja", { limit: 15 }).length).toBe(12);
  });

  test("mastered=5 weak=10 → 5 mastered + 3 weak (no hard-fill of weak)", () => {
    for (let i = 0; i < 5; i++) {
      seedConcept(db, `m${i}`);
      seedReview(db, `m${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    for (let i = 0; i < 10; i++) {
      seedConcept(db, `w${i}`);
      seedReview(db, `w${i}`, { state: 3, stability: 100, lapses: 2 });
    }
    const out = getMixVocab("ja", { limit: 15 });
    const m = out.filter((v) => v.id.startsWith("m")).length;
    const w = out.filter((v) => v.id.startsWith("w")).length;
    expect(m).toBe(5);
    expect(w).toBe(3);
  });

  test("language filter excludes other languages", () => {
    for (let i = 0; i < 12; i++) {
      seedConcept(db, `j${i}`, "ja");
      seedReview(db, `j${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    for (let i = 0; i < 12; i++) {
      seedConcept(db, `k${i}`, "ko");
      seedReview(db, `k${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    const ja = getMixVocab("ja", { limit: 15 });
    const ko = getMixVocab("ko", { limit: 15 });
    expect(ja.every((v) => v.id.startsWith("j"))).toBe(true);
    expect(ko.every((v) => v.id.startsWith("k"))).toBe(true);
  });

  test("custom masteredRatio=0.5 limit=10 → 5/5 split", () => {
    for (let i = 0; i < 10; i++) {
      seedConcept(db, `m${i}`);
      seedReview(db, `m${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    for (let i = 0; i < 10; i++) {
      seedConcept(db, `w${i}`);
      seedReview(db, `w${i}`, { state: 1, stability: 100, lapses: 1 });
    }
    const out = getMixVocab("ja", { limit: 10, masteredRatio: 0.5 });
    expect(out.filter((v) => v.id.startsWith("m")).length).toBe(5);
    expect(out.filter((v) => v.id.startsWith("w")).length).toBe(5);
  });

  test("vocab item shape: {id, ja, reading, zh}", () => {
    for (let i = 0; i < 12; i++) {
      seedConcept(db, `m${i}`);
      seedReview(db, `m${i}`, { state: 2, stability: MASTERED_THRESHOLD_MS + MS_PER_DAY });
    }
    const out = getMixVocab("ja", { limit: 5 });
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toHaveProperty("id");
    expect(out[0]).toHaveProperty("ja");
    expect(out[0]).toHaveProperty("zh");
    expect(out[0]).toHaveProperty("reading");
  });

  test("stability < 7d threshold → not mastered", () => {
    seedConcept(db, "c1");
    seedReview(db, "c1", { state: 2, stability: 6 * MS_PER_DAY });
    expect(getMixVocab("ja", { limit: 15 })).toEqual([]);
  });

  test("stability == 7d threshold → mastered (inclusive)", () => {
    for (let i = 0; i < 12; i++) {
      seedConcept(db, `c${i}`);
      seedReview(db, `c${i}`, { state: 2, stability: 7 * MS_PER_DAY });
    }
    expect(getMixVocab("ja", { limit: 15 }).length).toBe(12);
  });
});

describe("ambient.logAmbientExposures", () => {
  test("batch insert N rows with shared language + source", () => {
    seedConcept(db, "c1");
    seedConcept(db, "c2");
    seedConcept(db, "c3");
    expect(logAmbientExposures(["c1", "c2", "c3"], "ja")).toBe(3);
    const rows = db
      .query("SELECT concept_id, language, source FROM ambient_exposures")
      .all() as { concept_id: string; language: string; source: string }[];
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.language === "ja" && r.source === "mix")).toBe(true);
  });

  test("empty array → 0 inserts, no error", () => {
    expect(logAmbientExposures([], "ja")).toBe(0);
  });

  test("custom source label persists", () => {
    seedConcept(db, "c1");
    logAmbientExposures(["c1"], "ja", "manual");
    const row = db.query("SELECT source FROM ambient_exposures").get() as { source: string };
    expect(row.source).toBe("manual");
  });
});

describe("ambient.archiveExposures + cleanOldExposures", () => {
  test("archive groups by concept_id; cumulative_count is sum", () => {
    seedConcept(db, "c1");
    seedConcept(db, "c2");
    const oldTs = Date.now() - 100 * MS_PER_DAY;
    for (let i = 0; i < 5; i++) {
      db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${oldTs + i})`);
    }
    for (let i = 0; i < 3; i++) {
      db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c2', 'ja', 'mix', ${oldTs + i})`);
    }
    const cutoff = Date.now() - 90 * MS_PER_DAY;
    expect(archiveExposures(cutoff, 1000)).toBe(2);
    const rows = db
      .query("SELECT concept_id, cumulative_count FROM ambient_exposures_archive ORDER BY concept_id")
      .all() as { concept_id: string; cumulative_count: number }[];
    expect(rows).toEqual([
      { concept_id: "c1", cumulative_count: 5 },
      { concept_id: "c2", cumulative_count: 3 },
    ]);
  });

  test("cleanOldExposures deletes only rows older than cutoff", () => {
    seedConcept(db, "c1");
    const old = Date.now() - 100 * MS_PER_DAY;
    const recent = Date.now() - 10 * MS_PER_DAY;
    for (let i = 0; i < 50; i++) {
      db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${old + i})`);
    }
    for (let i = 0; i < 20; i++) {
      db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${recent + i})`);
    }
    const cutoff = Date.now() - 90 * MS_PER_DAY;
    expect(cleanOldExposures(cutoff)).toBe(50);
    const remaining = db.query("SELECT COUNT(*) AS n FROM ambient_exposures").get() as { n: number };
    expect(remaining.n).toBe(20);
  });

  test("repeated archive runs accumulate as separate archive rows (PK collision-free)", () => {
    seedConcept(db, "c1");
    const old = Date.now() - 100 * MS_PER_DAY;
    db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${old})`);
    archiveExposures(Date.now(), 1000);
    db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${old + 1})`);
    archiveExposures(Date.now(), 2000);
    const rows = db
      .query("SELECT archived_at, cumulative_count FROM ambient_exposures_archive ORDER BY archived_at")
      .all() as { archived_at: number; cumulative_count: number }[];
    expect(rows.length).toBe(2);
    expect(rows[0].archived_at).toBe(1000);
    expect(rows[1].archived_at).toBe(2000);
  });

  test("same archived_at run twice → ON CONFLICT increments count", () => {
    seedConcept(db, "c1");
    const old = Date.now() - 100 * MS_PER_DAY;
    // Insert then archive (no clean) — archive sees 1 row.
    db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${old})`);
    archiveExposures(Date.now(), 1000);
    cleanOldExposures(Date.now()); // simulate the canonical clean pairing
    // Now insert another row + archive at same archived_at — should accumulate (1+1=2).
    db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${old + 1})`);
    archiveExposures(Date.now(), 1000);
    const rows = db
      .query("SELECT archived_at, cumulative_count FROM ambient_exposures_archive")
      .all() as { archived_at: number; cumulative_count: number }[];
    expect(rows.length).toBe(1);
    expect(rows[0].cumulative_count).toBe(2);
  });

  test("archive empty cutoff → 0 groups, no error", () => {
    expect(archiveExposures(0)).toBe(0);
  });

  test("Adj-G 200K rows scenario — batch archive scales linearly", () => {
    // Seed 200K rows over 100 distinct concepts (≈2K rows per concept) older
    // than the keep-days cutoff. archiveExposures should compact to 100 archive
    // rows + cleanOldExposures should delete all 200K.
    for (let i = 0; i < 100; i++) seedConcept(db, `c${i}`);
    const oldTs = Date.now() - 100 * MS_PER_DAY;
    const stmt = db.prepare(
      "INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES (?, 'ja', 'mix', ?)",
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < 200_000; i++) {
        stmt.run(`c${i % 100}`, oldTs + i);
      }
    });
    tx();
    const cutoff = Date.now() - 90 * MS_PER_DAY;
    expect(archiveExposures(cutoff, Date.now())).toBe(100);
    expect(cleanOldExposures(cutoff)).toBe(200_000);
    const remaining = db.query("SELECT COUNT(*) AS n FROM ambient_exposures").get() as { n: number };
    expect(remaining.n).toBe(0);
    const archived = db
      .query("SELECT SUM(cumulative_count) AS total FROM ambient_exposures_archive")
      .get() as { total: number };
    expect(archived.total).toBe(200_000);
  });
});

describe("ambient.getAmbientStats", () => {
  test("0 exposures → live=archived=total=unique=0", () => {
    const s = getAmbientStats("ja");
    expect(s.live_count).toBe(0);
    expect(s.archived_count).toBe(0);
    expect(s.total).toBe(0);
    expect(s.unique_concepts).toBe(0);
    expect(s.top_concepts).toEqual([]);
  });

  test("merges live + archive counts", () => {
    seedConcept(db, "c1");
    db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${Date.now()})`);
    db.exec(`INSERT INTO ambient_exposures_archive (concept_id, language, cumulative_count, archived_at) VALUES ('c1', 'ja', 50, 1)`);
    const s = getAmbientStats("ja");
    expect(s.live_count).toBe(1);
    expect(s.archived_count).toBe(50);
    expect(s.total).toBe(51);
  });

  test("top concepts ordered by frequency descending", () => {
    seedConcept(db, "c1");
    seedConcept(db, "c2");
    seedConcept(db, "c3");
    for (let i = 0; i < 10; i++) db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c1', 'ja', 'mix', ${Date.now() + i})`);
    for (let i = 0; i < 5; i++) db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c2', 'ja', 'mix', ${Date.now() + i})`);
    for (let i = 0; i < 2; i++) db.exec(`INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES ('c3', 'ja', 'mix', ${Date.now() + i})`);
    const s = getAmbientStats("ja", 3);
    expect(s.top_concepts.map((t) => t.concept_id)).toEqual(["c1", "c2", "c3"]);
    expect(s.top_concepts.map((t) => t.n)).toEqual([10, 5, 2]);
  });
});
