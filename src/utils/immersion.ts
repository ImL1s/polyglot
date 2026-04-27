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
  exampleAmbient2: string;    // second few-shot for 0 < level < 0.5
  exampleBilingual: string;   // for 0.5 <= level < 1.0
  exampleBilingual2: string;  // second few-shot for 0.5 <= level < 1.0
  exampleFull: string;        // for level >= 1.0
  exampleFull2: string;       // second few-shot for level >= 1.0
}

const LANGUAGE_PACKS: Record<string, LanguagePack> = {
  ja: {
    name: "日文",
    readingHint: "furigana 假名注音",
    exampleAmbient: "「这个 bug 已经修了（直しました：fixed it）。」",
    exampleAmbient2: "「我先去吃饭（ご飯：fàn）再回来。」",
    exampleBilingual: "「这个 bug 修了。直しました（fixed it）。」",
    exampleBilingual2: "「先把日志看一遍。ログを見てみます（先看一下日志）。」",
    exampleFull: "「このバグはもう直しました（这个 bug 已经修好了）。」",
    exampleFull2: "「先にログを確認します（先看一下日志）。」",
  },
  ko: {
    name: "韩文",
    readingHint: "romaja 罗马音注音",
    exampleAmbient: "「这个 bug 已经修了（고쳤어요 gochyeosseoyo：fixed it）。」",
    exampleAmbient2: "「先去吃饭（밥 bap：饭）再回来。」",
    exampleBilingual: "「这个 bug 修了。고쳤어요（fixed it）。」",
    exampleBilingual2: "「先看日志。로그를 봐요（先看一下日志）。」",
    exampleFull: "「이 버그는 벌써 고쳤어요 (i beogeuneun beolsseo gochyeosseoyo) — 这个 bug 已经修好了。」",
    exampleFull2: "「먼저 로그를 봅시다 (meonjeo rogeureul bopsida) — 先看一下日志。」",
  },
  en: {
    name: "英文",
    readingHint: "IPA 音标",
    exampleAmbient: "「这个 bug 已经修了（fixed it：搞定了）。」",
    exampleAmbient2: "「先去吃饭（lunch：午餐）再回来。」",
    exampleBilingual: "「这个 bug 修了。Fixed it.（搞定了）」",
    exampleBilingual2: "「先看日志。Let me check the logs first.（先看一下日志）」",
    exampleFull: "「I've already fixed this bug. — 这个 bug 已经修好了。」",
    exampleFull2: "「Let me check the logs first. — 先看一下日志。」",
  },
};

/**
 * Discrete preset levels accepted by `lt mix <N>` and `lt immersion <N>`.
 * Architect Adj-H — LLM behaviour can only be cleanly specified at these
 * five anchor points; any custom value silently maps to nearest preset
 * behaviour with a warning.
 */
export const PRESET_LEVELS = [0, 0.1, 0.25, 0.5, 1.0] as const;
export type PresetLevel = typeof PRESET_LEVELS[number];

/** Map CLI int (0/10/25/50/100) → profile float (0/0.10/0.25/0.50/1.00). */
export const PRESET_INT_TO_FLOAT: Record<number, PresetLevel> = {
  0: 0,
  10: 0.1,
  25: 0.25,
  50: 0.5,
  100: 1.0,
};

/** Whether n is one of the five accepted CLI preset ints. */
export function isPresetInt(n: number): n is keyof typeof PRESET_INT_TO_FLOAT {
  return n in PRESET_INT_TO_FLOAT;
}

export function getLanguageLabel(language: string): string {
  const code = language || "ja";
  const pack = LANGUAGE_PACKS[code];
  return pack ? `${pack.name} (${code})` : code;
}

/** Item in the optional vocab pool injected by `lt mix-vocab` (Task 5). */
export interface MixVocabItem {
  id: string;
  ja: string;
  zh: string;
  reading?: string;
}

export function buildImmersionPrompt(
  ctx: ImmersionContext,
  vocab: readonly MixVocabItem[] = [],
): string | null {
  if (ctx.isCode) return null;
  const code = ctx.language || "ja";
  const pack = LANGUAGE_PACKS[code] ?? LANGUAGE_PACKS.ja;
  const known = code in LANGUAGE_PACKS;
  // Friendly label only for languages we ship templates for; unknown codes
  // get the bare code so the user immediately sees we don't have polish for it.
  const label = known ? `${pack.name} (${code})` : code;
  if (ctx.level <= 0) return null;

  const vocabHint = vocab.length > 0
    ? ` 优先从以下已学词清单中选词（仅替换确切对应中文意思的词，不强插）：${formatVocab(vocab)}。`
    : "";

  if (ctx.level < 0.5) {
    const limit = Math.max(1, Math.ceil(ctx.level * 10));
    return (
      `[沉浸 mix lv=${ctx.level.toFixed(2)}] 你的回答中可以适当夹带至多 ${limit} 个 ${label} 已学单词，` +
      `括号内加注音和中文翻译。例 1：${pack.exampleAmbient} 例 2：${pack.exampleAmbient2}` +
      vocabHint +
      ` 不替换代码/变量名/命令名/文件路径；如果替换后理解困难就跳过。`
    );
  }
  if (ctx.level < 1.0) {
    return (
      `[沉浸 lv=0.50 双语句法] 在你的回答中，短句尾部用一句完整的 ${label}，再附中文翻译。` +
      `例 1：${pack.exampleBilingual} 例 2：${pack.exampleBilingual2}` +
      vocabHint +
      ` 不在代码/变量名/命令名/文件路径里夹带 ${label}；句法不通顺就跳过。`
    );
  }
  return (
    `[沉浸 lv=1.00 全沉浸] 全部用 ${label}（含 ${pack.readingHint}），中文译文附在每段末尾。` +
    ` 例 1：${pack.exampleFull} 例 2：${pack.exampleFull2}` +
    ` 代码块/命令/文件路径保持原样，不翻译。`
  );
}

function formatVocab(vocab: readonly MixVocabItem[]): string {
  return vocab
    .map((v) => v.reading ? `${v.ja}(${v.reading}=${v.zh})` : `${v.ja}(${v.zh})`)
    .join("、");
}
