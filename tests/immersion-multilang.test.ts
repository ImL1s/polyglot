import { describe, test, expect } from "bun:test";
import { buildImmersionPrompt, getLanguageLabel } from "../src/utils/immersion.ts";

/**
 * Task 17 — multi-language immersion prompt template.
 *
 * Cover 4 levels (off / ambient / 双语句法 / 全沉浸) × 3 languages (ja/ko/en)
 * = 12 combinations. Plus fallback for unknown language code.
 */

const LEVELS = [
  { name: "off", level: 0 },
  { name: "ambient (0.25)", level: 0.25 },
  { name: "bilingual (0.5)", level: 0.5 },
  { name: "full (1.0)", level: 1.0 },
] as const;

const LANGUAGES = ["ja", "ko", "en"] as const;

describe("buildImmersionPrompt × language matrix", () => {
  for (const lang of LANGUAGES) {
    for (const lvl of LEVELS) {
      test(`${lang} × ${lvl.name}`, () => {
        const out = buildImmersionPrompt({ level: lvl.level, language: lang, isCode: false });
        if (lvl.level <= 0) {
          expect(out).toBeNull();
        } else {
          expect(out).not.toBeNull();
          // language code always appears in parens for grep-ability
          expect(out).toContain(`(${lang})`);
          // friendly Chinese name appears too
          if (lang === "ja") expect(out).toContain("日文");
          if (lang === "ko") expect(out).toContain("韩文");
          if (lang === "en") expect(out).toContain("英文");
        }
      });
    }
  }

  test("ko ambient example uses hangul + romaja, not japanese", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "ko", isCode: false }) ?? "";
    expect(out).toContain("고쳤어요");
    expect(out).not.toContain("直しました");
  });

  test("en ambient example uses english + chinese gloss, no asian script", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "en", isCode: false }) ?? "";
    expect(out).toContain("fixed it");
    expect(out).not.toContain("直しました");
    expect(out).not.toContain("고쳤어요");
  });

  test("ko full immersion mentions romaja, not furigana", () => {
    const out = buildImmersionPrompt({ level: 1.0, language: "ko", isCode: false }) ?? "";
    expect(out).toContain("romaja");
    expect(out).not.toContain("furigana");
  });

  test("ja full immersion still mentions furigana (back-compat)", () => {
    const out = buildImmersionPrompt({ level: 1.0, language: "ja", isCode: false }) ?? "";
    expect(out).toContain("furigana");
    expect(out).not.toContain("romaja");
  });

  test("isCode=true suppresses across all languages", () => {
    for (const lang of LANGUAGES) {
      for (const lvl of [0.25, 0.5, 1.0]) {
        expect(buildImmersionPrompt({ level: lvl, language: lang, isCode: true })).toBeNull();
      }
    }
  });

  test("unknown language code falls back to label = code only (no friendly name)", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "fr", isCode: false }) ?? "";
    // No pack for "fr" → label is just "fr"
    expect(out).toContain("fr");
    expect(out).not.toContain("日文");
    expect(out).not.toContain("韩文");
  });
});

describe("getLanguageLabel", () => {
  test("returns 'name (code)' for known languages", () => {
    expect(getLanguageLabel("ja")).toBe("日文 (ja)");
    expect(getLanguageLabel("ko")).toBe("韩文 (ko)");
    expect(getLanguageLabel("en")).toBe("英文 (en)");
  });

  test("returns just the code when language is unknown", () => {
    expect(getLanguageLabel("fr")).toBe("fr");
    expect(getLanguageLabel("de")).toBe("de");
  });

  test("empty input falls back to ja label", () => {
    expect(getLanguageLabel("")).toBe("日文 (ja)");
  });
});
