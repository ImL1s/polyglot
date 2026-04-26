import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_DIR, DB_FILE } from "./paths.ts";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(dirname(DB_FILE))) mkdirSync(dirname(DB_FILE), { recursive: true });
  _db = new Database(DB_FILE);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  migrate(_db);
  return _db;
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concepts (
      id           TEXT PRIMARY KEY,
      type         TEXT NOT NULL,
      level        TEXT NOT NULL,
      ja           TEXT NOT NULL,
      reading      TEXT,
      zh           TEXT NOT NULL,
      examples     TEXT,
      tags         TEXT,
      pos          TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      concept_id     TEXT PRIMARY KEY REFERENCES concepts(id),
      due_at         INTEGER NOT NULL,
      stability      REAL NOT NULL,
      difficulty     REAL NOT NULL,
      elapsed_days   REAL NOT NULL DEFAULT 0,
      scheduled_days REAL NOT NULL DEFAULT 0,
      reps           INTEGER NOT NULL DEFAULT 0,
      lapses         INTEGER NOT NULL DEFAULT 0,
      state          INTEGER NOT NULL DEFAULT 0,
      last_review    INTEGER
    );

    CREATE TABLE IF NOT EXISTS attempts (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      concept_id   TEXT NOT NULL REFERENCES concepts(id),
      rating       INTEGER NOT NULL,
      user_answer  TEXT,
      llm_feedback TEXT,
      source       TEXT,
      created_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_due ON reviews(due_at);
    CREATE INDEX IF NOT EXISTS idx_attempts_concept ON attempts(concept_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_concepts_level_type ON concepts(level, type);
  `);
}

export interface ConceptRow {
  id: string;
  type: string;
  level: string;
  ja: string;
  reading: string | null;
  zh: string;
  examples: string | null;
  tags: string | null;
  pos: string | null;
  created_at: number;
}

export interface ReviewRow {
  concept_id: string;
  due_at: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: number | null;
}

export interface ConceptOut {
  id: string;
  type: string;
  level: string;
  ja: string;
  reading: string | null;
  zh: string;
  examples: { ja: string; zh: string }[];
  tags: string[];
  pos: string | null;
}

export function rowToConcept(r: ConceptRow): ConceptOut {
  return {
    id: r.id,
    type: r.type,
    level: r.level,
    ja: r.ja,
    reading: r.reading,
    zh: r.zh,
    examples: r.examples ? JSON.parse(r.examples) : [],
    tags: r.tags ? JSON.parse(r.tags) : [],
    pos: r.pos,
  };
}
