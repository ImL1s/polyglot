import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { recordAnswer } from "../src/srs.ts";
import { getDb } from "../src/db.ts";

/**
 * srs.recordAnswer wraps the UPDATE reviews + INSERT attempts pair in a
 * db.transaction(). The atomicity guarantee we need is: either both rows are
 * present or neither is — never an attempt without the reviews update, and
 * never a reviews update without an attempt.
 *
 * Tests 1 and 2 verify the bun:sqlite transaction primitive that recordAnswer
 * relies on (commit + rollback). Test 3 exercises the real recordAnswer path
 * end-to-end against the production DB to confirm both rows land paired.
 */
function makeSchema(db: Database) {
  db.exec(`
    CREATE TABLE reviews (
      concept_id TEXT PRIMARY KEY,
      due_at INTEGER NOT NULL,
      reps INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    INSERT INTO reviews (concept_id, due_at, reps) VALUES ('c1', 0, 0);
  `);
}

describe("bun:sqlite transaction primitive (used by srs.recordAnswer)", () => {
  test("commit: both UPDATE and INSERT visible", () => {
    const db = new Database(":memory:");
    makeSchema(db);

    const txn = db.transaction(() => {
      db.run("UPDATE reviews SET due_at = ?, reps = ? WHERE concept_id = ?", [9999, 1, "c1"]);
      db.run("INSERT INTO attempts (concept_id, rating, created_at) VALUES (?, ?, ?)", ["c1", 3, 12345]);
    });
    txn();

    const reviews = db.query("SELECT due_at, reps FROM reviews WHERE concept_id = ?").get("c1") as any;
    const attempts = db.query("SELECT COUNT(*) as n FROM attempts").get() as any;
    expect(reviews.due_at).toBe(9999);
    expect(reviews.reps).toBe(1);
    expect(attempts.n).toBe(1);
  });

  test("rollback: throw mid-transaction → neither change persists, no orphan attempt", () => {
    const db = new Database(":memory:");
    makeSchema(db);

    const txn = db.transaction(() => {
      db.run("UPDATE reviews SET due_at = ?, reps = ? WHERE concept_id = ?", [9999, 1, "c1"]);
      throw new Error("simulated mid-transaction crash");
    });

    expect(() => txn()).toThrow("simulated mid-transaction crash");

    const reviews = db.query("SELECT due_at, reps FROM reviews WHERE concept_id = ?").get("c1") as any;
    const attempts = db.query("SELECT COUNT(*) as n FROM attempts").get() as any;
    expect(reviews.due_at).toBe(0);
    expect(reviews.reps).toBe(0);
    expect(attempts.n).toBe(0);
  });
});

describe("srs.recordAnswer end-to-end", () => {
  test("real recordAnswer leaves reviews row updated AND a paired attempts row", () => {
    // run against the real configured DB. The conceptId is intentionally a
    // synthetic prefix so test data is identifiable; we clean up after.
    const db = getDb();
    const conceptId = `__test_txn_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    db.run("INSERT INTO concepts (id, type, level, ja, zh, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [conceptId, "vocab", "N3", "テスト", "测试", Date.now()]);

    try {
      recordAnswer({ conceptId, rating: 3 });

      const reviews = db.query("SELECT reps FROM reviews WHERE concept_id = ?").get(conceptId) as any;
      const attempts = db.query("SELECT COUNT(*) as n FROM attempts WHERE concept_id = ?").get(conceptId) as any;
      expect(reviews).not.toBeNull();
      expect(reviews.reps).toBeGreaterThanOrEqual(1);
      expect(attempts.n).toBe(1);
    } finally {
      db.run("DELETE FROM attempts WHERE concept_id = ?", [conceptId]);
      db.run("DELETE FROM reviews WHERE concept_id = ?", [conceptId]);
      db.run("DELETE FROM concepts WHERE id = ?", [conceptId]);
    }
  });
});
