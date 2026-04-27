import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import { CONFIG_DIR, PROFILE_FILE, LOG_FILE } from "./paths.ts";

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type WeakArea = "vocab" | "grammar" | "kanji" | "listening" | "speaking";

// Per-language progression bucket. level/target are open strings since each
// language uses its own scale (JLPT N5-N1 for ja, TOPIK 1-6 for ko, etc.).
export interface PerLanguage {
  level: string;
  target: string;
  weak_areas: WeakArea[];
}

export interface Profile {
  version: number;
  level: JlptLevel;
  target: JlptLevel;
  weak_areas: WeakArea[];
  work_hours: string;        // "HH:MM-HH:MM"
  work_days: string[];       // ["Mon", "Tue", ...]
  inject_rate: number;
  post_tool_inject: boolean;
  post_tool_min_duration_ms: number;
  post_tool_inject_rate: number;
  cn_probe_rate: number;
  daily_cron: string;        // "HH:MM" or ""
  daily_new_count: number;
  notification_channel: "macos" | "telegram" | "none";
  // Adjustment F (v1) — limits + DND
  inject_max_per_hour: number;
  inject_max_per_session: number;
  do_not_disturb_until: number | null;   // ms timestamp
  respect_work_hours: boolean;
  // v3 D19g — immersion as continuous level (replaces v1 boolean immersion_default)
  immersion_level: number;
  // Phase 1.2 placeholder — TTS engine selector
  tts_engine: string;
  // Phase 1.1a — active_language gate (which language is currently being studied)
  active_language: string;
  // Phase 1.1a (D12) — per-language progression. Top-level level/target are
  // retained as v1 mirror of per_language[active_language] for back-compat.
  per_language: Record<string, PerLanguage>;
}

export const DEFAULT_PROFILE: Profile = {
  version: 1,
  level: "N3",
  target: "N2",
  weak_areas: ["grammar", "kanji"],
  work_hours: "09:00-19:00",
  work_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  inject_rate: 0.15,
  post_tool_inject: true,
  post_tool_min_duration_ms: 5000,
  post_tool_inject_rate: 0.3,
  cn_probe_rate: 0.05,
  daily_cron: "09:00",
  daily_new_count: 5,
  notification_channel: "macos",
  inject_max_per_hour: 3,
  inject_max_per_session: 10,
  do_not_disturb_until: null,
  respect_work_hours: true,
  immersion_level: 0,
  tts_engine: "macos",
  active_language: "ja",
  per_language: {
    ja: { level: "N3", target: "N2", weak_areas: ["grammar", "kanji"] },
  },
};

// Languages we ship seeds and progression scales for. Order is significant —
// `lt language list` displays them in this order with active marked.
export const SUPPORTED_LANGUAGES: readonly string[] = ["ja", "ko"] as const;

export function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
}

function logProfileEvent(event: Record<string, unknown>): void {
  try {
    if (!existsSync(dirname(LOG_FILE))) mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", "utf-8");
  } catch {
    // logging is best-effort; never fail the read on log write error
  }
}

interface RawProfile extends Partial<Profile> {
  immersion_default?: boolean;
}

export interface MigrationEvent {
  event: string;
  from?: string;
  to?: string;
  value?: unknown;
  language?: string;
}

export interface MigrationResult {
  profile: Profile;
  events: MigrationEvent[];
}

// Pure migration: takes the raw parsed YAML object, applies legacy field
// rewrites (v1 immersion_default → immersion_level, v1 top-level
// level/target/weak_areas → per_language), and returns the merged profile +
// the events emitted. Side effects (logging, persistence) are the caller's
// responsibility.
export function migrateProfile(raw: RawProfile, defaults: Profile = DEFAULT_PROFILE): MigrationResult {
  const events: MigrationEvent[] = [];
  const working: RawProfile = { ...raw };

  // Legacy v1 boolean immersion_default → continuous immersion_level (v3 D19g)
  if ("immersion_default" in working && working.immersion_default !== undefined) {
    if (working.immersion_level === undefined) {
      working.immersion_level = working.immersion_default ? 1.0 : 0;
      events.push({
        event: "profile_legacy_migrated",
        from: "immersion_default",
        to: "immersion_level",
        value: working.immersion_level,
      });
    }
    delete working.immersion_default;
  }

  // v1 → v2 (D12): if raw has top-level level but no per_language, populate
  // per_language[active_language] from the v1 fields.
  const activeLang = working.active_language ?? defaults.active_language;
  if (working.level !== undefined && working.per_language === undefined) {
    working.per_language = {
      [activeLang]: {
        level: working.level,
        target: working.target ?? working.level,
        weak_areas: working.weak_areas ?? [],
      },
    };
    events.push({
      event: "profile_legacy_migrated",
      from: "v1_level_target_weak_areas",
      to: "per_language",
      language: activeLang,
    });
  }

  const merged: Profile = {
    ...defaults,
    ...working,
    per_language: {
      ...defaults.per_language,
      ...(working.per_language ?? {}),
    },
  };
  return { profile: merged, events };
}

export function readProfile(): Profile {
  ensureConfigDir();
  if (!existsSync(PROFILE_FILE)) {
    writeProfile(DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
  }
  const raw = readFileSync(PROFILE_FILE, "utf-8");
  const parsed = YAML.parse(raw) as RawProfile;
  const { profile, events } = migrateProfile(parsed);
  if (events.length > 0) {
    for (const e of events) logProfileEvent(e);
    // persist the migrated form so legacy fields never reappear
    writeProfile(profile);
  }
  return profile;
}

export function writeProfile(p: Profile): void {
  ensureConfigDir();
  if (!existsSync(dirname(PROFILE_FILE))) mkdirSync(dirname(PROFILE_FILE), { recursive: true });
  writeFileSync(PROFILE_FILE, YAML.stringify(p), "utf-8");
}

export function patchProfile(patch: Partial<Profile>): Profile {
  const cur = readProfile();
  const next = { ...cur, ...patch };
  writeProfile(next);
  return next;
}

const LEVEL_RANK: Record<JlptLevel, number> = { N5: 1, N4: 2, N3: 3, N2: 4, N1: 5 };

export function levelsAtOrBelow(level: JlptLevel): JlptLevel[] {
  const rank = LEVEL_RANK[level];
  return (Object.keys(LEVEL_RANK) as JlptLevel[]).filter((l) => LEVEL_RANK[l] <= rank);
}

export function levelsInLearningRange(p: Profile): JlptLevel[] {
  const targetRank = LEVEL_RANK[p.target];
  const minRank = Math.max(1, LEVEL_RANK[p.level] - 1);
  return (Object.keys(LEVEL_RANK) as JlptLevel[]).filter((l) => {
    const r = LEVEL_RANK[l];
    return r >= minRank && r <= targetRank;
  });
}
