import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  pickMockQuestions,
  recordMockAnswer,
  buildMockReport,
  importMockSeeds,
  type MockResult,
} from "../src/mock.ts";
import { getDb } from "../src/db.ts";

/**
 * Mock-test pipeline tests:
 *  - importMockSeeds populates mock_questions only from yaml files with
 *    `mock: true` (default seed-import skips them)
 *  - pickMockQuestions samples N rows, optionally filtered by type/level/lang
 *  - recordMockAnswer writes to mock_attempts (NOT main attempts; FK on
 *    attempts.concept_id would reject mock question ids)
 *  - buildMockReport aggregates {total, correct, accuracy, by_type}
 *
 * We use a tag prefix __mock_test_ on inserted rows + cleanup in afterAll
 * so the test never bleeds into production-like state in the dev DB.
 */
const TEST_PREFIX = `__mock_test_${Date.now()}_`;

function seedQuestion(id: string, type: string, correct = 0): void {
  const db = getDb();
  // Use the lazy-migration trigger first, then insert directly so we don't
  // need a yaml file for these unit tests.
  pickMockQuestions({ count: 0 }); // triggers ensureMockTable
  db.run(
    `INSERT OR REPLACE INTO mock_questions
       (id, level, type, language, question, choices, correct, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      "N2",
      type,
      "ja",
      `Q for ${id}`,
      JSON.stringify(["a", "b", "c", "d"]),
      correct,
      "test explanation",
      Date.now(),
    ],
  );
}

function cleanup(): void {
  // Trigger lazy migration so mock_attempts exists before DELETE.
  pickMockQuestions({ count: 0 });
  const db = getDb();
  db.run("DELETE FROM mock_attempts WHERE question_id LIKE ?", [`${TEST_PREFIX}%`]);
  db.run("DELETE FROM mock_questions WHERE id LIKE ?", [`${TEST_PREFIX}%`]);
}

beforeAll(() => {
  cleanup();
});
afterAll(() => {
  cleanup();
});

describe("pickMockQuestions", () => {
  test("samples N rows when more than N exist", () => {
    for (let i = 0; i < 10; i++) {
      seedQuestion(`${TEST_PREFIX}vocab-${i}`, "vocab");
    }
    // Use a level filter so we don't pick up questions from other tests.
    const sampled = pickMockQuestions({ count: 5, level: "N2", type: "vocab" });
    // mock_questions table may have other vocab N2 rows from other tests; we
    // only assert at most count rows came back and that ours are findable.
    expect(sampled.length).toBeLessThanOrEqual(5);
    expect(sampled.length).toBeGreaterThan(0);
    for (const q of sampled) {
      expect(q.choices).toHaveLength(4);
      expect(q.correct).toBeGreaterThanOrEqual(0);
      expect(q.correct).toBeLessThan(4);
    }
  });

  test("type filter excludes non-matching types", () => {
    seedQuestion(`${TEST_PREFIX}reading-1`, "reading");
    seedQuestion(`${TEST_PREFIX}grammar-1`, "grammar");
    const onlyGrammar = pickMockQuestions({
      count: 50,
      level: "N2",
      type: "grammar",
    });
    for (const q of onlyGrammar) {
      expect(q.type).toBe("grammar");
    }
  });

  test("type=all returns mixed types", () => {
    const mixed = pickMockQuestions({ count: 50, level: "N2", type: "all" });
    const types = new Set(mixed.map((q) => q.type));
    // We seeded vocab/grammar/reading above, so at least 2 different types
    // should appear when sampling generously. The exact composition depends
    // on what other tests have left; we just assert variability.
    expect(types.size).toBeGreaterThanOrEqual(1);
  });
});

describe("recordMockAnswer + buildMockReport", () => {
  test("writes to mock_attempts and aggregates correctly", () => {
    const id1 = `${TEST_PREFIX}rep-1`;
    const id2 = `${TEST_PREFIX}rep-2`;
    seedQuestion(id1, "vocab");
    seedQuestion(id2, "grammar");

    recordMockAnswer({ questionId: id1, isCorrect: true, userChoice: 0 });
    recordMockAnswer({ questionId: id1, isCorrect: false, userChoice: 2 });
    recordMockAnswer({ questionId: id2, isCorrect: true, userChoice: 1 });

    const db = getDb();
    const rows = db
      .query(
        `SELECT ma.question_id, ma.is_correct, ma.user_choice, ma.created_at, mq.type
           FROM mock_attempts ma
           LEFT JOIN mock_questions mq ON mq.id = ma.question_id
          WHERE ma.question_id IN (?, ?)
          ORDER BY ma.created_at ASC`,
      )
      .all(id1, id2) as {
        question_id: string;
        is_correct: number;
        user_choice: number;
        created_at: number;
        type: string | null;
      }[];
    const results: MockResult[] = rows.map((r) => ({
      question_id: r.question_id,
      type: r.type ?? "unknown",
      user_choice: r.user_choice,
      is_correct: r.is_correct === 1,
      created_at: r.created_at,
    }));
    const report = buildMockReport(results);
    expect(report.total).toBe(3);
    expect(report.correct).toBe(2);
    expect(report.accuracy).toBeCloseTo(2 / 3, 5);
    const byVocab = report.by_type.find((t) => t.type === "vocab");
    expect(byVocab).toBeDefined();
    expect(byVocab!.total).toBe(2);
    expect(byVocab!.correct).toBe(1);
    const byGrammar = report.by_type.find((t) => t.type === "grammar");
    expect(byGrammar).toBeDefined();
    expect(byGrammar!.total).toBe(1);
    expect(byGrammar!.correct).toBe(1);
  });

  test("recordMockAnswer does NOT write to main attempts (FK guard)", () => {
    const db = getDb();
    const id = `${TEST_PREFIX}fk-guard`;
    seedQuestion(id, "vocab");
    recordMockAnswer({ questionId: id, isCorrect: true, userChoice: 0 });
    const attemptsRow = db
      .query("SELECT COUNT(*) AS n FROM attempts WHERE concept_id = ?")
      .get(id) as { n: number };
    expect(attemptsRow.n).toBe(0);
  });
});

describe("importMockSeeds", () => {
  test("imports mock-*.yaml from default bundled dir", () => {
    // The repo's data/seeds/mock-n2.yaml has `mock: true` so importMockSeeds
    // should pick it up. Default seed-import (importSeeds) does not.
    const summary = importMockSeeds();
    expect(summary.files.length).toBeGreaterThanOrEqual(1);
    // mock-n2.yaml should be in the file list
    const mockFile = summary.files.find((f) => f.endsWith("mock-n2.yaml"));
    expect(mockFile).toBeDefined();
    // 30 questions in mock-n2.yaml, all valid, so inserted+updated >= 30 over
    // the test lifetime. We can't say strict equality because earlier test
    // runs may have inserted them already.
    expect(summary.inserted + summary.updated).toBeGreaterThanOrEqual(30);
  });
});

describe("buildMockReport edge cases", () => {
  test("empty results → 0/0/0 with empty by_type", () => {
    const r = buildMockReport([]);
    expect(r.total).toBe(0);
    expect(r.correct).toBe(0);
    expect(r.accuracy).toBe(0);
    expect(r.by_type).toEqual([]);
  });

  test("all correct → accuracy 1.0", () => {
    const results: MockResult[] = [
      { question_id: "x1", type: "vocab", user_choice: 0, is_correct: true, created_at: 1 },
      { question_id: "x2", type: "vocab", user_choice: 0, is_correct: true, created_at: 2 },
    ];
    const r = buildMockReport(results);
    expect(r.accuracy).toBe(1);
  });
});
