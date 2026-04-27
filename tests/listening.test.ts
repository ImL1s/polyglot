import { describe, test, expect } from "bun:test";
import { gradeListeningAnswer, normalizeKana } from "../src/listening.ts";
import { getNextDue } from "../src/concepts.ts";
import { getDb } from "../src/db.ts";
import { patchProfile, readProfile } from "../src/profile.ts";

/**
 * Listening drill tests cover the two halves of the feature independently:
 *
 *  1. `gradeListeningAnswer` — pure scoring function. Tests assert kana
 *     normalization (katakana folding, whitespace stripping) and the D15
 *     rubric (mismatch caps at rating 2 unless distance ≥ 2 → rating 1).
 *  2. `getNextDue({ type: 'listening' })` — DB query. Tests insert a few
 *     synthetic concepts (with and without reading), confirm only the ones
 *     with a non-null reading are eligible, and clean up after.
 *
 * The DB tests use unique synthetic ids prefixed `__test_listen_` so they
 * never collide with seed data even when run in parallel with other tests.
 */

describe("normalizeKana", () => {
  test("katakana folds to hiragana", () => {
    expect(normalizeKana("コンピューター")).toBe("こんぴゅーたー");
  });

  test("whitespace and punctuation stripped", () => {
    expect(normalizeKana("ね こ。")).toBe("ねこ");
    expect(normalizeKana(" こんにちは ")).toBe("こんにちは");
  });

  test("hiragana passes through", () => {
    expect(normalizeKana("ねこ")).toBe("ねこ");
  });

  test("empty / null-ish stays empty", () => {
    expect(normalizeKana("")).toBe("");
    expect(normalizeKana("   ")).toBe("");
  });

  test("yōon NOT folded (しゃ != しや)", () => {
    expect(normalizeKana("しゃ")).toBe("しゃ");
    expect(normalizeKana("しや")).toBe("しや");
    expect(normalizeKana("しゃ")).not.toBe(normalizeKana("しや"));
  });
});

describe("gradeListeningAnswer rubric", () => {
  test("exact hiragana match → rating_4_easy", () => {
    const grade = gradeListeningAnswer("ねこ", "ねこ");
    expect(grade.rating).toBe(4);
    expect(grade.rubric).toBe("rating_4_easy");
    expect(grade.exact_match).toBe(true);
  });

  test("exact katakana → hiragana match → rating_4_easy (case-insensitive script)", () => {
    const grade = gradeListeningAnswer("ネコ", "ねこ");
    expect(grade.rating).toBe(4);
    expect(grade.rubric).toBe("rating_4_easy");
  });

  test("single-char substitution → rating_2_hard", () => {
    // ねこ vs ねき: 1 edit
    const grade = gradeListeningAnswer("ねき", "ねこ");
    expect(grade.rating).toBe(2);
    expect(grade.rubric).toBe("rating_2_hard");
    expect(grade.exact_match).toBe(false);
  });

  test("single-char insertion → rating_2_hard", () => {
    // ねこ vs ねっこ: 1 edit
    const grade = gradeListeningAnswer("ねっこ", "ねこ");
    expect(grade.rating).toBe(2);
  });

  test("single-char deletion → rating_2_hard", () => {
    // こんにちは vs こんちは: 1 edit
    const grade = gradeListeningAnswer("こんちは", "こんにちは");
    expect(grade.rating).toBe(2);
  });

  test("two-char mismatch → rating_1_again", () => {
    // ねこ vs いぬ: distance 2
    const grade = gradeListeningAnswer("いぬ", "ねこ");
    expect(grade.rating).toBe(1);
    expect(grade.rubric).toBe("rating_1_again");
  });

  test("empty user answer → rating_1_again", () => {
    expect(gradeListeningAnswer("", "ねこ").rating).toBe(1);
    expect(gradeListeningAnswer("   ", "ねこ").rating).toBe(1);
  });

  test("D15 rule: mismatch never bumps to rating 3", () => {
    // No matter how close, a mismatch can't be rating 3 — caps at 2.
    const grade = gradeListeningAnswer("ねき", "ねこ");
    expect(grade.rating).not.toBe(3);
    expect(grade.rating).toBeLessThanOrEqual(2);
  });

  test("normalizes both sides before comparing", () => {
    // user typed katakana with spaces, expected stored as hiragana
    const grade = gradeListeningAnswer("ネ コ", "ねこ");
    expect(grade.rating).toBe(4);
    expect(grade.normalized_user).toBe("ねこ");
    expect(grade.normalized_expected).toBe("ねこ");
  });
});

describe("getNextDue with type=listening", () => {
  // Helper to seed/cleanup synthetic concepts so DB tests are hermetic.
  function withSynthetic(
    rows: { id: string; type: string; reading: string | null; level: string }[],
    fn: () => void,
  ) {
    const db = getDb();
    const insert = db.prepare(
      `INSERT INTO concepts (id, type, level, ja, reading, zh, examples, tags, pos, created_at, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const r of rows) {
      insert.run(r.id, r.type, r.level, "テスト", r.reading, "测试", null, null, null, now, "ja");
    }
    try {
      fn();
    } finally {
      const ids = rows.map((r) => r.id);
      const placeholders = ids.map(() => "?").join(",");
      db.run(`DELETE FROM reviews WHERE concept_id IN (${placeholders})`, ids);
      db.run(`DELETE FROM attempts WHERE concept_id IN (${placeholders})`, ids);
      db.run(`DELETE FROM concepts WHERE id IN (${placeholders})`, ids);
    }
  }

  test("listening filter excludes concepts without reading", () => {
    // Save and lock down profile so this test isolates from seed data: only
    // ja/N3 + level filter to N3-only, and bump daily_new_count so we don't
    // hit the new-concept quota gate.
    const before = readProfile();
    patchProfile({
      level: "N3",
      target: "N3",
      active_language: "ja",
      daily_new_count: 999,
      per_language: { ja: { level: "N3", target: "N3", weak_areas: [] } },
    });
    try {
      withSynthetic(
        [
          // listening-eligible: vocab + reading
          { id: "__test_listen_a", type: "vocab", reading: "ねこ", level: "N3" },
          // not eligible: vocab + null reading
          { id: "__test_listen_b", type: "vocab", reading: null, level: "N3" },
          // not eligible: grammar (only vocab is sampled for listening)
          { id: "__test_listen_c", type: "grammar", reading: "something", level: "N3" },
        ],
        () => {
          // Sample multiple times; the picker uses RANDOM() over due+new pool,
          // so we just want to confirm we never get b or c.
          const seen = new Set<string>();
          for (let i = 0; i < 25; i++) {
            const concept = getNextDue({ type: "listening", level: "N3", language: "ja" });
            if (concept) seen.add(concept.id);
          }
          // we should at least see __test_listen_a or some other valid vocab
          // concept from seeds (still has reading), but never b or c.
          expect(seen.has("__test_listen_b")).toBe(false);
          expect(seen.has("__test_listen_c")).toBe(false);
        },
      );
    } finally {
      patchProfile(before);
    }
  });

  test("regular type=vocab still works (no regression)", () => {
    const before = readProfile();
    patchProfile({
      level: "N3",
      target: "N3",
      active_language: "ja",
      daily_new_count: 999,
      per_language: { ja: { level: "N3", target: "N3", weak_areas: [] } },
    });
    try {
      const concept = getNextDue({ type: "vocab", level: "N3", language: "ja" });
      expect(concept).not.toBeNull();
      expect(concept!.type).toBe("vocab");
    } finally {
      patchProfile(before);
    }
  });

  test("returned concept.type is the underlying vocab (not 'listening')", () => {
    const before = readProfile();
    patchProfile({
      level: "N3",
      target: "N3",
      active_language: "ja",
      daily_new_count: 999,
      per_language: { ja: { level: "N3", target: "N3", weak_areas: [] } },
    });
    try {
      const concept = getNextDue({ type: "listening", level: "N3", language: "ja" });
      // 'listening' is virtual: stored type stays vocab.
      if (concept) {
        expect(concept.type).toBe("vocab");
        expect(concept.reading).not.toBeNull();
      }
    } finally {
      patchProfile(before);
    }
  });
});
