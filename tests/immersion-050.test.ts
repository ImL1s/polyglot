import { describe, test, expect } from "bun:test";
import {
  buildImmersionPrompt,
  PRESET_LEVELS,
  PRESET_INT_TO_FLOAT,
  isPresetInt,
  type MixVocabItem,
} from "../src/utils/immersion.ts";

/**
 * Task 4 (Critic v3 fix #2 / Adj-H) — 0.50 双语句法 prompt template assurance.
 *
 * The 0.50 branch is the trickiest of the five presets — it sits between
 * "few-word ambient mix" and "full immersion" and the prompt has to carry
 * enough structural guidance that the LLM doesn't fall back to either neighbour.
 * Phase 1.1b ships dogfood + audit; this test locks the contract so any
 * future prompt edit has to update both the template and this expectations file.
 */
describe("0.50 双语句法 — prompt structural contract", () => {
  test("emits exact level marker [沉浸 lv=0.50 双语句法]", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false });
    expect(out).toContain("[沉浸 lv=0.50 双语句法]");
  });

  test("instructs target language for short sentence tail + Chinese translation", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).toContain("短句尾部");
    expect(out).toContain("一句完整的");
    expect(out).toContain("中文翻译");
  });

  test("ships TWO few-shot examples (例 1 + 例 2)", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).toContain("例 1：");
    expect(out).toContain("例 2：");
  });

  test("does not bleed into the ambient '至多 N 个' phrasing", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).not.toContain("至多");
  });

  test("does not bleed into the full-immersion 'reading hint' phrasing", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).not.toContain("furigana");
    expect(out).not.toContain("中文译文附在每段末尾");
  });

  test("warns against code/variable/command/file path interference", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).toContain("代码");
    expect(out).toContain("变量名");
    expect(out).toContain("命令名");
    expect(out).toContain("文件路径");
  });

  test("0.50 branch covers 0.50 ≤ level < 1.0 inclusive (sample 0.5, 0.65, 0.99)", () => {
    for (const lv of [0.5, 0.65, 0.99]) {
      const out = buildImmersionPrompt({ level: lv, language: "ja", isCode: false }) ?? "";
      expect(out).toContain("[沉浸 lv=0.50 双语句法]");
    }
  });

  test("ko 0.50 uses hangul example, not japanese", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ko", isCode: false }) ?? "";
    expect(out).toContain("고쳤어요");
    expect(out).not.toContain("直しました");
  });

  test("en 0.50 uses english example, not asian script", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "en", isCode: false }) ?? "";
    expect(out).toContain("Fixed it");
    expect(out).not.toContain("直しました");
    expect(out).not.toContain("고쳤어요");
  });

  test("optional vocab pool surfaces in the 0.50 prompt when provided", () => {
    const vocab: MixVocabItem[] = [
      { id: "v1", ja: "直す", reading: "なおす", zh: "修复" },
      { id: "v2", ja: "ログ", zh: "日志" },
    ];
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).toContain("已学词清单");
    expect(out).toContain("直す(なおす=修复)");
    expect(out).toContain("ログ(日志)");
  });

  test("empty vocab list does NOT add the 已学词清单 hint", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false }) ?? "";
    expect(out).not.toContain("已学词清单");
  });

  test("isCode=true suppresses 0.50 (Adj-K whitelist)", () => {
    expect(buildImmersionPrompt({ level: 0.5, language: "ja", isCode: true })).toBeNull();
  });
});

describe("PRESET_LEVELS — discrete 5-step contract (Adj-H)", () => {
  test("five accepted preset levels in profile float form", () => {
    expect(PRESET_LEVELS).toEqual([0, 0.1, 0.25, 0.5, 1.0] as const);
  });

  test("PRESET_INT_TO_FLOAT covers exactly 0/10/25/50/100", () => {
    expect(Object.keys(PRESET_INT_TO_FLOAT).map(Number).sort((a, b) => a - b)).toEqual([0, 10, 25, 50, 100]);
  });

  test("isPresetInt accepts only the five preset ints", () => {
    for (const n of [0, 10, 25, 50, 100]) {
      expect(isPresetInt(n)).toBe(true);
    }
    for (const n of [-1, 1, 5, 35, 99, 100.5, 200]) {
      expect(isPresetInt(n)).toBe(false);
    }
  });

  test("each preset int round-trips to a known PRESET_LEVELS value", () => {
    for (const n of [0, 10, 25, 50, 100]) {
      const f = PRESET_INT_TO_FLOAT[n];
      expect(PRESET_LEVELS).toContain(f);
    }
  });
});

describe("buildImmersionPrompt — vocab pool integration (Task 5 wiring)", () => {
  test("ambient (0.10) shows vocab list when provided", () => {
    const vocab: MixVocabItem[] = [{ id: "v1", ja: "ログ", zh: "日志" }];
    const out = buildImmersionPrompt({ level: 0.1, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).toContain("已学词清单");
    expect(out).toContain("ログ(日志)");
  });

  test("full immersion (1.0) does NOT receive vocab list (it's full target language anyway)", () => {
    const vocab: MixVocabItem[] = [{ id: "v1", ja: "ログ", zh: "日志" }];
    const out = buildImmersionPrompt({ level: 1.0, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).not.toContain("已学词清单");
  });

  test("vocab item with reading shows 'ja(reading=zh)' format", () => {
    const vocab: MixVocabItem[] = [{ id: "v1", ja: "勉強", reading: "べんきょう", zh: "学习" }];
    const out = buildImmersionPrompt({ level: 0.25, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).toContain("勉強(べんきょう=学习)");
  });

  test("vocab item without reading shows 'ja(zh)' format", () => {
    const vocab: MixVocabItem[] = [{ id: "v2", ja: "頑張る", zh: "努力" }];
    const out = buildImmersionPrompt({ level: 0.25, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).toContain("頑張る(努力)");
  });

  test("multiple vocab items joined with 、", () => {
    const vocab: MixVocabItem[] = [
      { id: "v1", ja: "ログ", zh: "日志" },
      { id: "v2", ja: "バグ", zh: "bug" },
      { id: "v3", ja: "修正", zh: "修复" },
    ];
    const out = buildImmersionPrompt({ level: 0.25, language: "ja", isCode: false }, vocab) ?? "";
    expect(out).toContain("ログ(日志)、バグ(bug)、修正(修复)");
  });
});
