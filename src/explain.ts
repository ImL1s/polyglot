import { getDb, rowToConcept, type ConceptOut, type ConceptRow } from "./db.ts";

export interface ExplainAttempt {
  rating: number;
  user_answer: string | null;
  llm_feedback: string | null;
  source: string | null;
  created_at: number;
}

export interface ExplainPayload {
  concept: ConceptOut;
  recent_attempts: ExplainAttempt[];
  stats: { total_attempts: number; accuracy: number };
}

/**
 * Token-budget caps to keep the JSON payload under ~8K chars even when the
 * concept has dozens of attempts with verbose feedback. Without these the
 * payload can explode past Claude's context budget for one tool call.
 */
const MAX_RECENT_ATTEMPTS = 5;
const MAX_USER_ANSWER_CHARS = 200;
const MAX_LLM_FEEDBACK_CHARS = 500;

function truncate(s: string | null | undefined, max: number): string | null {
  if (s == null) return null;
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}

export function buildExplainPayload(conceptId: string): ExplainPayload | null {
  const db = getDb();
  const conceptRow = db
    .query("SELECT * FROM concepts WHERE id = ?")
    .get(conceptId) as ConceptRow | null;
  if (!conceptRow) return null;

  const attemptRows = db
    .query(
      `SELECT rating, user_answer, llm_feedback, source, created_at
         FROM attempts WHERE concept_id = ?
        ORDER BY created_at DESC LIMIT ?`,
    )
    .all(conceptId, MAX_RECENT_ATTEMPTS) as ExplainAttempt[];

  const totals = db
    .query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN rating >= 3 THEN 1 ELSE 0 END) AS correct
         FROM attempts WHERE concept_id = ?`,
    )
    .get(conceptId) as { total: number; correct: number };
  const total = totals?.total ?? 0;
  const correct = totals?.correct ?? 0;
  const accuracy = total > 0 ? correct / total : 0;

  return {
    concept: rowToConcept(conceptRow),
    recent_attempts: attemptRows.map((a) => ({
      rating: a.rating,
      user_answer: truncate(a.user_answer, MAX_USER_ANSWER_CHARS),
      llm_feedback: truncate(a.llm_feedback, MAX_LLM_FEEDBACK_CHARS),
      source: a.source,
      created_at: a.created_at,
    })),
    stats: { total_attempts: total, accuracy },
  };
}

export const EXPLAIN_LIMITS = {
  MAX_RECENT_ATTEMPTS,
  MAX_USER_ANSWER_CHARS,
  MAX_LLM_FEEDBACK_CHARS,
  PAYLOAD_CHAR_BUDGET: 8000,
  OUTPUT_CHAR_BUDGET: 1500,
};

/**
 * Cache an explain result against the most recent attempt for this concept by
 * appending to attempts.llm_feedback. Skill calls this after the LLM produces
 * the 5-section teaching so future /lt explain runs see prior teaching.
 *
 * Returns true if a row was updated, false if no attempt exists yet (e.g.
 * explain called on a concept the user never answered).
 */
export function cacheExplainFeedback(conceptId: string, feedback: string): boolean {
  const db = getDb();
  const row = db
    .query(
      `SELECT id, llm_feedback FROM attempts
         WHERE concept_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(conceptId) as { id: number; llm_feedback: string | null } | null;
  if (!row) return false;
  const tag = "[explain]";
  const truncated = feedback.length > EXPLAIN_LIMITS.OUTPUT_CHAR_BUDGET * 4
    ? feedback.slice(0, EXPLAIN_LIMITS.OUTPUT_CHAR_BUDGET * 4) + "…"
    : feedback;
  const merged = row.llm_feedback
    ? `${row.llm_feedback}\n\n${tag} ${truncated}`
    : `${tag} ${truncated}`;
  db.run("UPDATE attempts SET llm_feedback = ? WHERE id = ?", [merged, row.id]);
  return true;
}
