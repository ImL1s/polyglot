/**
 * Pure builder for the UserPromptSubmit immersion prompt.
 *
 * Four-branch behaviour (v3 Critic Q5 0.50 重定义 + v1 D6 全沉浸):
 *   level <= 0          → null (off)
 *   0 < level < 0.50    → ambient mix, ceil(level * 10) words allowed
 *   0.50 <= level < 1.0 → 双语句法混合 (短句尾整句目标语言 + 中文翻译)
 *   level >= 1.0        → 全沉浸 (full target language + reading hint + 译文)
 *
 * isCode=true → null at any level (Adjustment K — never inject into code).
 *
 * Lives in src/utils/ so tests can import without triggering the hook entry
 * point (which calls main() on import).
 */
export interface ImmersionContext {
  level: number;
  language: string;
  isCode: boolean;
}

interface LanguagePack {
  // Friendly Chinese name for the language (用户视觉看到的标签)
  name: string;
  // Reading hint phrase used in 全沉浸 branch (e.g. furigana for ja, romaja for ko)
  readingHint: string;
  // Worked examples per branch — each shows source script + reading + 中文 gloss
  exampleAmbient: string;     // for 0 < level < 0.5
  exampleBilingual: string;   // for 0.5 <= level < 1.0
}

const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  ja: {
    name: "日文",
    readingHint: "furigana 假名注音",
    exampleAmbient: "「这个 bug 已经修了（直しました：fixed it）。」",
    exampleBilingual: "「这个 bug 修了。直しました（fixed it）。」",
  },
  ko: {
    name: "韩文",
    readingHint: "romaja 罗马音注音",
    exampleAmbient: "「这个 bug 已经修了（고쳤어요 gochyeosseoyo：fixed it）。」",
    exampleBilingual: "「这个 bug 修了。고쳤어요（fixed it）。」",
  },
  en: {
    name: "英文",
    readingHint: "IPA 音标",
    exampleAmbient: "「这个 bug 已经修了（fixed it：搞定了）。」",
    exampleBilingual: "「这个 bug 修了。Fixed it.（搞定了）」",
  },
};

export function getLanguageLabel(language: string): string {
  const code = language || "ja";
  const pack = LANGUAGE_PACKS[code];
  return pack ? `${pack.name} (${code})` : code;
}

export function buildImmersionPrompt(ctx: ImmersionContext): string | null {
  if (ctx.isCode) return null;
  const code = ctx.language || "ja";
  const pack = LANGUAGE_PACKS[code] ?? LANGUAGE_PACKS.ja;
  const known = code in LANGUAGE_PACKS;
  // Friendly label only for languages we ship templates for; unknown codes
  // get the bare code so the user immediately sees we don't have polish for it.
  const label = known ? `${pack.name} (${code})` : code;
  if (ctx.level <= 0) return null;
  if (ctx.level < 0.5) {
    const limit = Math.max(1, Math.ceil(ctx.level * 10));
    return (
      `[沉浸 mix lv=${ctx.level.toFixed(2)}] 你的回答中可以适当夹带至多 ${limit} 个 ${label} 已学单词，` +
      `括号内加注音和中文翻译。例：${pack.exampleAmbient}`
    );
    // TODO(Phase 1.1b): swap to `lt mix-vocab --limit N --json` for real
    // 80/20 mastered/weak pool (v3 D19b ambient engine).
  }
  if (ctx.level < 1.0) {
    return (
      `[沉浸 lv=0.50 双语句法] 在你的回答中，短句尾部用一句完整的 ${label}，再附中文翻译。` +
      `例：${pack.exampleBilingual}`
    );
  }
  return (
    `[沉浸 lv=1.00 全沉浸] 全部用 ${label}（含 ${pack.readingHint}），` +
    `中文译文附在每段末尾。`
  );
}
