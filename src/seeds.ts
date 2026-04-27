import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { getDb } from "./db.ts";
import { SEEDS_DIR } from "./paths.ts";

interface RawSeed {
  id: string;
  type: "vocab" | "grammar" | "kanji" | "expression";
  level: string;
  ja: string;
  reading?: string;
  zh: string;
  examples?: { ja: string; zh: string }[];
  tags?: string[];
  pos?: string;
  language?: string;
}

interface RawSeedFile {
  language?: string;
  concepts?: RawSeed[];
}

export interface ImportSummary {
  inserted: number;
  updated: number;
  skipped: number;
  files: string[];
}

export function importSeeds(extraDir?: string): ImportSummary {
  const dirs = [extraDir, SEEDS_DIR, defaultBundledSeedsDir()].filter((d): d is string => Boolean(d) && existsSync(d as string));
  if (dirs.length === 0) {
    return { inserted: 0, updated: 0, skipped: 0, files: [] };
  }
  const files = dirs.flatMap((d) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => join(d, f)),
  );
  const summary: ImportSummary = { inserted: 0, updated: 0, skipped: 0, files };
  const db = getDb();
  const now = Date.now();
  const upsert = db.prepare(
    `INSERT INTO concepts (id, type, level, ja, reading, zh, examples, tags, pos, created_at, language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, level=excluded.level, ja=excluded.ja, reading=excluded.reading,
       zh=excluded.zh, examples=excluded.examples, tags=excluded.tags, pos=excluded.pos,
       language=excluded.language`,
  );

  for (const f of files) {
    const raw = readFileSync(f, "utf-8");
    const parsed = YAML.parse(raw) as RawSeedFile | RawSeed[] | null;
    const fileLanguage = !Array.isArray(parsed) ? parsed?.language : undefined;
    const seeds: RawSeed[] = Array.isArray(parsed) ? parsed : (parsed?.concepts ?? []);
    for (const s of seeds) {
      if (!s.id || !s.ja || !s.zh) {
        summary.skipped++;
        continue;
      }
      const existed = db.query("SELECT 1 FROM concepts WHERE id = ?").get(s.id);
      const language = s.language ?? fileLanguage ?? "ja";
      upsert.run(
        s.id,
        s.type,
        s.level,
        s.ja,
        s.reading ?? null,
        s.zh,
        s.examples ? JSON.stringify(s.examples) : null,
        s.tags ? JSON.stringify(s.tags) : null,
        s.pos ?? null,
        now,
        language,
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
