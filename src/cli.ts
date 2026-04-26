#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, copyFileSync, renameSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Database } from "bun:sqlite";

import { CONFIG_DIR, IMMERSION_FLAG, LOG_FILE, DB_FILE } from "./paths.ts";
import { runDoctor, formatReport } from "./doctor.ts";
import { readProfile, writeProfile, patchProfile, DEFAULT_PROFILE, type Profile } from "./profile.ts";
import { recordAnswer } from "./srs.ts";
import { getNextDue, dueCount, getStats, listDueConcepts } from "./concepts.ts";
import { importSeeds } from "./seeds.ts";
import { isWithinWorkHours } from "./work-hours.ts";

const program = new Command();
program
  .name("lt")
  .description("AI-native polyglot trainer (Claude Code / Codex / Gemini)")
  .version("polyglot 0.1.0");

program
  .command("setup")
  .description("Write default profile.yaml if missing; prefer running /jp-setup in Claude Code for interactive setup")
  .option("--force", "overwrite existing profile with defaults")
  .action((opts) => {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    if (existsSync(join(CONFIG_DIR, "profile.yaml")) && !opts.force) {
      console.log("profile.yaml already exists. Use --force to overwrite.");
      return;
    }
    writeProfile(DEFAULT_PROFILE);
    console.log(`profile written to ${join(CONFIG_DIR, "profile.yaml")}`);
    console.log("Run /jp-setup in Claude Code for the interactive onboarding.");
  });

program
  .command("next")
  .description("Pick the next concept to practice")
  .option("--json", "output JSON")
  .option("--quiet", "suppress error output if nothing due")
  .option("--type <type>", "vocab | grammar | kanji | expression")
  .option("--level <level>", "N5 | N4 | N3 | N2 | N1")
  .option("--difficulty <d>", "easy | hard")
  .action((opts) => {
    const concept = getNextDue({
      type: opts.type,
      level: opts.level,
      difficulty: opts.difficulty,
    });
    if (!concept) {
      if (!opts.quiet) console.error("No concepts due and daily new quota reached");
      process.exit(opts.quiet ? 0 : 2);
    }
    if (opts.json) {
      console.log(JSON.stringify(concept));
    } else {
      console.log(`[${concept.level}/${concept.type}] ${concept.ja} ${concept.reading ? `(${concept.reading})` : ""} — ${concept.zh}`);
      if (concept.examples.length) {
        console.log(`  例：${concept.examples[0].ja}\n      ${concept.examples[0].zh}`);
      }
      console.log(`(id: ${concept.id})`);
    }
  });

program
  .command("answer")
  .description("Record an answer and update FSRS schedule")
  .requiredOption("--concept-id <id>", "concept id")
  .requiredOption("--rating <r>", "1=Again 2=Hard 3=Good 4=Easy", parseInt)
  .option("--user-answer <text>", "what the user said")
  .option("--feedback <text>", "LLM feedback")
  .option("--source <s>", "manual | stop-hook | post-tool | cron | review", "manual")
  .action((opts) => {
    if (![1, 2, 3, 4].includes(opts.rating)) {
      console.error("rating must be 1-4");
      process.exit(2);
    }
    const result = recordAnswer({
      conceptId: opts.conceptId,
      rating: opts.rating,
      userAnswer: opts.userAnswer,
      llmFeedback: opts.feedback,
      source: opts.source,
    });
    const due = new Date(result.nextDueAt);
    console.log(JSON.stringify({
      ok: true,
      next_due_at: due.toISOString(),
      stability: result.card.stability.toFixed(2),
      difficulty: result.card.difficulty.toFixed(2),
    }));
  });

program
  .command("review")
  .description("List concepts due now (default 20)")
  .option("--json", "JSON output")
  .option("--limit <n>", "max concepts", (v) => parseInt(v, 10), 20)
  .action((opts) => {
    const list = listDueConcepts(opts.limit);
    if (opts.json) {
      console.log(JSON.stringify(list));
      return;
    }
    if (list.length === 0) {
      console.log("Nothing due. ✨");
      return;
    }
    console.log(`Due: ${list.length}`);
    for (const c of list) {
      console.log(`  [${c.level}/${c.type}] ${c.ja} (${c.reading ?? ""}) — ${c.zh}`);
    }
  });

program
  .command("due-count")
  .description("Print number of concepts due now")
  .action(() => {
    console.log(dueCount());
  });

program
  .command("stats")
  .description("Show progress")
  .option("--json", "JSON output")
  .action((opts) => {
    const s = getStats();
    if (opts.json) {
      console.log(JSON.stringify(s));
      return;
    }
    console.log(`Total concepts: ${s.total_concepts}`);
    console.log(`Introduced: ${s.introduced}`);
    console.log(`Due now: ${s.due_now}`);
    console.log(`Today: ${s.today_attempts} attempts, ${s.today_correct} correct (${(s.today_accuracy * 100).toFixed(0)}%)`);
    console.log("By level:");
    for (const r of s.by_level) {
      console.log(`  ${r.level}: ${r.introduced}/${r.n}`);
    }
  });

program
  .command("config")
  .description("Read/update profile fields. Format: key=value (multiple allowed)")
  .argument("[fields...]", "key=value pairs")
  .option("--show", "print current profile")
  .action((fields: string[], opts) => {
    if (opts.show || fields.length === 0) {
      console.log(JSON.stringify(readProfile(), null, 2));
      return;
    }
    const patch: Partial<Profile> = {};
    for (const kv of fields) {
      const [k, ...rest] = kv.split("=");
      const v = rest.join("=");
      if (!k || v === undefined) {
        console.error(`bad format: ${kv}`);
        process.exit(2);
      }
      (patch as Record<string, unknown>)[k.trim()] = parseValue(v);
    }
    const next = patchProfile(patch);
    console.log(JSON.stringify(next, null, 2));
  });

function parseValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
  }
  return v;
}

program
  .command("immersion")
  .description("toggle immersion mode flag")
  .argument("<state>", "on | off | toggle | status")
  .action((state: string) => {
    const exists = existsSync(IMMERSION_FLAG);
    if (state === "status") {
      console.log(exists ? "on" : "off");
      return;
    }
    const wantOn = state === "on" || (state === "toggle" && !exists);
    if (wantOn) {
      if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(IMMERSION_FLAG, String(Date.now()), "utf-8");
      console.log("immersion: on");
    } else {
      if (exists) unlinkSync(IMMERSION_FLAG);
      console.log("immersion: off");
    }
  });

program
  .command("inject-decide")
  .description("Probabilistic decision for hooks. Exits 0 if should inject, 1 otherwise")
  .option("--rate <r>", "probability override (0-1)", parseFloat)
  .option("--respect-work-hours", "only inject within profile.work_hours", false)
  .action((opts) => {
    const profile = readProfile();
    const rate = opts.rate ?? profile.inject_rate;
    if (opts.respectWorkHours && !isWithinWorkHours(profile)) {
      process.exit(1);
    }
    process.exit(Math.random() < rate ? 0 : 1);
  });

program
  .command("detect-cn")
  .description("Detect a meaningful Chinese line in stdin or --text. Exits 0 if probe should fire.")
  .option("--text <text>")
  .option("--probe-rate <r>", "override profile.cn_probe_rate", parseFloat)
  .action(async (opts) => {
    const profile = readProfile();
    const rate = opts.probeRate ?? profile.cn_probe_rate;
    const text = opts.text ?? (await readStdin());
    const cnRegex = /[一-鿿]/;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length >= 5 && cnRegex.test(l));
    if (lines.length === 0) process.exit(1);
    if (Math.random() >= rate) process.exit(1);
    console.log(lines[0]);
    process.exit(0);
  });

program
  .command("seed-import")
  .description("Import seed concepts from data/seeds and ~/.config/polyglot/seeds")
  .option("--dir <dir>", "additional dir to scan")
  .action((opts) => {
    const summary = importSeeds(opts.dir);
    console.log(JSON.stringify(summary, null, 2));
  });

program
  .command("daily-push")
  .description("Trigger daily notification (called from launchd)")
  .action(() => {
    const profile = readProfile();
    if (!isWithinWorkHours(profile)) {
      console.log("Outside work hours, skip");
      return;
    }
    const due = dueCount();
    const msg = due > 0
      ? `今日 ${due} 题待复习。打开 Claude Code 输入 /jp 开始`
      : `今日没有待复习。/jp 抽一道新题保持手感`;
    if (profile.notification_channel === "macos") {
      Bun.spawn(["osascript", "-e", `display notification "${msg}" with title "polyglot" sound name "Glass"`]);
    }
    console.log(msg);
  });

export function renderPlist(template: string, vars: { LT_BIN: string; HOUR: number; MINUTE: number }): string {
  return template
    .replaceAll("${LT_BIN}", vars.LT_BIN)
    .replaceAll("${HOUR}", String(vars.HOUR))
    .replaceAll("${MINUTE}", String(vars.MINUTE));
}

export function findPlistTemplate(): string {
  const candidates = [
    join(import.meta.dir, "..", "templates", "com.polyglot.daily.plist"),
    join(dirname(process.execPath), "..", "templates", "com.polyglot.daily.plist"),
    join(homedir(), ".local", "share", "polyglot", "templates", "com.polyglot.daily.plist"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(`plist template not found, looked in:\n  ${candidates.join("\n  ")}`);
}

program
  .command("install-cron")
  .description("Install macOS launchd plist based on profile.daily_cron")
  .action(async () => {
    const profile = readProfile();
    if (!profile.daily_cron) {
      console.log("daily_cron empty in profile, nothing to install");
      return;
    }
    const [hh, mm] = profile.daily_cron.split(":").map((s) => parseInt(s, 10));
    const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
    const plistPath = join(launchAgentsDir, "com.polyglot.daily.plist");
    const oldPlistPath = join(launchAgentsDir, "com.jp-trainer.daily.plist");
    const binPath = join(homedir(), ".local", "bin", "lt");

    if (!existsSync(launchAgentsDir)) {
      mkdirSync(launchAgentsDir, { recursive: true });
    }

    if (existsSync(oldPlistPath)) {
      try {
        await Bun.spawn(["launchctl", "unload", oldPlistPath]).exited;
      } catch {
        // best-effort; old plist might already be unloaded
      }
      try {
        unlinkSync(oldPlistPath);
      } catch {
        // best-effort
      }
      try {
        appendFileSync(
          LOG_FILE,
          JSON.stringify({ event: "old_plist_migrated", from: oldPlistPath, to: plistPath, ts: Date.now() }) + "\n",
          "utf-8",
        );
      } catch {
        // best-effort logging
      }
    }

    const templatePath = findPlistTemplate();
    const template = readFileSync(templatePath, "utf-8");
    const plist = renderPlist(template, { LT_BIN: binPath, HOUR: hh, MINUTE: mm });
    writeFileSync(plistPath, plist, "utf-8");
    await Bun.spawn(["launchctl", "unload", plistPath]).exited;
    await Bun.spawn(["launchctl", "load", "-w", plistPath]).exited;
    console.log(`installed: ${plistPath} @ ${profile.daily_cron}`);
  });

program
  .command("logs")
  .description("Tail NDJSON events from lt.log, optionally filtered by event name")
  .option("--tail <n>", "show last N matching lines", (v) => parseInt(v, 10), 20)
  .option("--event <name>", "filter by event field")
  .action((opts) => {
    if (!existsSync(LOG_FILE)) return;
    const lines = readFileSync(LOG_FILE, "utf-8").split(/\r?\n/).filter((l) => l.trim().length > 0);
    const filtered = opts.event
      ? lines.filter((l) => {
          try {
            const o = JSON.parse(l);
            return o && o.event === opts.event;
          } catch {
            return false;
          }
        })
      : lines;
    const tail = filtered.slice(-Math.max(0, opts.tail));
    for (const l of tail) console.log(l);
  });

program
  .command("restore")
  .description("Restore reviews.db from a backup created by scripts/daily-backup.sh")
  .requiredOption("--from <ref>", "weekday (Mon..Sun) or absolute backup file path")
  .action((opts) => {
    const backupDir = join(CONFIG_DIR, "backup");
    const ref: string = opts.from;
    let src = ref;
    if (!ref.includes("/")) src = join(backupDir, `reviews.db.bak.${ref}`);
    if (!existsSync(src)) {
      console.error(`backup not found: ${src}`);
      process.exit(2);
    }
    const tmp = `${DB_FILE}.tmp`;
    if (existsSync(tmp)) unlinkSync(tmp);
    copyFileSync(src, tmp);

    // verify the snapshot opens and has the expected schema. We open RW (not
    // readonly) because bun:sqlite readonly mode can't create the auxiliary
    // -shm file SQLite needs for journal_mode=WAL recovery, even if we never
    // intend to write. The file will be renamed-into-place on success anyway.
    try {
      const db = new Database(tmp);
      db.query("SELECT 1 FROM reviews LIMIT 1").all();
      db.query("SELECT 1 FROM attempts LIMIT 1").all();
      db.query("SELECT 1 FROM concepts LIMIT 1").all();
      db.close();
    } catch (err) {
      try { unlinkSync(tmp); } catch {}
      console.error(`backup verification failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }

    renameSync(tmp, DB_FILE);
    // .backup output is a self-contained DB; drop any stale WAL/SHM left over
    // from the previous live database so the next open doesn't replay them.
    for (const sidecar of [`${DB_FILE}-wal`, `${DB_FILE}-shm`]) {
      if (existsSync(sidecar)) {
        try { unlinkSync(sidecar); } catch {}
      }
    }
    console.log(JSON.stringify({ ok: true, restored_from: src, db: DB_FILE }));
  });

program
  .command("doctor")
  .description("Audit polyglot install health: bun, lt binary, profile, db, settings.json hooks, launchd plists, double-trigger")
  .option("--json", "machine-readable JSON output")
  .action((opts) => {
    const r = runDoctor();
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else console.log(formatReport(r));
    process.exit(r.exit_code);
  });

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks).toString("utf-8");
}

if (import.meta.main) {
  program.parseAsync(process.argv);
}
