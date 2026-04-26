import { existsSync, readFileSync, lstatSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { CONFIG_DIR, DB_FILE, PROFILE_FILE } from "./paths.ts";

export interface DoctorCheck {
  id: string;
  level: "ok" | "warn" | "error";
  msg: string;
  details?: unknown;
}

export interface DoctorReport {
  exit_code: 0 | 1 | 2;
  ok: number;
  warn: number;
  error: number;
  checks: DoctorCheck[];
}

interface DoctorEnv {
  homeDir?: string;
  cwd?: string;
}

function readJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function detectShape(arr: unknown): "empty" | "flat" | "nested" | "mixed" {
  if (!Array.isArray(arr) || arr.length === 0) return "empty";
  let flat = 0;
  let nested = 0;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (Array.isArray(e.hooks)) nested++;
    else if (typeof e.command === "string") flat++;
  }
  if (flat > 0 && nested > 0) return "mixed";
  if (flat > 0) return "flat";
  if (nested > 0) return "nested";
  return "empty";
}

function hasPolyglotHook(arr: unknown): boolean {
  if (!Array.isArray(arr)) return false;
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const flat = typeof e.command === "string" ? e.command : "";
    const nestedJoin = Array.isArray(e.hooks)
      ? (e.hooks as unknown[]).map((h) => {
          if (h && typeof h === "object" && typeof (h as Record<string, unknown>).command === "string") {
            return (h as Record<string, unknown>).command as string;
          }
          return "";
        }).join("\n")
      : "";
    if ((flat + nestedJoin).includes("polyglot-hooks")) return true;
  }
  return false;
}

function bunCheck(): DoctorCheck {
  const r = spawnSync("bun", ["--version"], { encoding: "utf-8" });
  if (r.status !== 0 || !r.stdout) {
    return { id: "bun", level: "error", msg: "bun is not on PATH" };
  }
  const version = r.stdout.trim();
  // accept any 1.x for Phase 1.0; tighten in Phase 1.2
  if (!/^1\.\d+\.\d+/.test(version)) {
    return { id: "bun", level: "warn", msg: `bun version ${version} is unusual; expected 1.x`, details: version };
  }
  return { id: "bun", level: "ok", msg: `bun ${version}` };
}

export function runDoctor(env: DoctorEnv = {}): DoctorReport {
  const home = env.homeDir ?? homedir();
  const cwd = env.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];

  // 1. ~/.local/bin/lt exists + executable
  const ltBin = join(home, ".local", "bin", "lt");
  if (!existsSync(ltBin)) {
    checks.push({ id: "lt_bin", level: "warn", msg: `~/.local/bin/lt not installed; run install.sh`, details: ltBin });
  } else {
    try {
      const mode = statSync(ltBin).mode & 0o111;
      if (mode === 0) {
        checks.push({ id: "lt_bin", level: "error", msg: `${ltBin} is not executable (chmod +x)` });
      } else {
        checks.push({ id: "lt_bin", level: "ok", msg: `lt binary at ${ltBin}` });
      }
    } catch (e) {
      checks.push({ id: "lt_bin", level: "warn", msg: `cannot stat ${ltBin}`, details: String(e) });
    }
  }

  // 2. bun version
  if (env.homeDir) {
    // skip in tests with synthetic HOME
  } else {
    checks.push(bunCheck());
  }

  // 3. ~/.config/polyglot/profile.yaml
  if (!existsSync(PROFILE_FILE)) {
    checks.push({ id: "profile", level: "warn", msg: `profile.yaml missing; run /lt-setup`, details: PROFILE_FILE });
  } else {
    checks.push({ id: "profile", level: "ok", msg: `profile.yaml present` });
  }

  // 4. ~/.config/polyglot/reviews.db
  if (!existsSync(DB_FILE)) {
    checks.push({ id: "db", level: "warn", msg: `reviews.db missing; will be created on first lt next/answer`, details: DB_FILE });
  } else {
    checks.push({ id: "db", level: "ok", msg: `reviews.db present` });
  }

  // 5. legacy ~/.config/jp-trainer should be a symlink (paths.ts migration done)
  const legacy = join(home, ".config", "jp-trainer");
  if (existsSync(legacy)) {
    try {
      const s = lstatSync(legacy);
      if (s.isSymbolicLink()) {
        checks.push({ id: "legacy_symlink", level: "ok", msg: `~/.config/jp-trainer is a symlink (migration done)` });
      } else {
        checks.push({ id: "legacy_symlink", level: "warn", msg: `~/.config/jp-trainer exists as a real directory; migration may have failed`, details: legacy });
      }
    } catch (e) {
      checks.push({ id: "legacy_symlink", level: "warn", msg: `cannot stat ${legacy}`, details: String(e) });
    }
  }

  // 6. ~/.claude/settings.json includes polyglot-hooks
  const userSettings = join(home, ".claude", "settings.json");
  const userJson = readJson(userSettings) as { hooks?: Record<string, unknown> } | null;
  const events = ["Stop", "UserPromptSubmit", "PostToolUse"];
  let userHookCount = 0;
  let userHookSchemaIssues = 0;
  for (const ev of events) {
    const arr = userJson?.hooks?.[ev];
    if (hasPolyglotHook(arr)) userHookCount++;
    const shape = detectShape(arr);
    if (shape === "mixed") userHookSchemaIssues++;
  }
  if (!userJson) {
    checks.push({ id: "user_settings", level: "warn", msg: `${userSettings} missing or unreadable` });
  } else if (userHookCount === 0) {
    checks.push({ id: "user_settings", level: "warn", msg: `no polyglot-hooks entries in ${userSettings}; run install.sh` });
  } else if (userHookSchemaIssues > 0) {
    checks.push({ id: "user_settings", level: "error", msg: `mixed flat+nested schema in ${userSettings} (${userHookSchemaIssues} events affected)` });
  } else {
    checks.push({ id: "user_settings", level: "ok", msg: `${userHookCount}/${events.length} polyglot-hooks events wired in user settings` });
  }

  // 7. cwd .claude/settings.json: if also has polyglot-hooks → double-trigger warn
  const projectSettings = join(cwd, ".claude", "settings.json");
  if (existsSync(projectSettings)) {
    const projectJson = readJson(projectSettings) as { hooks?: Record<string, unknown> } | null;
    let projectHookCount = 0;
    for (const ev of events) {
      if (hasPolyglotHook(projectJson?.hooks?.[ev])) projectHookCount++;
    }
    if (projectHookCount > 0 && userHookCount > 0) {
      checks.push({
        id: "double_trigger",
        level: "warn",
        msg: `polyglot-hooks present in both user-level and project-level settings — hooks will fire ${projectHookCount}x in this cwd. Remove duplicate entries.`,
        details: { project: projectSettings, project_count: projectHookCount, user_count: userHookCount },
      });
    } else if (projectHookCount > 0) {
      checks.push({ id: "double_trigger", level: "ok", msg: `polyglot-hooks only in project settings (${projectSettings})` });
    }
  }

  // 8. launchd plist for daily-push (best-effort — only on macOS)
  const dailyPlist = join(home, "Library", "LaunchAgents", "com.polyglot.daily.plist");
  if (existsSync(dailyPlist)) {
    checks.push({ id: "launchd_daily", level: "ok", msg: `daily-push plist present` });
  } else {
    checks.push({ id: "launchd_daily", level: "warn", msg: `daily-push plist missing — run lt install-cron if you want notifications` });
  }
  const backupPlist = join(home, "Library", "LaunchAgents", "com.polyglot.daily-backup.plist");
  if (existsSync(backupPlist)) {
    checks.push({ id: "launchd_backup", level: "ok", msg: `daily-backup plist present` });
  } else {
    checks.push({ id: "launchd_backup", level: "warn", msg: `daily-backup plist missing — run install.sh to register` });
  }

  let okCount = 0;
  let warnCount = 0;
  let errCount = 0;
  for (const c of checks) {
    if (c.level === "ok") okCount++;
    else if (c.level === "warn") warnCount++;
    else errCount++;
  }
  const exit_code: 0 | 1 | 2 = errCount > 0 ? 2 : warnCount > 0 ? 1 : 0;
  return { exit_code, ok: okCount, warn: warnCount, error: errCount, checks };
}

export function formatReport(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`lt doctor — ${r.checks.length} checks (${r.ok} ok, ${r.warn} warn, ${r.error} error)`);
  for (const c of r.checks) {
    const tag = c.level === "ok" ? "[ok]" : c.level === "warn" ? "[warn]" : "[err]";
    lines.push(`  ${tag} ${c.id}: ${c.msg}`);
  }
  if (r.exit_code === 0) lines.push("all clear ✓");
  else if (r.exit_code === 1) lines.push("review warnings above");
  else lines.push("critical issues — see [err] checks");
  return lines.join("\n");
}
