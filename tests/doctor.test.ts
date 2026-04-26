import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runDoctor, formatReport } from "../src/doctor.ts";

let tmpHome: string;
let tmpCwd: string;

beforeEach(() => {
  tmpHome = join(tmpdir(), `polyglot-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  tmpCwd = join(tmpHome, "cwd");
  mkdirSync(tmpHome, { recursive: true });
  mkdirSync(tmpCwd, { recursive: true });
});

afterEach(() => {
  if (tmpHome && existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true });
});

describe("runDoctor — happy path", () => {
  test("everything in place → ok-only", () => {
    // emulate full install state inside tmpHome:
    //   ~/.local/bin/lt (executable)
    //   ~/.config/polyglot/{profile.yaml, reviews.db}
    //   ~/.config/jp-trainer → symlink
    //   ~/.claude/settings.json with all 3 polyglot-hooks events
    //   ~/Library/LaunchAgents/com.polyglot.daily{,-backup}.plist
    mkdirSync(join(tmpHome, ".local", "bin"), { recursive: true });
    writeFileSync(join(tmpHome, ".local", "bin", "lt"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

    mkdirSync(join(tmpHome, ".config", "polyglot"), { recursive: true });
    writeFileSync(join(tmpHome, ".config", "polyglot", "profile.yaml"), "level: N3\n");
    writeFileSync(join(tmpHome, ".config", "polyglot", "reviews.db"), "");

    symlinkSync(join(tmpHome, ".config", "polyglot"), join(tmpHome, ".config", "jp-trainer"), "dir");

    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", hooks: [{ type: "command", command: "bash /x/.claude/polyglot-hooks/stop.sh" }] }],
          UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "bash /x/.claude/polyglot-hooks/user-prompt-submit.sh" }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "bash /x/.claude/polyglot-hooks/post-tool-use.sh" }] }],
        },
      }),
    );

    mkdirSync(join(tmpHome, "Library", "LaunchAgents"), { recursive: true });
    writeFileSync(join(tmpHome, "Library", "LaunchAgents", "com.polyglot.daily.plist"), "");
    writeFileSync(join(tmpHome, "Library", "LaunchAgents", "com.polyglot.daily-backup.plist"), "");

    // Note: paths.ts CONFIG_DIR is captured at import time and pointed at the
    // real user $HOME, so PROFILE_FILE/DB_FILE checks read the real user's
    // files (which on the dev machine after install also exist). That makes
    // those two assertions less meaningful here; we focus on the keys the
    // doctor explicitly drives off `env.homeDir`.
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    expect(r.error).toBe(0);
    // exit_code reflects worst-of all checks; with our env all paths-driven
    // checks are ok so the only possible warning would be from real-FS checks.
    expect(r.exit_code).toBeLessThanOrEqual(1);

    const ltBin = r.checks.find((c) => c.id === "lt_bin");
    expect(ltBin?.level).toBe("ok");
    const userSettings = r.checks.find((c) => c.id === "user_settings");
    expect(userSettings?.level).toBe("ok");
    const legacy = r.checks.find((c) => c.id === "legacy_symlink");
    expect(legacy?.level).toBe("ok");
    const launchdDaily = r.checks.find((c) => c.id === "launchd_daily");
    expect(launchdDaily?.level).toBe("ok");
  });
});

describe("runDoctor — failure modes", () => {
  test("missing lt binary → warn", () => {
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const ltBin = r.checks.find((c) => c.id === "lt_bin");
    expect(ltBin?.level).toBe("warn");
  });

  test("legacy ~/.config/jp-trainer is a real dir → warn (migration not done)", () => {
    mkdirSync(join(tmpHome, ".config", "jp-trainer"), { recursive: true });
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const legacy = r.checks.find((c) => c.id === "legacy_symlink");
    expect(legacy?.level).toBe("warn");
  });

  test("user settings.json missing → warn user_settings", () => {
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const userSettings = r.checks.find((c) => c.id === "user_settings");
    expect(userSettings?.level).toBe("warn");
    expect(r.exit_code).toBeGreaterThanOrEqual(1);
  });

  test("user settings.json has mixed flat+nested schema → error", () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [
            { matcher: "*", command: "bash /x/.claude/polyglot-hooks/stop.sh" },
            { matcher: "*", hooks: [{ type: "command", command: "bash /x/other-hooks/stop.sh" }] },
          ],
        },
      }),
    );
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const userSettings = r.checks.find((c) => c.id === "user_settings");
    expect(userSettings?.level).toBe("error");
    expect(r.exit_code).toBe(2);
  });

  test("double-trigger: project + user both have polyglot-hooks → warn", () => {
    mkdirSync(join(tmpHome, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpHome, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", command: "bash ~/.claude/polyglot-hooks/stop.sh" }],
        },
      }),
    );
    mkdirSync(join(tmpCwd, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpCwd, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", command: "bash ./.claude/polyglot-hooks/stop.sh" }],
        },
      }),
    );
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const dbl = r.checks.find((c) => c.id === "double_trigger");
    expect(dbl?.level).toBe("warn");
    expect(r.exit_code).toBeGreaterThanOrEqual(1);
  });

  test("project-only polyglot-hooks (no user) → ok double_trigger note", () => {
    // user settings missing entirely
    mkdirSync(join(tmpCwd, ".claude"), { recursive: true });
    writeFileSync(
      join(tmpCwd, ".claude", "settings.json"),
      JSON.stringify({
        hooks: {
          Stop: [{ matcher: "*", command: "bash ./.claude/polyglot-hooks/stop.sh" }],
        },
      }),
    );
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const dbl = r.checks.find((c) => c.id === "double_trigger");
    expect(dbl?.level).toBe("ok");
  });
});

describe("formatReport rendering", () => {
  test("renders header + per-check lines + footer", () => {
    const r = runDoctor({ homeDir: tmpHome, cwd: tmpCwd });
    const txt = formatReport(r);
    expect(txt).toContain("lt doctor —");
    expect(txt).toMatch(/\[(ok|warn|err)\]/);
  });
});
