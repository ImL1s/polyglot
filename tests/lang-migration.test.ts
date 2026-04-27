import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrateProfile, DEFAULT_PROFILE, type Profile } from "../src/profile.ts";

describe("migrateProfile (pure)", () => {
  test("v1 raw with top-level level + no per_language → backfills per_language[active_language]", () => {
    const raw = {
      version: 1,
      level: "N3",
      target: "N2",
      weak_areas: ["grammar"],
      active_language: "ja",
    };
    const { profile, events } = migrateProfile(raw as Partial<Profile>);
    expect(profile.per_language.ja).toEqual({ level: "N3", target: "N2", weak_areas: ["grammar"] });
    expect(events.some((e) => e.from === "v1_level_target_weak_areas")).toBe(true);
  });

  test("legacy boolean immersion_default=true → immersion_level 1.0", () => {
    const raw = { level: "N3", immersion_default: true } as unknown as Partial<Profile>;
    const { profile, events } = migrateProfile(raw);
    expect(profile.immersion_level).toBe(1.0);
    expect(events.some((e) => e.from === "immersion_default")).toBe(true);
  });

  test("legacy boolean immersion_default=false → immersion_level 0", () => {
    const raw = { level: "N3", immersion_default: false } as unknown as Partial<Profile>;
    const { profile } = migrateProfile(raw);
    expect(profile.immersion_level).toBe(0);
  });

  test("already-migrated profile (per_language present) → no migration events", () => {
    const raw: Partial<Profile> = {
      version: 1,
      level: "N3",
      target: "N2",
      weak_areas: ["grammar"],
      active_language: "ja",
      per_language: {
        ja: { level: "N3", target: "N2", weak_areas: ["grammar"] },
        ko: { level: "TOPIK1", target: "TOPIK2", weak_areas: ["vocab"] },
      },
    };
    const { profile, events } = migrateProfile(raw);
    expect(events).toEqual([]);
    expect(profile.per_language.ko.level).toBe("TOPIK1");
  });

  test("uses raw active_language to bucket the v1 fields", () => {
    const raw = {
      level: "TOPIK2",
      target: "TOPIK3",
      weak_areas: ["listening"],
      active_language: "ko",
    } as unknown as Partial<Profile>;
    const { profile } = migrateProfile(raw);
    expect(profile.per_language.ko).toEqual({
      level: "TOPIK2",
      target: "TOPIK3",
      weak_areas: ["listening"],
    });
  });

  test("merges defaults so missing fields get sane values", () => {
    const raw = { level: "N4" } as Partial<Profile>;
    const { profile } = migrateProfile(raw);
    expect(profile.inject_rate).toBe(DEFAULT_PROFILE.inject_rate);
    expect(profile.active_language).toBe(DEFAULT_PROFILE.active_language);
  });

  test("does not lose user per_language when raw also has v1 top-level fields", () => {
    const raw: Partial<Profile> = {
      level: "N3",
      target: "N2",
      weak_areas: ["grammar"],
      active_language: "ja",
      per_language: {
        ko: { level: "TOPIK2", target: "TOPIK3", weak_areas: [] },
      },
    };
    const { profile } = migrateProfile(raw);
    // ko comes from raw; ja comes from defaults (since per_language was already set,
    // the v1-mirror path is skipped — defaults still seed ja so it's not lost).
    expect(profile.per_language.ko.level).toBe("TOPIK2");
    expect(profile.per_language.ja).toBeDefined();
  });
});

describe("concepts language filter (real DB)", () => {
  let tmp: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "polyglot-lang-"));
    originalEnv = process.env.HOME;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.HOME;
    else process.env.HOME = originalEnv;
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // Verify the migration adds the language column with default 'ja' to a v1
  // (pre-language) DB and backfills existing rows.
  test("ALTER TABLE adds language column to legacy v1 DB and defaults to 'ja'", async () => {
    const dbPath = join(tmp, "legacy.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE concepts (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, level TEXT NOT NULL,
        ja TEXT NOT NULL, reading TEXT, zh TEXT NOT NULL, examples TEXT,
        tags TEXT, pos TEXT, created_at INTEGER NOT NULL
      );
    `);
    legacy.exec(
      "INSERT INTO concepts (id, type, level, ja, reading, zh, created_at) VALUES " +
        "('legacy-1', 'vocab', 'N3', '日本', 'にほん', '日本', 1);",
    );
    legacy.close();

    // Re-open and run the same migration step the production migrate() runs.
    const db = new Database(dbPath);
    const cols = db.query("PRAGMA table_info(concepts)").all() as { name: string }[];
    expect(cols.some((c) => c.name === "language")).toBe(false);
    db.exec("ALTER TABLE concepts ADD COLUMN language TEXT NOT NULL DEFAULT 'ja'");
    db.exec("UPDATE concepts SET language = 'ja' WHERE language IS NULL OR language = ''");

    const row = db.query("SELECT language FROM concepts WHERE id = 'legacy-1'").get() as { language: string };
    expect(row.language).toBe("ja");
    db.close();
  });
});
