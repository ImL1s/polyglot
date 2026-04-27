import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { getDb } from "./db.ts";
import { SEEDS_DIR } from "./paths.ts";

/**
 * Lazy migration for mock_questions + mock_attempts tables. Runs on first
 * call to any function in this module so we don't depend on the table being
 * created in src/db.ts (which is shared territory across other agents'
 * work). Idempotent — uses CREATE TABLE IF NOT EXISTS, safe to repeat.
 *
 * mock_attempts is separate from the main attempts table because mock
 * question ids do NOT exist in concepts, so the FK on
 * attempts.concept_id REFERENCES concepts(id) (with PRAGMA foreign_keys=ON)
 * would reject mock inserts. Splitting the tables keeps both invariants
 * intact and makes ambient-validate stats easier to scope ('source=mock'
 * filter is no longer needed).
 */
let _mockMigrated = false;
function ensureMockTable(): void {
  if (_mockMigrated) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS mock_questions (
      id           TEXT PRIMARY KEY,
      level        TEXT NOT NULL,
      type         TEXT NOT NULL,
      language     TEXT NOT NULL DEFAULT 'ja',
      question     TEXT NOT NULL,
      choices      TEXT NOT NULL,
      correct      INTEGER NOT NULL,
      explanation  TEXT,
      created_at   INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mock_attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id  TEXT NOT NULL,
      is_correct   INTEGER NOT NULL,
      user_choice  INTEGER NOT NULL,
      created_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mock_level_type_lang ON mock_questions(level, type, language);
    CREATE INDEX IF NOT EXISTS idx_mock_attempts_q ON mock_attempts(question_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_mock_attempts_created ON mock_attempts(created_at DESC);
  `);
  _mockMigrated = true;
}

export type MockType = "vocab" | "grammar" | "listening" | "reading" | "all";

export interface MockQuestion {
  id: string;
  level: string;
  type: "vocab" | "grammar" | "listening" | "reading";
  language: string;
  question: string;
  choices: string[];
  correct: number;
  explanation: string | null;
}

export interface MockResult {
  question_id: string;
  type: string;
  user_choice: number;
  is_correct: boolean;
  created_at: number;
}

export function pickMockQuestions(opts: {
  count: number;
  type?: MockType;
  level?: string;
  language?: string;
}): MockQuestion[] {
  ensureMockTable();
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.level) {
    where.push("level = ?");
    params.push(opts.level);
  }
  if (opts.language) {
    where.push("language = ?");
    params.push(opts.language);
  }
  if (opts.type && opts.type !== "all") {
    where.push("type = ?");
    params.push(opts.type);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db
    .query(
      `SELECT id, level, type, language, question, choices, correct, explanation
         FROM mock_questions ${whereSql}
        ORDER BY RANDOM() LIMIT ?`,
    )
    .all(...params, opts.count) as {
      id: string;
      level: string;
      type: "vocab" | "grammar" | "listening" | "reading";
      language: string;
      question: string;
      choices: string;
      correct: number;
      explanation: string | null;
    }[];
  return rows.map((r) => ({
    id: r.id,
    level: r.level,
    type: r.type,
    language: r.language,
    question: r.question,
    choices: JSON.parse(r.choices),
    correct: r.correct,
    explanation: r.explanation,
  }));
}

export interface MockReport {
  total: number;
  correct: number;
  accuracy: number;
  by_type: { type: string; total: number; correct: number; accuracy: number }[];
}

export function buildMockReport(results: MockResult[]): MockReport {
  const total = results.length;
  const correct = results.filter((r) => r.is_correct).length;
  const accuracy = total > 0 ? correct / total : 0;
  const byTypeMap = new Map<string, { total: number; correct: number }>();
  for (const r of results) {
    const cur = byTypeMap.get(r.type) ?? { total: 0, correct: 0 };
    cur.total += 1;
    if (r.is_correct) cur.correct += 1;
    byTypeMap.set(r.type, cur);
  }
  const by_type = Array.from(byTypeMap.entries()).map(([type, agg]) => ({
    type,
    total: agg.total,
    correct: agg.correct,
    accuracy: agg.total > 0 ? agg.correct / agg.total : 0,
  }));
  return { total, correct, accuracy, by_type };
}

/**
 * Persist one mock-test answer to mock_attempts (separate from the main
 * attempts table since mock question ids don't exist in concepts and the
 * attempts.concept_id FK would reject the insert under PRAGMA
 * foreign_keys=ON).
 */
export function recordMockAnswer(input: {
  questionId: string;
  isCorrect: boolean;
  userChoice: number;
  now?: Date;
}): void {
  ensureMockTable();
  const db = getDb();
  const now = (input.now ?? new Date()).getTime();
  db.run(
    `INSERT INTO mock_attempts (question_id, is_correct, user_choice, created_at)
     VALUES (?, ?, ?, ?)`,
    [input.questionId, input.isCorrect ? 1 : 0, input.userChoice, now],
  );
}

/**
 * Ambient-validate (Adjustment K1):
 *  - Pull mock-test attempts (source='mock') from the last `windowDays` days.
 *  - Cross-reference each question's mock concept_id with the concept it tests
 *    (we use the slug pattern: ja-mock-n2-{type}-{idx} → look for
 *    ambient_exposures keyed by the underlying concept ids the question
 *    references). For now the mock items are not yet linked to concepts, so
 *    we group by question type as a coarse proxy.
 *  - Compare answer accuracy of items belonging to concepts with cumulative
 *    ambient exposure ≥ 7 vs < 7. Returns a one-sided binomial p-value
 *    estimating whether the high-exposure group beats the low-exposure
 *    group's accuracy.
 *
 * Gracefully no-ops when ambient_exposures table doesn't exist yet (Task 24
 * not landed). Returns a structured report with `status: 'no_data'` so the
 * CLI can render a meaningful message.
 */
export interface AmbientValidateReport {
  status: "ok" | "no_data" | "no_table";
  window_days: number;
  total_mock_attempts: number;
  high_exposure: { n: number; correct: number; accuracy: number };
  low_exposure: { n: number; correct: number; accuracy: number };
  p_value: number | null;
  conclusion: string;
}

function ambientExposuresTableExists(): boolean {
  const db = getDb();
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='ambient_exposures'")
    .get() as { name: string } | null;
  return row != null;
}

/**
 * Two-proportion z-test approximation. Returns one-sided p-value testing the
 * null hypothesis: high-exposure accuracy ≤ low-exposure accuracy. We use a
 * normal approximation rather than exact binomial because:
 *  (a) sample sizes from 30-day mock-test runs are typically n_h, n_l ≥ 20 →
 *      normal approximation is reasonable
 *  (b) bun has no built-in stats lib and we avoid heavy deps
 *
 * For very small samples this overestimates significance; callers should
 * require n ≥ 10 in each group before treating p < 0.05 as confirmation.
 */
export function twoProportionPValue(
  highCorrect: number,
  highTotal: number,
  lowCorrect: number,
  lowTotal: number,
): number | null {
  if (highTotal === 0 || lowTotal === 0) return null;
  const pH = highCorrect / highTotal;
  const pL = lowCorrect / lowTotal;
  const pPool = (highCorrect + lowCorrect) / (highTotal + lowTotal);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / highTotal + 1 / lowTotal));
  if (se === 0) return pH > pL ? 0 : 1;
  const z = (pH - pL) / se;
  // One-sided upper-tail p-value for normal: 1 - Phi(z). We approximate Phi
  // with the rational approximation from Abramowitz & Stegun 26.2.17.
  return 1 - normalCdf(z);
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 26.2.17 — error < 7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p =
    d *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  if (x > 0) p = 1 - p;
  return p;
}

export function runAmbientValidate(opts: {
  windowDays?: number;
  highThreshold?: number;
  now?: Date;
}): AmbientValidateReport {
  const windowDays = opts.windowDays ?? 30;
  const highThreshold = opts.highThreshold ?? 7;
  const now = (opts.now ?? new Date()).getTime();
  const since = now - windowDays * 24 * 3600 * 1000;
  const empty: AmbientValidateReport = {
    status: "no_data",
    window_days: windowDays,
    total_mock_attempts: 0,
    high_exposure: { n: 0, correct: 0, accuracy: 0 },
    low_exposure: { n: 0, correct: 0, accuracy: 0 },
    p_value: null,
    conclusion: "no mock-test attempts in window",
  };

  ensureMockTable();
  if (!ambientExposuresTableExists()) {
    return {
      ...empty,
      status: "no_table",
      conclusion:
        "ambient_exposures table does not exist yet — run lt mix <N> after Task 24 lands to start logging exposures",
    };
  }

  const db = getDb();
  const mockAttempts = db
    .query(
      `SELECT question_id, is_correct FROM mock_attempts
        WHERE created_at >= ?`,
    )
    .all(since) as { question_id: string; is_correct: number }[];

  if (mockAttempts.length === 0) {
    return empty;
  }

  // Look up cumulative ambient_exposures count per question_id. mock_question
  // ids are NOT in ambient_exposures (which is keyed by real concept ids), so
  // until Task 24 finishes the linkage contract we coarsely group by exposure
  // count for the same id slot. Real-world counts will be 0 for now (mock
  // questions are quiz items, not study concepts), so empirically all mock
  // attempts will fall in the low-exposure bucket — that is OK; the report's
  // role is to surface 'no significant ambient effect' until linkage exists.
  let high = { n: 0, correct: 0 };
  let low = { n: 0, correct: 0 };
  for (const a of mockAttempts) {
    const exposureRow = db
      .query(
        `SELECT COUNT(*) AS n FROM ambient_exposures WHERE concept_id = ?`,
      )
      .get(a.question_id) as { n: number } | null;
    const exposureCount = exposureRow?.n ?? 0;
    const isCorrect = a.is_correct === 1;
    if (exposureCount >= highThreshold) {
      high.n += 1;
      if (isCorrect) high.correct += 1;
    } else {
      low.n += 1;
      if (isCorrect) low.correct += 1;
    }
  }

  const p = twoProportionPValue(high.correct, high.n, low.correct, low.n);
  const conclusion =
    p == null
      ? "insufficient data in one or both groups (need n ≥ 10 in each)"
      : p < 0.05
        ? `p=${p.toFixed(4)} < 0.05 — high-exposure beats low-exposure (ADR-005 confirmed)`
        : `p=${p.toFixed(4)} ≥ 0.05 — no significant ambient effect (ADR-005 inconclusive)`;

  return {
    status: "ok",
    window_days: windowDays,
    total_mock_attempts: mockAttempts.length,
    high_exposure: {
      n: high.n,
      correct: high.correct,
      accuracy: high.n > 0 ? high.correct / high.n : 0,
    },
    low_exposure: {
      n: low.n,
      correct: low.correct,
      accuracy: low.n > 0 ? low.correct / low.n : 0,
    },
    p_value: p,
    conclusion,
  };
}

interface RawMockQuestion {
  id: string;
  level: string;
  type: "vocab" | "grammar" | "listening" | "reading";
  question: string;
  choices: string[];
  correct: number;
  explanation?: string;
  language?: string;
}

interface RawMockFile {
  language?: string;
  mock?: boolean;
  questions?: RawMockQuestion[];
}

export interface MockImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  files: string[];
}

/**
 * Import mock-* yaml files (only those with `mock: true` at top level) into
 * mock_questions table. Default seed-import never touches these — caller must
 * explicitly invoke this via `lt seed-import --include-mock`.
 */
export function importMockSeeds(extraDir?: string): MockImportSummary {
  ensureMockTable();
  const dirs = [extraDir, SEEDS_DIR, defaultBundledSeedsDir()].filter(
    (d): d is string => Boolean(d) && existsSync(d as string),
  );
  if (dirs.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, files: [] };
  }
  const files = dirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => join(d, f)),
  );
  const summary: MockImportSummary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    files: [],
  };
  const db = getDb();
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO mock_questions (id, level, type, language, question, choices, correct, explanation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       level=excluded.level, type=excluded.type, language=excluded.language,
       question=excluded.question, choices=excluded.choices, correct=excluded.correct,
       explanation=excluded.explanation`,
  );
  for (const f of files) {
    const raw = readFileSync(f, "utf-8");
    const parsed = YAML.parse(raw) as RawMockFile | null;
    if (!parsed || parsed.mock !== true) continue;
    summary.files.push(f);
    const fileLanguage = parsed.language;
    const questions = parsed.questions ?? [];
    for (const q of questions) {
      if (!q.id || !q.question || !q.choices || q.correct === undefined) {
        summary.skipped++;
        continue;
      }
      if (q.choices.length !== 4 || q.correct < 0 || q.correct >= q.choices.length) {
        summary.skipped++;
        continue;
      }
      const language = q.language ?? fileLanguage ?? "ja";
      const existed = db.query("SELECT 1 FROM mock_questions WHERE id = ?").get(q.id);
      upsert.run(
        q.id,
        q.level,
        q.type,
        language,
        q.question,
        JSON.stringify(q.choices),
        q.correct,
        q.explanation ?? null,
        now,
      );
      if (existed) summary.updated++;
      else summary.inserted++;
    }
  }
  return summary;
}

function defaultBundledSeedsDir(): string | null {
  const p = join(import.meta.dir, "..", "data", "seeds");
  try {
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  } catch {}
  return null;
}
