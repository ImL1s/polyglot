/**
 * Pure builder for the UserPromptSubmit immersion prompt.
 *
 * Four-branch behaviour (v3 Critic Q5 0.50 重定义 + v1 D6 全沉浸):
 *   level <= 0          → null (off)
 *   0 < level < 0.50    → ambient mix, ceil(level * 10) words allowed
 *   0.50 <= level < 1.0 → 双语句法混合 (短句尾整句目标语言 + 中文翻译)
 *   level >= 1.0        → 全沉浸 (full target language + furigana + 译文)
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

export function buildImmersionPrompt(ctx: ImmersionContext): string | null {
  if (ctx.isCode) return null;
  const lang = ctx.language || "ja";
  if (ctx.level <= 0) return null;
  if (ctx.level < 0.5) {
    const limit = Math.max(1, Math.ceil(ctx.level * 10));
    return (
      `[沉浸 mix lv=${ctx.level.toFixed(2)}] 你的回答中可以适当夹带至多 ${limit} 个 ${lang} 已学单词，` +
      `括号内加注音和中文翻译。例：「这个 bug 已经修了（直しました：fixed it）。」`
    );
    // TODO(Phase 1.1b): swap to `lt mix-vocab --limit N --json` for real
    // 80/20 mastered/weak pool (v3 D19b ambient engine).
  }
  if (ctx.level < 1.0) {
    return (
      `[沉浸 lv=0.50 双语句法] 在你的回答中，短句尾部用一句完整的 ${lang}，再附中文翻译。` +
      `例：「这个 bug 修了。直しました（fixed it）。」`
    );
  }
  return (
    `[沉浸 lv=1.00 全沉浸] 全部用 ${lang}（含 furigana 假名注音），` +
    `中文译文附在每段末尾。`
  );
}
