import { describe, test, expect } from "bun:test";
import { buildImmersionPrompt, type ImmersionContext } from "../src/utils/immersion.ts";
import { looksLikeCodeContext, looksLikeCodeContextStrict } from "../src/utils/code-context.ts";

/**
 * Task 6 — immersion_level four-branch wire test.
 *
 * Spec (v3 Critic Q5 0.50 重定义):
 *   level = 0          → no inject (silent)
 *   0 < level < 0.50   → ambient mix prompt with limit = ceil(level * 10)
 *   level = 0.50       → 双语句法混合 (短句尾整句日语 + 中文翻译)
 *   level >= 1.00      → 全沉浸 (全部目标语言 + furigana + 译文)
 *
 * Plus:
 *   - looksLikeCodeContext(input)=true → injection suppressed regardless of level
 *   - active_language placeholder defaults to "ja"; override when caller asks
 */

describe("buildImmersionPrompt — four branches (Critic Q5)", () => {
  test("level=0 → null (off)", () => {
    const ctx: ImmersionContext = { level: 0, language: "ja", isCode: false };
    expect(buildImmersionPrompt(ctx)).toBeNull();
  });

  test("level=0.10 → ambient mix, limit=1", () => {
    const out = buildImmersionPrompt({ level: 0.1, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("[沉浸 mix lv=0.10]");
    expect(out).toContain("至多 1 个 ja");
    expect(out).toContain("括号内加注音");
  });

  test("level=0.25 → ambient mix, limit=3", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("至多 3 个 ja");
  });

  test("level=0.49 → still ambient mix branch (limit=5)", () => {
    const out = buildImmersionPrompt({ level: 0.49, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("至多 5 个 ja");
    expect(out).not.toContain("双语句法");
  });

  test("level=0.50 → 双语句法混合 (Q5 重定义)", () => {
    const out = buildImmersionPrompt({ level: 0.5, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("[沉浸 lv=0.50 双语句法]");
    expect(out).toContain("短句尾部用一句完整的 ja");
    expect(out).toContain("中文翻译");
    expect(out).not.toContain("至多");
  });

  test("level=0.75 → still 双语句法 (between 0.5 and 1.0)", () => {
    const out = buildImmersionPrompt({ level: 0.75, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("[沉浸 lv=0.50 双语句法]");
  });

  test("level=1.00 → 全沉浸 (D6 originally)", () => {
    const out = buildImmersionPrompt({ level: 1.0, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("[沉浸 lv=1.00 全沉浸]");
    expect(out).toContain("furigana");
    expect(out).toContain("中文译文");
  });

  test("level=1.5 (clamp upward) → still 全沉浸 branch", () => {
    const out = buildImmersionPrompt({ level: 1.5, language: "ja", isCode: false });
    expect(out).not.toBeNull();
    expect(out).toContain("全沉浸");
  });

  test("active_language=ko → prompt mentions ko", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "ko", isCode: false });
    expect(out).toContain("ko");
  });

  test("active_language='' (empty) → falls back to ja", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "", isCode: false });
    expect(out).toContain("ja");
  });
});

describe("buildImmersionPrompt — code context whitelist (Adjustment K)", () => {
  test("isCode=true + level=1.0 → null (suppressed)", () => {
    const out = buildImmersionPrompt({ level: 1.0, language: "ja", isCode: true });
    expect(out).toBeNull();
  });

  test("isCode=true + level=0.25 → null", () => {
    const out = buildImmersionPrompt({ level: 0.25, language: "ja", isCode: true });
    expect(out).toBeNull();
  });

  test("isCode=true + level=0 → null (already null, but consistency check)", () => {
    const out = buildImmersionPrompt({ level: 0, language: "ja", isCode: true });
    expect(out).toBeNull();
  });
});

describe("looksLikeCodeContext — D19 ambient gating", () => {
  test("triple backtick fence → code", () => {
    expect(looksLikeCodeContext("帮我看下这段：\n```ts\nconst a = 1;\n```")).toBe(true);
  });

  test("import statement → code", () => {
    expect(looksLikeCodeContext("import { foo } from 'bar';")).toBe(true);
  });

  test("function declaration → code", () => {
    expect(looksLikeCodeContext("function double(n) { return n*2; }")).toBe(true);
  });

  test("class declaration → code", () => {
    expect(looksLikeCodeContext("class Foo extends Bar {}")).toBe(true);
  });

  test("dart file path → code", () => {
    expect(looksLikeCodeContext("看一下 main.dart")).toBe(true);
  });

  test(".py extension reference → code", () => {
    expect(looksLikeCodeContext("跑下 train.py 的 loss")).toBe(true);
  });

  test("def keyword → code", () => {
    expect(looksLikeCodeContext("def hello(): pass")).toBe(true);
  });

  test("plain Chinese question → not code", () => {
    expect(looksLikeCodeContext("今天天气怎么样？")).toBe(false);
  });

  test("英文 plain question → not code", () => {
    expect(looksLikeCodeContext("What's the weather like in Kyoto today?")).toBe(false);
  });

  test("mixed prose with no code markers → not code", () => {
    expect(looksLikeCodeContext("我刚刚在思考，是不是该买新键盘了。")).toBe(false);
  });
});

describe("looksLikeCodeContextStrict — broader detection", () => {
  test("inline backtick code → strict matches", () => {
    expect(looksLikeCodeContext("用 `tar -xf` 解压")).toBe(false);
    expect(looksLikeCodeContextStrict("用 `tar -xf` 解压")).toBe(true);
  });

  test("URL → strict matches", () => {
    expect(looksLikeCodeContextStrict("https://example.com 这个链接打不开")).toBe(true);
  });

  test("shell prompt → strict matches", () => {
    expect(looksLikeCodeContextStrict("$ ls -la")).toBe(true);
  });

  test("plain prose → strict still false", () => {
    expect(looksLikeCodeContextStrict("今天去吃拉面")).toBe(false);
  });
});
