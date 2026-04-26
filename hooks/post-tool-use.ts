#!/usr/bin/env bun
/**
 * PostToolUse hook (heavy logic). Pre-gate has already rolled the
 * post_tool_inject_rate die + work-hours check.
 *
 * Behaviour:
 *  - Honour Adj-F throttle (DND / hour cap / session cap)
 *  - Read tool_response.duration_ms; bail if shorter than profile.post_tool_min_duration_ms
 *  - Pull a vocab card via `lt next --json --type vocab --quiet`
 *  - Emit additionalContext + record inject for caps
 */
import { runLt, emitContext, readHookPayload } from "./lib/hook-utils.ts";
import { safeFail, logEvent } from "./lib/common.ts";
import { shouldThrottle, recordInject } from "./lib/limiter.ts";
import { readProfile } from "../src/profile.ts";

interface PostToolPayload {
  tool_name?: string;
  tool_response?: {
    duration_ms?: number;
  };
}

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
    const payload = (await readHookPayload<PostToolPayload>()) ?? {};
    const profile = readProfile();

    if (!profile.post_tool_inject) process.exit(0);

    const duration = payload.tool_response?.duration_ms ?? 0;
    if (duration < profile.post_tool_min_duration_ms) process.exit(0);

    const throttle = shouldThrottle(profile);
    if (throttle.throttle) {
      logEvent({ event: "post_tool_throttled", reason: throttle.reason });
      process.exit(0);
    }

    const { stdout, code } = runLt(["next", "--json", "--type", "vocab", "--quiet"]);
    if (code !== 0 || !stdout.trim()) process.exit(0);

    let concept: ConceptRow;
    try {
      concept = JSON.parse(stdout.trim());
    } catch {
      safeFail("post_tool_hook_json_parse_failed");
    }
    const reading = concept.reading ? `（${concept.reading}）` : "";
    const ctx =
      `[日语训练 单词卡] 趁刚才工具运行的间隙过一道单词：` +
      `[${concept.level}/${concept.type}] ${concept.ja}${reading} — ${concept.zh}\n` +
      `让用户先回答释义/造句，再用 lt answer --concept-id ${concept.id} --rating <1-4> --source post-tool 记录。`;
    emitContext("PostToolUse", ctx);
    recordInject();
    logEvent({ event: "post_tool_inject", concept_id: concept.id });
    process.exit(0);
  } catch (err) {
    safeFail(`post_tool_hook_unexpected:${err instanceof Error ? err.message : String(err)}`);
  }
}

main();
