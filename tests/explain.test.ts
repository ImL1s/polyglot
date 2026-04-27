import { describe, test, expect, afterEach } from "bun:test";
import { getDb } from "../src/db.ts";
import { recordAnswer } from "../src/srs.ts";
import { buildExplainPayload, cacheExplainFeedback, EXPLAIN_LIMITS } from "../src/explain.ts";

/**
 * The explain payload is what /lt explain feeds the LLM. It must:
 * - return null on unknown concept (caller exits 2)
 * - cap recent_attempts to 5 newest, ordered desc
 * - truncate user_answer / llm_feedback to budget caps
 * - keep total JSON < 8K chars even with 5 max-length attempts
 * - report stats {total_attempts, accuracy} computed across ALL attempts (not the truncated 5)
 *
 * cacheExplainFeedback should append to the latest attempt's llm_feedback so
 * future /lt explain calls see prior teaching, and should be no-op when no
 * attempts exist yet for the concept.
 */
function seedConcept(suffix: string): string {
  const db = getDb();
  const id = `__explain_test_${Date.now()}_${suffix}_${Math.random().toString(36).slice(2)}`;
  db.run(
    "INSERT INTO concepts (id, type, level, ja, reading, zh, examples, tags, pos, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      "vocab",
      "N3",
      "勉強",
      "べんきょう",
      "学习",
      JSON.stringify([{ ja: "毎日勉強します。", zh: "每天学习。" }]),
      JSON.stringify(["test"]),
      "noun",
      Date.now(),
    ],
  );
  return id;
}

function cleanup(conceptId: string) {
  const db = getDb();
  db.run("DELETE FROM attempts WHERE concept_id = ?", [conceptId]);
  db.run("DELETE FROM reviews WHERE concept_id = ?", [conceptId]);
  db.run("DELETE FROM concepts WHERE id = ?", [conceptId]);
}

describe("explain payload shape", () => {
  let conceptId: string | null = null;
  afterEach(() => {
    if (conceptId) cleanup(conceptId);
    conceptId = null;
  });

  test("unknown concept returns null", () => {
    expect(buildExplainPayload("nonexistent_concept_id_xxx")).toBeNull();
  });

  test("zero attempts: returns concept with empty recent_attempts and 0/0 stats", () => {
    conceptId = seedConcept("zero");
    const payload = buildExplainPayload(conceptId)!;
    expect(payload.concept.id).toBe(conceptId);
    expect(payload.concept.ja).toBe("勉強");
    expect(payload.concept.examples.length).toBe(1);
    expect(payload.recent_attempts).toEqual([]);
    expect(payload.stats.total_attempts).toBe(0);
    expect(payload.stats.accuracy).toBe(0);
  });

  test("one attempt: stats accuracy reflects that single rating", () => {
    conceptId = seedConcept("one");
    recordAnswer({ conceptId, rating: 4, userAnswer: "学习", llmFeedback: "rating_4_easy: 全对" });
    const payload = buildExplainPayload(conceptId)!;
    expect(payload.recent_attempts.length).toBe(1);
    expect(payload.recent_attempts[0].rating).toBe(4);
    expect(payload.recent_attempts[0].user_answer).toBe("学习");
    expect(payload.stats.total_attempts).toBe(1);
    expect(payload.stats.accuracy).toBe(1);
  });

  test("8 attempts: recent_attempts capped at 5 newest, stats counts ALL 8", () => {
    conceptId = seedConcept("eight");
    // 4 wrong (rating 1), 4 correct (rating 3); insert in order so newest are correct
    for (let i = 0; i < 4; i++) {
      recordAnswer({
        conceptId,
        rating: 1,
        userAnswer: `wrong${i}`,
        llmFeedback: "rating_1_again",
        now: new Date(Date.now() + i),
      });
    }
    for (let i = 0; i < 4; i++) {
      recordAnswer({
        conceptId,
        rating: 3,
        userAnswer: `right${i}`,
        llmFeedback: "rating_3_good",
        now: new Date(Date.now() + 100 + i),
      });
    }
    const payload = buildExplainPayload(conceptId)!;
    expect(payload.recent_attempts.length).toBe(EXPLAIN_LIMITS.MAX_RECENT_ATTEMPTS);
    expect(payload.stats.total_attempts).toBe(8);
    expect(payload.stats.accuracy).toBe(0.5);
    // Most recent first; the latest 5 should include all 4 rating=3 attempts.
    const ratings = payload.recent_attempts.map((a) => a.rating);
    expect(ratings.filter((r) => r === 3).length).toBe(4);
    expect(ratings.filter((r) => r === 1).length).toBe(1);
  });

  test("oversize user_answer / llm_feedback get truncated with ellipsis", () => {
    conceptId = seedConcept("trunc");
    const longAnswer = "あ".repeat(EXPLAIN_LIMITS.MAX_USER_ANSWER_CHARS + 50);
    const longFeedback = "い".repeat(EXPLAIN_LIMITS.MAX_LLM_FEEDBACK_CHARS + 100);
    recordAnswer({ conceptId, rating: 2, userAnswer: longAnswer, llmFeedback: longFeedback });
    const payload = buildExplainPayload(conceptId)!;
    const a = payload.recent_attempts[0];
    expect(a.user_answer!.length).toBe(EXPLAIN_LIMITS.MAX_USER_ANSWER_CHARS + 1);
    expect(a.user_answer!.endsWith("…")).toBe(true);
    expect(a.llm_feedback!.length).toBe(EXPLAIN_LIMITS.MAX_LLM_FEEDBACK_CHARS + 1);
    expect(a.llm_feedback!.endsWith("…")).toBe(true);
  });

  test("payload size stays under 8K char budget for 5 max-length attempts", () => {
    conceptId = seedConcept("budget");
    const longAnswer = "x".repeat(EXPLAIN_LIMITS.MAX_USER_ANSWER_CHARS + 50);
    const longFeedback = "y".repeat(EXPLAIN_LIMITS.MAX_LLM_FEEDBACK_CHARS + 100);
    for (let i = 0; i < 5; i++) {
      recordAnswer({
        conceptId,
        rating: i % 4 + 1,
        userAnswer: longAnswer,
        llmFeedback: longFeedback,
        now: new Date(Date.now() + i),
      });
    }
    const payload = buildExplainPayload(conceptId)!;
    const json = JSON.stringify(payload);
    expect(json.length).toBeLessThan(EXPLAIN_LIMITS.PAYLOAD_CHAR_BUDGET);
  });
});

describe("cacheExplainFeedback", () => {
  let conceptId: string | null = null;
  afterEach(() => {
    if (conceptId) cleanup(conceptId);
    conceptId = null;
  });

  test("no attempts yet: returns false (nothing to attach to)", () => {
    conceptId = seedConcept("nocache");
    const ok = cacheExplainFeedback(conceptId, "5-段讲解…");
    expect(ok).toBe(false);
  });

  test("appends [explain] tag to latest attempt's llm_feedback (preserves prior rubric line)", () => {
    conceptId = seedConcept("cache");
    recordAnswer({ conceptId, rating: 1, userAnswer: "wrong", llmFeedback: "rating_1_again" });
    const ok = cacheExplainFeedback(conceptId, "词源: 勉 = 努力, 強 = 强");
    expect(ok).toBe(true);

    const db = getDb();
    const row = db
      .query("SELECT llm_feedback FROM attempts WHERE concept_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(conceptId) as { llm_feedback: string };
    expect(row.llm_feedback).toContain("rating_1_again");
    expect(row.llm_feedback).toContain("[explain]");
    expect(row.llm_feedback).toContain("词源: 勉");
  });

  test("attaches to most-recent attempt only (not older ones)", () => {
    conceptId = seedConcept("multicache");
    recordAnswer({ conceptId, rating: 1, llmFeedback: "old", now: new Date(Date.now() - 1000) });
    recordAnswer({ conceptId, rating: 2, llmFeedback: "newer", now: new Date() });
    cacheExplainFeedback(conceptId, "teach v2");

    const db = getDb();
    const rows = db
      .query("SELECT rating, llm_feedback FROM attempts WHERE concept_id = ? ORDER BY created_at ASC")
      .all(conceptId) as { rating: number; llm_feedback: string }[];
    expect(rows[0].llm_feedback).toBe("old");
    expect(rows[1].llm_feedback).toContain("[explain] teach v2");
  });
});
