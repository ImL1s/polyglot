import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import YAML from "yaml";
import { CONFIG_DIR, PROFILE_FILE, LOG_FILE } from "./paths.ts";

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";
export type WeakArea = "vocab" | "grammar" | "kanji" | "listening" | "speaking";

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
  // Phase 1.1a placeholder — active_language gate
  active_language: string;
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
};

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

function migrateLegacyFields(raw: RawProfile): { migrated: Partial<Profile>; didMigrate: boolean } {
  const migrated: Partial<Profile> = { ...raw };
  let didMigrate = false;
  // Legacy v1 boolean immersion_default → continuous immersion_level (v3 D19g)
  if ("immersion_default" in raw && raw.immersion_default !== undefined) {
    if (migrated.immersion_level === undefined) {
      migrated.immersion_level = raw.immersion_default ? 1.0 : 0;
      didMigrate = true;
    }
    delete (migrated as RawProfile).immersion_default;
  }
  return { migrated, didMigrate };
}

export function readProfile(): Profile {
  ensureConfigDir();
  if (!existsSync(PROFILE_FILE)) {
    writeProfile(DEFAULT_PROFILE);
    return { ...DEFAULT_PROFILE };
  }
  const raw = readFileSync(PROFILE_FILE, "utf-8");
  const parsed = YAML.parse(raw) as RawProfile;
  const { migrated, didMigrate } = migrateLegacyFields(parsed);
  const merged = { ...DEFAULT_PROFILE, ...migrated };
  if (didMigrate) {
    logProfileEvent({
      event: "profile_legacy_migrated",
      from: "immersion_default",
      to: "immersion_level",
      value: merged.immersion_level,
    });
    // persist the migrated form so the legacy field never reappears
    writeProfile(merged);
  }
  return merged;
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
