#!/usr/bin/env bun
/**
 * Stop hook (heavy logic). Pre-gate (hooks/stop.sh) has already rolled the
 * inject_rate die + work-hours check before we cold-start bun.
 *
 * Behaviour:
 *  - Pull next due concept via `lt next --json`
 *  - If nothing due (CLI exits non-zero or empty payload) → safeFail/exit 0
 *  - Else emit additionalContext with a one-line cue Claude can pick up on
 */
import { runLt, emitContext } from "./lib/hook-utils.ts";
import { safeFail, logEvent } from "./lib/common.ts";
import { shouldThrottle, recordInject } from "./lib/limiter.ts";
import { readProfile } from "../src/profile.ts";

interface ConceptRow {
  id: string;
  type: string;
  level: string;
  ja: string;
  reading?: string | null;
  zh: string;
}

async function main() {
  try {
    // Re-check Adj-F throttle limits even though shell pre-gate dice rolled.
    // Pre-gate doesn't see hour/session counts; bun side does.
    const profile = readProfile();
    const t = shouldThrottle(profile);
    if (t.throttle) {
      logEvent({ event: "stop_hook_throttled", reason: t.reason });
      process.exit(0);
    }

    const { stdout, code } = runLt(["next", "--json", "--quiet"]);
    if (code !== 0 || !stdout.trim()) {
      // Nothing due — exit 0 silently per "hooks must never block the user".
      logEvent({ event: "stop_hook_no_due" });
      process.exit(0);
    }
    let concept: ConceptRow;
    try {
      concept = JSON.parse(stdout.trim());
    } catch {
      safeFail("stop_hook_json_parse_failed");
    }
    const reading = concept.reading ? `（${concept.reading}）` : "";
    const ctx =
      `[日语训练] 出题：[${concept.level}/${concept.type}] ${concept.ja}${reading} — ${concept.zh}\n` +
      `让用户先尝试回答（中文释义/造句/读音），然后用 lt answer --concept-id ${concept.id} --rating <1-4> --feedback "<rubric line>" --source stop-hook 记录评分。`;
    recordInject();
    logEvent({ event: "stop_hook_inject", concept_id: concept.id });
    emitContext("Stop", ctx);
    process.exit(0);
  } catch (err) {
    safeFail(`stop_hook_unexpected:${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
