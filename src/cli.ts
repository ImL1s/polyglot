#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, unlinkSync, readFileSync, copyFileSync, renameSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Database } from "bun:sqlite";

import { CONFIG_DIR, IMMERSION_FLAG, LOG_FILE, DB_FILE } from "./paths.ts";
import { runDoctor, formatReport } from "./doctor.ts";
import {
  readProfile,
  writeProfile,
  patchProfile,
  DEFAULT_PROFILE,
  SUPPORTED_LANGUAGES,
  type Profile,
} from "./profile.ts";
import { recordAnswer } from "./srs.ts";
import { getNextDue, dueCount, getStats, listDueConcepts } from "./concepts.ts";
import { importSeeds } from "./seeds.ts";
import { isWithinWorkHours } from "./work-hours.ts";
import { buildExplainPayload, cacheExplainFeedback, EXPLAIN_LIMITS } from "./explain.ts";
import { speak, buildSpeakBundle, LANG_TO_VOICE } from "./tts.ts";
import { gradeListeningAnswer } from "./listening.ts";
import { getDb, rowToConcept, type ConceptRow } from "./db.ts";
import { PRESET_INT_TO_FLOAT, isPresetInt } from "./utils/immersion.ts";
import {
  getMixVocab,
  logAmbientExposures,
  cleanOldExposures,
  archiveExposures,
  getAmbientStats,
} from "./ambient.ts";

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
  .option("--type <type>", "vocab | grammar | kanji | expression | listening")
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

const language = program
  .command("language")
  .description("Manage active study language (multi-language schema)");

language
  .command("list")
  .description("List supported languages, marking the active one")
  .option("--json", "JSON output")
  .action((opts) => {
    const profile = readProfile();
    const items = SUPPORTED_LANGUAGES.map((l) => ({ language: l, active: l === profile.active_language }));
    if (opts.json) {
      console.log(JSON.stringify(items));
      return;
    }
    for (const i of items) {
      console.log(`${i.active ? "* " : "  "}${i.language}`);
    }
  });

language
  .command("switch <lang>")
  .description("Switch active language. Persists per_language[lang] if missing.")
  .action((lang: string) => {
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      console.error(`unsupported language: ${lang}. Supported: ${SUPPORTED_LANGUAGES.join(", ")}`);
      process.exit(2);
    }
    const cur = readProfile();
    const per = { ...cur.per_language };
    if (!per[lang]) {
      per[lang] = { level: cur.level, target: cur.target, weak_areas: cur.weak_areas };
    }
    const next = patchProfile({ active_language: lang, per_language: per });
    console.log(JSON.stringify({ ok: true, active_language: next.active_language }));
  });

// Phase 1.1b — `lt mix <preset>` is the canonical entrypoint for setting
// immersion_level. `lt immersion <state>` is kept as an alias for the v1.0
// /lt-on / /lt-off skill contract (on=100, off=0, status reads profile).
//
// Both commands write profile.immersion_level. The legacy IMMERSION_FLAG
// file is kept in sync (created when level>0, removed when level=0) so the
// hook fallback in user-prompt-submit.ts still honors /lt-on from older
// installs that haven't migrated yet.
function applyImmersionLevel(levelFloat: number): { ok: true; level: number } {
  patchProfile({ immersion_level: levelFloat });
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (levelFloat > 0) {
    writeFileSync(IMMERSION_FLAG, String(Date.now()), "utf-8");
  } else if (existsSync(IMMERSION_FLAG)) {
    unlinkSync(IMMERSION_FLAG);
  }
  return { ok: true, level: levelFloat };
}

program
  .command("mix")
  .description("Set ambient mix-language level. Accepts presets 0/10/25/50/100, status, or --custom <0-100>")
  .argument("[preset]", "0 | 10 | 25 | 50 | 100 | status")
  .option("--custom <n>", "escape hatch — write any 0-100 value (not recommended)", parseFloat)
  .action((preset: string | undefined, opts: { custom?: number }) => {
    if (opts.custom !== undefined) {
      if (!Number.isFinite(opts.custom) || opts.custom < 0 || opts.custom > 100) {
        console.error(`--custom expects a number 0-100, got: ${opts.custom}`);
        process.exit(2);
      }
      const f = opts.custom / 100;
      const r = applyImmersionLevel(f);
      console.log(JSON.stringify({ ...r, custom: true }));
      return;
    }
    if (!preset || preset === "status") {
      const cur = readProfile().immersion_level;
      console.log(JSON.stringify({ immersion_level: cur }));
      return;
    }
    const n = Number.parseInt(preset, 10);
    if (!Number.isFinite(n) || !isPresetInt(n)) {
      console.error(
        `lt mix expects 0 / 10 / 25 / 50 / 100 (got: ${preset}). ` +
        `Use \`lt mix --custom ${preset}\` to bypass (not recommended — LLM behaviour ` +
        `is only well-defined at the five preset anchors).`,
      );
      process.exit(2);
    }
    const f = PRESET_INT_TO_FLOAT[n];
    const r = applyImmersionLevel(f);
    console.log(JSON.stringify(r));
  });

program
  .command("immersion")
  .description("Set immersion level (alias for `lt mix`). Accepts on / off / 0 / 10 / 25 / 50 / 100 / status / toggle")
  .argument("<state>", "on | off | 0 | 10 | 25 | 50 | 100 | status | toggle")
  .action((state: string) => {
    if (state === "status") {
      const cur = readProfile().immersion_level;
      console.log(cur > 0 ? "on" : "off");
      return;
    }
    if (state === "toggle") {
      const cur = readProfile().immersion_level;
      const next = cur > 0 ? 0 : 1.0;
      const r = applyImmersionLevel(next);
      console.log(`immersion: ${r.level > 0 ? "on" : "off"}`);
      return;
    }
    if (state === "on") {
      applyImmersionLevel(1.0);
      console.log("immersion: on");
      return;
    }
    if (state === "off") {
      applyImmersionLevel(0);
      console.log("immersion: off");
      return;
    }
    const n = Number.parseInt(state, 10);
    if (!Number.isFinite(n) || !isPresetInt(n)) {
      console.error(
        `lt immersion expects on/off/toggle/status or 0/10/25/50/100 (got: ${state}). ` +
        `Use \`lt mix --custom ${state}\` for non-preset values.`,
      );
      process.exit(2);
    }
    const f = PRESET_INT_TO_FLOAT[n];
    applyImmersionLevel(f);
    console.log(`immersion: ${f > 0 ? "on" : "off"} (level=${f})`);
  });

// Phase 1.1b D19b/d/Adj-G — ambient mix engine + exposure log + retention.
program
  .command("mix-vocab")
  .description("Sample 80% mastered + 20% weak vocab pool for ambient mix prompt (Phase 1.1b D19b)")
  .option("--limit <n>", "max items returned", (v) => parseInt(v, 10), 15)
  .option("--language <lang>", "override profile.active_language")
  .option("--mastered-ratio <r>", "0..1 share of mastered words", parseFloat, 0.8)
  .option("--json", "JSON output (default)", true)
  .action((opts) => {
    const profile = readProfile();
    const lang = (opts.language as string | undefined) ?? profile.active_language;
    const items = getMixVocab(lang, {
      limit: opts.limit,
      masteredRatio: opts.masteredRatio,
    });
    console.log(JSON.stringify(items));
  });

program
  .command("ambient-log")
  .description("Record ambient exposure for a comma-separated list of concept ids (used by hook)")
  .requiredOption("--concepts <csv>", "concept_id1,concept_id2,...")
  .option("--language <lang>", "override profile.active_language")
  .option("--source <s>", "log source label", "mix")
  .action((opts) => {
    const profile = readProfile();
    const lang = (opts.language as string | undefined) ?? profile.active_language;
    const ids = (opts.concepts as string).split(",").map((s) => s.trim()).filter(Boolean);
    const n = logAmbientExposures(ids, lang, opts.source);
    console.log(JSON.stringify({ ok: true, inserted: n, language: lang }));
  });

program
  .command("ambient-clean")
  .description("Archive then delete ambient_exposures rows older than --keep-days (default 90)")
  .option("--keep-days <n>", "retention window (days)", (v) => parseInt(v, 10), 90)
  .option("--json", "JSON output")
  .action((opts) => {
    const cutoff = Date.now() - Math.max(0, opts.keepDays) * 24 * 3600 * 1000;
    const archived = archiveExposures(cutoff);
    const deleted = cleanOldExposures(cutoff);
    appendFileSync(
      LOG_FILE,
      JSON.stringify({
        ts: Date.now(),
        event: "ambient_cleaned",
        keep_days: opts.keepDays,
        archived_concepts: archived,
        deleted,
      }) + "\n",
      "utf-8",
    );
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, archived_concepts: archived, deleted, keep_days: opts.keepDays }));
    } else {
      console.log(`ambient-clean: archived ${archived} concept groups, deleted ${deleted} rows (keep ${opts.keepDays} days)`);
    }
  });

program
  .command("ambient-stats")
  .description("Show ambient mix exposure stats for the active language (D19e)")
  .option("--language <lang>", "override profile.active_language")
  .option("--top <n>", "show top N concepts", (v) => parseInt(v, 10), 5)
  .option("--json", "JSON output")
  .action((opts) => {
    const profile = readProfile();
    const lang = (opts.language as string | undefined) ?? profile.active_language;
    const stats = getAmbientStats(lang, opts.top);
    if (opts.json) {
      console.log(JSON.stringify(stats));
      return;
    }
    console.log(`Ambient mix stats — ${lang}`);
    console.log(`  live exposures:     ${stats.live_count}`);
    console.log(`  archived exposures: ${stats.archived_count}`);
    console.log(`  total:              ${stats.total}`);
    console.log(`  unique concepts:    ${stats.unique_concepts}`);
    if (stats.total === 0) {
      // Critic Independent #4 — diagnostic line for "0 暴露"
      console.log("  (本周 0 次暴露 — 原因可能：mastered 词库未积累 / mix 已关闭 / 触发未达概率)");
    } else {
      console.log("  top concepts:");
      for (const t of stats.top_concepts) {
        console.log(`    ${t.ja} (${t.zh}) — ${t.n}`);
      }
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
  .option("--include-mock", "also import mock-*.yaml files into mock_questions table")
  .action(async (opts) => {
    const summary = importSeeds(opts.dir);
    if (opts.includeMock) {
      const { importMockSeeds } = await import("./mock.ts");
      const mockSummary = importMockSeeds(opts.dir);
      console.log(JSON.stringify({ ...summary, mock: mockSummary }, null, 2));
    } else {
      console.log(JSON.stringify(summary, null, 2));
    }
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
  .command("explain")
  .description("Pull a concept + recent attempts as JSON for the LLM to render 5-section teaching")
  .argument("<conceptId>", "concept id to explain")
  .option("--json", "JSON output (default; flag kept for symmetry with other commands)")
  .option("--cache <feedback>", "append feedback as [explain] cache to the most recent attempt")
  .action((conceptId: string, opts) => {
    if (opts.cache !== undefined) {
      const ok = cacheExplainFeedback(conceptId, opts.cache);
      console.log(JSON.stringify({ ok, concept_id: conceptId }));
      return;
    }
    const payload = buildExplainPayload(conceptId);
    if (!payload) {
      console.error(`concept not found: ${conceptId}`);
      process.exit(2);
    }
    const out = JSON.stringify(payload);
    if (out.length > EXPLAIN_LIMITS.PAYLOAD_CHAR_BUDGET) {
      // payload exceeds the 8K char budget despite per-attempt truncation; this
      // can happen if examples/tags/zh on the concept itself are unusually
      // long. We still emit but warn so callers can flag prompts that may bust
      // the LLM context window.
      console.error(`warn: explain payload ${out.length} chars > budget ${EXPLAIN_LIMITS.PAYLOAD_CHAR_BUDGET}`);
    }
    console.log(out);
  });

program
  .command("say")
  .description("Speak a concept (or arbitrary text) via the configured TTS backend")
  .argument("[conceptId]", "concept id; if omitted use --text")
  .option("--text <text>", "speak arbitrary text instead of a concept")
  .option("--lang <lang>", "language code (ja|ko|en|zh|es); default = profile.active_language")
  .option("--rate <rate>", "word rate override (default profile.tts_rate)", (v) => parseInt(v, 10))
  .option("--voice <voice>", "voice override (e.g. Kyoko); default = LANG_TO_VOICE[lang]")
  .option("--full", "speak headword + reading + first example (default: headword only)")
  .option("--blocking", "wait for the spawned process to exit (default: fire-and-forget)")
  .option("--json", "emit a JSON result line describing what was spoken")
  .action(async (conceptId: string | undefined, opts) => {
    const profile = readProfile();
    const lang = opts.lang ?? profile.active_language;

    let text: string;
    if (opts.text) {
      text = opts.text;
    } else if (conceptId) {
      const row = getDb()
        .query("SELECT * FROM concepts WHERE id = ?")
        .get(conceptId) as ConceptRow | null;
      if (!row) {
        console.error(`concept not found: ${conceptId}`);
        process.exit(2);
      }
      const concept = rowToConcept(row);
      const bundle = buildSpeakBundle(concept);
      if (!bundle) {
        console.error(`concept has no speakable text: ${conceptId}`);
        process.exit(2);
      }
      text = opts.full
        ? [bundle.headword, bundle.reading, bundle.example].filter(Boolean).join("。")
        : bundle.headword;
    } else {
      console.error("provide either <conceptId> or --text");
      process.exit(2);
    }

    const result = await speak(text, lang, {
      rate: opts.rate,
      voice: opts.voice,
      blocking: !!opts.blocking,
    });
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, language: lang, text, ...result }));
    }
  });

program
  .command("grade-listening")
  .description("Score a kana answer against a concept's reading (listening drill, D15)")
  .requiredOption("--concept-id <id>", "concept id to score against")
  .requiredOption("--user-answer <text>", "user's kana input")
  .action((opts) => {
    const row = getDb()
      .query("SELECT * FROM concepts WHERE id = ?")
      .get(opts.conceptId) as ConceptRow | null;
    if (!row) {
      console.error(`concept not found: ${opts.conceptId}`);
      process.exit(2);
    }
    const concept = rowToConcept(row);
    if (!concept.reading) {
      console.error(`concept has no reading; not eligible for listening drill: ${opts.conceptId}`);
      process.exit(2);
    }
    const grade = gradeListeningAnswer(opts.userAnswer, concept.reading);
    console.log(JSON.stringify({ ok: true, concept_id: concept.id, ...grade }));
  });

program
  .command("mock-test")
  .description("Sample N mock-test questions (default 30) and stream them as JSON for the LLM to administer")
  .option("--count <n>", "how many to sample", (v) => parseInt(v, 10), 30)
  .option("--type <type>", "all | vocab | grammar | listening | reading", "all")
  .option("--level <level>", "level filter (default N2)", "N2")
  .option("--language <lang>", "language filter (default ja)", "ja")
  .option("--json", "JSON output (default)")
  .action(async (opts) => {
    const { pickMockQuestions } = await import("./mock.ts");
    const questions = pickMockQuestions({
      count: opts.count,
      type: opts.type,
      level: opts.level,
      language: opts.language,
    });
    if (questions.length === 0) {
      console.error("no mock questions found — run `lt seed-import --include-mock` first");
      process.exit(2);
    }
    console.log(JSON.stringify({ count: questions.length, questions }));
  });

program
  .command("mock-record")
  .description("Persist one mock-test answer (called by the skill after the LLM grades a single question)")
  .requiredOption("--question-id <id>", "mock question id")
  .requiredOption("--user-choice <n>", "0-3", (v) => parseInt(v, 10))
  .requiredOption("--correct <c>", "1 if user-choice matches the question's correct idx, else 0", (v) => parseInt(v, 10))
  .action(async (opts) => {
    const { recordMockAnswer } = await import("./mock.ts");
    recordMockAnswer({
      questionId: opts.questionId,
      userChoice: opts.userChoice,
      isCorrect: opts.correct === 1,
    });
    console.log(JSON.stringify({ ok: true }));
  });

program
  .command("mock-report")
  .description("Aggregate score for the most-recent mock-test session (last 24h by default)")
  .option("--window-hours <n>", "look-back window in hours", (v) => parseInt(v, 10), 24)
  .action(async (opts) => {
    const { buildMockReport } = await import("./mock.ts");
    const db = getDb();
    const since = Date.now() - opts.windowHours * 3600 * 1000;
    // Pull rows + their question types so by_type aggregation works without
    // re-querying mock_questions in a loop.
    const rows = db
      .query(
        `SELECT ma.question_id, ma.is_correct, ma.user_choice, ma.created_at, mq.type
           FROM mock_attempts ma
           LEFT JOIN mock_questions mq ON mq.id = ma.question_id
          WHERE ma.created_at >= ?
          ORDER BY ma.created_at ASC`,
      )
      .all(since) as {
        question_id: string;
        is_correct: number;
        user_choice: number;
        created_at: number;
        type: string | null;
      }[];
    const results = rows.map((r) => ({
      question_id: r.question_id,
      type: r.type ?? "unknown",
      user_choice: r.user_choice,
      is_correct: r.is_correct === 1,
      created_at: r.created_at,
    }));
    const report = buildMockReport(results);
    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("ambient-validate")
  .description("Adjustment K1: binomial test of mock-test accuracy — high (≥7 ambient exposures) vs low. Outputs JSON.")
  .option("--window-days <n>", "look-back window in days (default 30)", (v) => parseInt(v, 10), 30)
  .option("--threshold <n>", "exposure count cutoff between high/low groups (default 7)", (v) => parseInt(v, 10), 7)
  .action(async (opts) => {
    const { runAmbientValidate } = await import("./mock.ts");
    const report = runAmbientValidate({ windowDays: opts.windowDays, highThreshold: opts.threshold });
    console.log(JSON.stringify(report, null, 2));
    if (report.status === "no_table") process.exit(2);
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
