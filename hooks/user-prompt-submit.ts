#!/usr/bin/env bun
/**
 * UserPromptSubmit hook. Combines three jobs:
 *   1. Session-start: inject "今日待复习 N 题" hint when a fresh session boots.
 *   2. Immersion mix: inject a per-level immersion prompt (D19 ambient).
 *      Task 5 ships the framework + four-branch (=0 / 0<x<0.5 ambient /
 *      =0.5 双语句法 / =1.0 全沉浸) template selector.
 *   3. CN reverse-prompt: when stdin contains a meaningful Chinese line and
 *      `lt detect-cn` fires, ask Claude to turn it into a translation drill.
 *
 * Code context detection (Adjustment K) suppresses immersion injection when
 * the user prompt looks like code/CLI/URL — we don't want random Japanese
 * vocabulary spliced into a snippet review.
 */
import { existsSync } from "node:fs";
import { runLt, emitContext, readHookPayload } from "./lib/hook-utils.ts";
import { safeFail, logEvent } from "./lib/common.ts";
import { shouldThrottle, recordInject } from "./lib/limiter.ts";
import { readProfile, type Profile } from "../src/profile.ts";
import { IMMERSION_FLAG } from "../src/paths.ts";
import { looksLikeCodeContext } from "../src/utils/code-context.ts";
import { buildImmersionPrompt, getLanguageLabel } from "../src/utils/immersion.ts";

interface PromptPayload {
  user_message?: string;
  session_id?: string;
  cwd?: string;
  is_new_session?: boolean;
}

function detectDueOnSessionStart(label: string): string | null {
  const { stdout, code } = runLt(["due-count"]);
  if (code !== 0) return null;
  const n = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `[${label} 训练] 今日待复习 ${n} 题。可用 /lt 抽题，或 lt next --json 获取下一道。`;
}

function detectChineseReversePrompt(userMessage: string, profile: Profile, label: string): string | null {
  if (!userMessage || profile.cn_probe_rate <= 0) return null;
  // Route through runLt with --text so we don't have to pipe stdin (and don't
  // depend on bun being on PATH for the dev fallback).
  try {
    const r = runLt(["detect-cn", "--probe-rate", String(profile.cn_probe_rate), "--text", userMessage]);
    if (r.code !== 0) return null;
    const cnLine = (r.stdout || "").trim();
    if (!cnLine) return null;
    return `[${label} 训练 反问] 顺手让用户做${label}翻译练习：把这句中文「${cnLine}」翻译成${label}，先让用户自己答，错了再讲解。`;
  } catch {
    return null;
  }
}

async function main() {
  try {
    const payload = (await readHookPayload<PromptPayload>()) ?? {};
    const profile = readProfile();
    const userMessage = payload.user_message ?? "";
    const isCode = looksLikeCodeContext(userMessage);

    const throttle = shouldThrottle(profile);
    if (throttle.throttle) {
      logEvent({ event: "user_prompt_submit_throttled", reason: throttle.reason });
      process.exit(0);
    }

    const lines: string[] = [];
    const label = getLanguageLabel(profile.active_language);

    if (payload.is_new_session) {
      const dueLine = detectDueOnSessionStart(label);
      if (dueLine) lines.push(dueLine);
    }

    // Phase 1.0 fallback: skills/lt-on writes ~/.config/polyglot/immersion.flag
    // but profile.immersion_level may still be 0. If the flag is on, treat as
    // level=1.0 for this turn so the v1.0 /lt-on contract actually has effect.
    // Phase 1.1b (Task 23) flips authority to immersion_level alone.
    const flagOn = existsSync(IMMERSION_FLAG);
    const effectiveLevel = profile.immersion_level > 0
      ? profile.immersion_level
      : flagOn ? 1.0 : 0;
    const immersionLine = buildImmersionPrompt({
      level: effectiveLevel,
      language: profile.active_language,
      isCode,
    });
    if (immersionLine) lines.push(immersionLine);

    const cnLine = detectChineseReversePrompt(userMessage, profile, label);
    if (cnLine) lines.push(cnLine);

    if (lines.length === 0) {
      process.exit(0);
    }
    emitContext("UserPromptSubmit", lines.join("\n\n"));
    recordInject();
    logEvent({ event: "user_prompt_submit_inject", count: lines.length });
    process.exit(0);
  } catch (err) {
    safeFail(`user_prompt_submit_unexpected:${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
