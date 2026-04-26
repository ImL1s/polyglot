import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  appendFileSync,
} from "node:fs";

function logEvent(dir: string, event: Record<string, unknown>) {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "lt.log"), JSON.stringify(event) + "\n", "utf-8");
  } catch {
    // logging is best-effort; never fail the migration on log write error
  }
}

function isRealDir(p: string): boolean {
  try {
    const s = lstatSync(p);
    return s.isDirectory() && !s.isSymbolicLink();
  } catch {
    return false;
  }
}

export function resolveConfigDir(home: string = homedir()): string {
  const newDir = join(home, ".config", "polyglot");
  const oldDir = join(home, ".config", "jp-trainer");

  // Case 1: new dir already present → done. Old dir, if any, stays untouched.
  if (existsSync(newDir)) return newDir;

  // Case 2: only old real dir present → migrate atomically + leave symlink behind.
  if (isRealDir(oldDir)) {
    const parent = join(home, ".config");
    try {
      if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
      renameSync(oldDir, newDir);
      try {
        symlinkSync(newDir, oldDir, "dir");
      } catch {
        // symlink failure is non-fatal — migration succeeded
      }
      logEvent(newDir, {
        event: "config_dir_migrated",
        from: oldDir,
        to: newDir,
        ts: Date.now(),
      });
      return newDir;
    } catch (err) {
      logEvent(existsSync(oldDir) ? oldDir : home, {
        event: "config_dir_migrate_failed",
        from: oldDir,
        to: newDir,
        error: err instanceof Error ? err.message : String(err),
        ts: Date.now(),
      });
      // Fall back to old path so the user keeps working; manual fix later.
      return oldDir;
    }
  }

  // Case 3: stale symlink at old path or neither exists → create new dir.
  if (!existsSync(newDir)) mkdirSync(newDir, { recursive: true });
  return newDir;
}

export const CONFIG_DIR = resolveConfigDir();
export const PROFILE_FILE = join(CONFIG_DIR, "profile.yaml");
export const DB_FILE = join(CONFIG_DIR, "reviews.db");
export const IMMERSION_FLAG = join(CONFIG_DIR, "immersion.flag");
export const SEEDS_DIR = join(CONFIG_DIR, "seeds");
export const SESSION_TRACK_DIR = join(CONFIG_DIR, "sessions");
export const LOG_FILE = join(CONFIG_DIR, "lt.log");
