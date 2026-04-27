/**
 * Ambient mix-language engine (Phase 1.1b Task 5 / D19b+d / Adj-G).
 *
 * Pure data access on top of the SQLite schema:
 *   - getMixVocab(lang, limit, masteredRatio) — 80% mastered + 20% weak pool
 *     per Krashen i+1 (planner v4 §4 D19b)
 *   - logAmbientExposures(conceptIds, language) — batch INSERT after a hook
 *     successfully injects a mix prompt
 *   - cleanOldExposures(beforeMs) — DELETE rows older than threshold
 *   - archiveExposures(beforeMs) — GROUP BY concept_id + UPSERT archive
 *
 * Usage from the UserPromptSubmit hook:
 *     const vocab = getMixVocab(profile.active_language, 15);
 *     buildImmersionPrompt({...}, vocab);
 *     logAmbientExposures(vocab.map(v => v.id), profile.active_language);
 */
import type { Database } from "bun:sqlite";
import { getDb } from "./db.ts";
import type { MixVocabItem } from "./utils/immersion.ts";

// Test seam — allow tests to inject an in-memory DB. Lives at module scope
// so each ambient.* function reads through this indirection without needing
// every callsite to thread the DB explicitly.
let _testDb: Database | null = null;
export function setDbForTesting(db: Database | null): void {
  _testDb = db;
}
function conn(): Database {
  return _testDb ?? getDb();
}

const MASTERED_STABILITY_DAYS = 7;
const MS_PER_DAY = 24 * 3600 * 1000;
const STATE_REVIEW = 2;
const STATE_LEARNING = 1;
const STATE_RELEARNING = 3;

export interface MixVocabOptions {
  /** Default 0.8 (12 mastered + 3 weak in a 15-item pool). */
  masteredRatio?: number;
  /** Default 15. Hook caps to keep prompt cost bounded. */
  limit?: number;
  /** Test seam — fixed shuffle for deterministic assertions. */
  shuffle?: <T>(items: T[]) => T[];
}

function defaultShuffle<T>(items: T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pull ambient mix vocab pool: 80% mastered (high stability, state=Review)
 * + 20% weak (state Learning/Relearning OR low stability with lapses).
 * Returns [] if mastered pool is empty (graceful skip — D19b §4).
 */
export function getMixVocab(language: string, opts: MixVocabOptions = {}): MixVocabItem[] {
  const limit = Math.max(1, opts.limit ?? 15);
  const masteredRatio = Math.max(0, Math.min(1, opts.masteredRatio ?? 0.8));
  const masteredTarget = Math.floor(limit * masteredRatio);
  const weakTarget = limit - masteredTarget;
  const masteredCutoffMs = MASTERED_STABILITY_DAYS * MS_PER_DAY;
  const db = conn();

  const masteredRows = db
    .query(
      `SELECT c.id, c.ja, c.reading, c.zh
       FROM reviews r JOIN concepts c ON c.id = r.concept_id
       WHERE c.language = ? AND r.state = ? AND r.stability >= ?
       ORDER BY RANDOM() LIMIT ?`,
    )
    .all(language, STATE_REVIEW, masteredCutoffMs, masteredTarget) as RawVocab[];

  // Graceful skip: empty mastered pool → check whether ANY review rows exist
  // for this language. If zero (e.g., mix-only languages like en with no FSRS
  // history), fall back to a random sample from the concepts table directly.
  // Preserves Krashen i+1 semantics for studied languages — only kicks in for
  // never-studied languages.
  if (masteredRows.length === 0) {
    const reviewCount = (db
      .query(
        `SELECT COUNT(*) AS n
         FROM reviews r JOIN concepts c ON c.id = r.concept_id
         WHERE c.language = ?`,
      )
      .get(language) as { n: number }).n;

    if (reviewCount > 0) {
      // Studied language but no mastered words yet — preserve original
      // graceful-skip behavior so the hook logs ambient_skip.
      return [];
    }

    // Mix-only language fallback: random sample from concepts table.
    const fallbackRows = db
      .query(
        `SELECT id, ja, reading, zh
         FROM concepts WHERE language = ?
         ORDER BY RANDOM() LIMIT ?`,
      )
      .all(language, limit) as RawVocab[];

    return fallbackRows.map(toMixVocabItem);
  }

  const weakRows = weakTarget > 0
    ? (db
        .query(
          `SELECT c.id, c.ja, c.reading, c.zh
           FROM reviews r JOIN concepts c ON c.id = r.concept_id
           WHERE c.language = ?
             AND ((r.state IN (?, ?)) OR (r.stability < ? AND r.lapses > 0))
           ORDER BY RANDOM() LIMIT ?`,
        )
        .all(language, STATE_LEARNING, STATE_RELEARNING, masteredCutoffMs, weakTarget) as RawVocab[])
    : [];

  const shuffler = opts.shuffle ?? defaultShuffle;
  const merged = [...masteredRows, ...weakRows].map(toMixVocabItem);
  return shuffler(merged);
}

/**
 * Batch-INSERT one exposure row per concept_id. Caller passes the full
 * vocab list it injected (not just the ones the LLM "used") because we
 * can't observe the LLM's actual replacement decisions — we only know
 * what we suggested. Stats query treats this as upper-bound exposure.
 */
export function logAmbientExposures(
  conceptIds: readonly string[],
  language: string,
  source = "mix",
  now: number = Date.now(),
): number {
  if (conceptIds.length === 0) return 0;
  const db = conn();
  const stmt = db.prepare(
    "INSERT INTO ambient_exposures (concept_id, language, source, created_at) VALUES (?, ?, ?, ?)",
  );
  const tx = db.transaction((ids: readonly string[]) => {
    for (const id of ids) stmt.run(id, language, source, now);
  });
  tx(conceptIds);
  return conceptIds.length;
}

/**
 * Hard-delete ambient_exposures rows older than `beforeMs` (UTC ms).
 * Returns deleted count. Pair with archiveExposures() to preserve cumulative
 * stats before deletion.
 */
export function cleanOldExposures(beforeMs: number): number {
  const db = conn();
  const before = db
    .query("SELECT COUNT(*) AS n FROM ambient_exposures WHERE created_at < ?")
    .get(beforeMs) as { n: number };
  db.prepare("DELETE FROM ambient_exposures WHERE created_at < ?").run(beforeMs);
  return before.n ?? 0;
}

/**
 * Archive ambient_exposures rows older than `beforeMs` into
 * ambient_exposures_archive (cumulative_count = group count). Multiple
 * runs accumulate as separate archive_at rows (PK collision-free).
 * Returns the number of distinct (concept_id, language) groups archived.
 */
export function archiveExposures(beforeMs: number, archiveTs: number = Date.now()): number {
  const db = conn();
  const groups = db
    .query(
      `SELECT concept_id, language, COUNT(*) AS n
       FROM ambient_exposures
       WHERE created_at < ?
       GROUP BY concept_id, language`,
    )
    .all(beforeMs) as { concept_id: string; language: string; n: number }[];
  if (groups.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO ambient_exposures_archive (concept_id, language, cumulative_count, archived_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(concept_id, archived_at) DO UPDATE SET
       cumulative_count = cumulative_count + excluded.cumulative_count`,
  );
  const tx = db.transaction(() => {
    for (const g of groups) stmt.run(g.concept_id, g.language, g.n, archiveTs);
  });
  tx();
  return groups.length;
}

/**
 * Combined stats for `lt stats --ambient` and `daily-push` 100K threshold.
 * Counts both live + archived rows.
 */
export interface AmbientStats {
  language: string;
  live_count: number;
  archived_count: number;
  total: number;
  unique_concepts: number;
  top_concepts: { concept_id: string; ja: string; zh: string; n: number }[];
}

export function getAmbientStats(language: string, topN = 5): AmbientStats {
  const db = conn();
  const live = (db
    .query("SELECT COUNT(*) AS n FROM ambient_exposures WHERE language = ?")
    .get(language) as { n: number }).n ?? 0;
  const archived = (db
    .query(
      "SELECT COALESCE(SUM(cumulative_count), 0) AS n FROM ambient_exposures_archive WHERE language = ?",
    )
    .get(language) as { n: number }).n ?? 0;
  const unique = (db
    .query(
      "SELECT COUNT(DISTINCT concept_id) AS n FROM ambient_exposures WHERE language = ?",
    )
    .get(language) as { n: number }).n ?? 0;
  const top = db
    .query(
      `SELECT a.concept_id, c.ja, c.zh, COUNT(*) AS n
       FROM ambient_exposures a JOIN concepts c ON c.id = a.concept_id
       WHERE a.language = ?
       GROUP BY a.concept_id
       ORDER BY n DESC LIMIT ?`,
    )
    .all(language, topN) as { concept_id: string; ja: string; zh: string; n: number }[];
  return {
    language,
    live_count: live,
    archived_count: archived,
    total: live + archived,
    unique_concepts: unique,
    top_concepts: top,
  };
}

interface RawVocab {
  id: string;
  ja: string;
  reading: string | null;
  zh: string;
}

function toMixVocabItem(r: RawVocab): MixVocabItem {
  return r.reading
    ? { id: r.id, ja: r.ja, reading: r.reading, zh: r.zh }
    : { id: r.id, ja: r.ja, zh: r.zh };
}
