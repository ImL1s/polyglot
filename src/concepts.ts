import { getDb, rowToConcept, type ConceptOut, type ConceptRow } from "./db.ts";
import { levelsInLearningRange, readProfile, type Profile } from "./profile.ts";

export type ConceptType = "vocab" | "grammar" | "kanji" | "expression";
// `listening` is a virtual drill type, not a stored concept.type. When
// requested, getNextDue samples from the vocab pool (constrained to rows that
// have a non-null reading so kana matching can score the answer). The
// returned ConceptOut keeps its real `type: "vocab"` — the skill
// distinguishes drill mode by remembering the original opts.type.
export type RequestType = ConceptType | "listening";

export interface NextOptions {
  type?: RequestType;
  level?: string;
  difficulty?: "easy" | "hard";
  language?: string;
}

interface TypeFilter {
  sql: string;
  params: unknown[];
}

function buildTypeFilter(type?: RequestType): TypeFilter | null {
  if (!type) return null;
  if (type === "listening") {
    return { sql: "c.type = ? AND c.reading IS NOT NULL AND c.reading != ''", params: ["vocab"] };
  }
  return { sql: "c.type = ?", params: [type] };
}

export function getNextDue(opts: NextOptions = {}): ConceptOut | null {
  const db = getDb();
  const profile = readProfile();
  const lang = opts.language ?? profile.active_language;
  const now = Date.now();

  const wherePieces: string[] = ["r.due_at <= ?", "c.language = ?"];
  const params: unknown[] = [now, lang];

  const allowedLevels = filterLevels(profile, opts);
  if (allowedLevels.length) {
    wherePieces.push(`c.level IN (${allowedLevels.map(() => "?").join(",")})`);
    params.push(...allowedLevels);
  }
  const typeFilter = buildTypeFilter(opts.type);
  if (typeFilter) {
    wherePieces.push(typeFilter.sql);
    params.push(...typeFilter.params);
  }

  const dueRow = db
    .query(
      `SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE ${wherePieces.join(" AND ")}
       ORDER BY r.due_at ASC LIMIT 1`,
    )
    .get(...params) as ConceptRow | null;

  if (dueRow) return rowToConcept(dueRow);

  if (todayNewIntroducedCount(lang) >= profile.daily_new_count) return null;
  return pickNewConcept(opts, allowedLevels, lang);
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

function todayNewIntroducedCount(language: string): number {
  const db = getDb();
  const since = startOfTodayMs();
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE r.last_review IS NULL AND r.due_at >= ? AND r.due_at < ? AND c.language = ?`,
    )
    .get(since, since + 24 * 3600 * 1000, language) as { n: number };
  return row.n ?? 0;
}

function startOfTodayMs(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function pickNewConcept(opts: NextOptions, allowedLevels: string[], language: string): ConceptOut | null {
  const db = getDb();
  const wherePieces: string[] = ["r.concept_id IS NULL", "c.language = ?"];
  const params: unknown[] = [language];
  if (allowedLevels.length) {
    wherePieces.push(`c.level IN (${allowedLevels.map(() => "?").join(",")})`);
    params.push(...allowedLevels);
  }
  const typeFilter = buildTypeFilter(opts.type);
  if (typeFilter) {
    wherePieces.push(typeFilter.sql);
    params.push(...typeFilter.params);
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

export function dueCount(language?: string): number {
  const db = getDb();
  const lang = language ?? readProfile().active_language;
  const row = db
    .query(
      `SELECT COUNT(*) AS n FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE r.due_at <= ? AND c.language = ?`,
    )
    .get(Date.now(), lang) as { n: number };
  return row.n ?? 0;
}

export function getStats(language?: string) {
  const db = getDb();
  const lang = language ?? readProfile().active_language;
  const today = startOfTodayMs();
  const totalConcepts = (
    db.query("SELECT COUNT(*) AS n FROM concepts WHERE language = ?").get(lang) as { n: number }
  ).n;
  const introduced = (
    db
      .query(
        "SELECT COUNT(*) AS n FROM reviews r JOIN concepts c ON c.id = r.concept_id WHERE c.language = ?",
      )
      .get(lang) as { n: number }
  ).n;
  const due = dueCount(lang);
  const todayAttempts = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM attempts a JOIN concepts c ON c.id = a.concept_id
         WHERE a.created_at >= ? AND c.language = ?`,
      )
      .get(today, lang) as { n: number }
  ).n;
  const todayCorrect = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM attempts a JOIN concepts c ON c.id = a.concept_id
         WHERE a.created_at >= ? AND a.rating >= 3 AND c.language = ?`,
      )
      .get(today, lang) as { n: number }
  ).n;
  const accuracy = todayAttempts > 0 ? todayCorrect / todayAttempts : 0;

  const byLevel = db
    .query(
      `SELECT c.level, COUNT(*) AS n,
              SUM(CASE WHEN r.concept_id IS NOT NULL THEN 1 ELSE 0 END) AS introduced
       FROM concepts c LEFT JOIN reviews r ON r.concept_id = c.id
       WHERE c.language = ?
       GROUP BY c.level`,
    )
    .all(lang) as { level: string; n: number; introduced: number }[];

  return {
    language: lang,
    total_concepts: totalConcepts,
    introduced,
    due_now: due,
    today_attempts: todayAttempts,
    today_correct: todayCorrect,
    today_accuracy: accuracy,
    by_level: byLevel,
  };
}

export function listDueConcepts(limit = 50, language?: string): ConceptOut[] {
  const db = getDb();
  const lang = language ?? readProfile().active_language;
  const rows = db
    .query(
      `SELECT c.* FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE r.due_at <= ? AND c.language = ? ORDER BY r.due_at ASC LIMIT ?`,
    )
    .all(Date.now(), lang, limit) as ConceptRow[];
  return rows.map(rowToConcept);
}
