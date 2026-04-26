import { getDb, rowToConcept, type ConceptOut, type ConceptRow } from "./db.ts";
import { levelsInLearningRange, readProfile, type Profile } from "./profile.ts";

export interface NextOptions {
  type?: "vocab" | "grammar" | "kanji" | "expression";
  level?: string;
  difficulty?: "easy" | "hard";
}

export function getNextDue(opts: NextOptions = {}): ConceptOut | null {
  const db = getDb();
  const profile = readProfile();
  const now = Date.now();

  const wherePieces: string[] = ["r.due_at <= ?"];
  const params: unknown[] = [now];

  const allowedLevels = filterLevels(profile, opts);
  if (allowedLevels.length) {
    wherePieces.push(`c.level IN (${allowedLevels.map(() => "?").join(",")})`);
    params.push(...allowedLevels);
  }
  if (opts.type) {
    wherePieces.push("c.type = ?");
    params.push(opts.type);
  }

  const dueRow = db
    .query(
      `SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE ${wherePieces.join(" AND ")}
       ORDER BY r.due_at ASC LIMIT 1`,
    )
    .get(...params) as ConceptRow | null;

  if (dueRow) return rowToConcept(dueRow);

  if (todayNewIntroducedCount() >= profile.daily_new_count) return null;
  return pickNewConcept(opts, allowedLevels);
}

function filterLevels(profile: Profile, opts: NextOptions): string[] {
  if (opts.level) return [opts.level];
  if (opts.difficulty === "easy") {
    const all = levelsInLearningRange(profile);
    return all.slice(0, Math.max(1, all.length - 1));
  }
  if (opts.difficulty === "hard") {
    const all = levelsInLearningRange(profile);
    return all.slice(-1);
  }
  return levelsInLearningRange(profile);
}

function todayNewIntroducedCount(): number {
  const db = getDb();
  const since = startOfTodayMs();
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM reviews
       WHERE last_review IS NULL AND due_at >= ? AND due_at < ?`,
    )
    .get(since, since + 24 * 3600 * 1000) as { n: number };
  return row.n ?? 0;
}

function startOfTodayMs(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pickNewConcept(opts: NextOptions, allowedLevels: string[]): ConceptOut | null {
  const db = getDb();
  const wherePieces: string[] = ["r.concept_id IS NULL"];
  const params: unknown[] = [];
  if (allowedLevels.length) {
    wherePieces.push(`c.level IN (${allowedLevels.map(() => "?").join(",")})`);
    params.push(...allowedLevels);
  }
  if (opts.type) {
    wherePieces.push("c.type = ?");
    params.push(opts.type);
  }
  const row = db
    .query(
      `SELECT c.* FROM concepts c LEFT JOIN reviews r ON r.concept_id = c.id
       WHERE ${wherePieces.join(" AND ")}
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(...params) as ConceptRow | null;
  return row ? rowToConcept(row) : null;
}

export function dueCount(): number {
  const db = getDb();
  const row = db
    .query("SELECT COUNT(*) AS n FROM reviews WHERE due_at <= ?")
    .get(Date.now()) as { n: number };
  return row.n ?? 0;
}

export function getStats() {
  const db = getDb();
  const today = startOfTodayMs();
  const totalConcepts = (db.query("SELECT COUNT(*) AS n FROM concepts").get() as { n: number }).n;
  const introduced = (db.query("SELECT COUNT(*) AS n FROM reviews").get() as { n: number }).n;
  const due = dueCount();
  const todayAttempts = (
    db.query("SELECT COUNT(*) AS n FROM attempts WHERE created_at >= ?").get(today) as { n: number }
  ).n;
  const todayCorrect = (
    db.query("SELECT COUNT(*) AS n FROM attempts WHERE created_at >= ? AND rating >= 3").get(today) as { n: number }
  ).n;
  const accuracy = todayAttempts > 0 ? todayCorrect / todayAttempts : 0;

  const byLevel = db
    .query(
      `SELECT c.level, COUNT(*) AS n,
              SUM(CASE WHEN r.concept_id IS NOT NULL THEN 1 ELSE 0 END) AS introduced
       FROM concepts c LEFT JOIN reviews r ON r.concept_id = c.id
       GROUP BY c.level`,
    )
    .all() as { level: string; n: number; introduced: number }[];

  return {
    total_concepts: totalConcepts,
    introduced,
    due_now: due,
    today_attempts: todayAttempts,
    today_correct: todayCorrect,
    today_accuracy: accuracy,
    by_level: byLevel,
  };
}

export function listDueConcepts(limit = 50): ConceptOut[] {
  const db = getDb();
  const rows = db
    .query(
      `SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE r.due_at <= ? ORDER BY r.due_at ASC LIMIT ?`,
    )
    .all(Date.now(), limit) as ConceptRow[];
  return rows.map(rowToConcept);
}
