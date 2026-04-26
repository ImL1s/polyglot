import { describe, test, expect } from "bun:test";
import { detectShape, alreadyInstalled, buildEntryFlat, buildEntryNested } from "../scripts/install-hooks.mjs";

describe("install-hooks.mjs schema detection (Adj-A)", () => {
  test("empty array → 'empty'", () => {
    expect(detectShape([])).toBe("empty");
  });

  test("flat-only → 'flat'", () => {
    expect(detectShape([{ matcher: "*", command: "/bin/echo hi" }])).toBe("flat");
  });

  test("nested-only → 'nested'", () => {
    expect(detectShape([{ matcher: "*", hooks: [{ type: "command", command: "/bin/echo hi" }] }])).toBe("nested");
  });

  test("mixed → 'mixed'", () => {
    expect(detectShape([
      { matcher: "*", command: "/bin/echo a" },
      { matcher: "*", hooks: [{ type: "command", command: "/bin/echo b" }] },
    ])).toBe("mixed");
  });

  test("non-array input → 'empty'", () => {
    // @ts-expect-error — checking defensive behavior
    expect(detectShape(null)).toBe("empty");
  });
});

describe("install-hooks.mjs alreadyInstalled idempotency", () => {
  test("recognizes existing polyglot-hooks flat entry → skip", () => {
    const arr = [
      { matcher: "*", command: "bash /Users/x/.claude/polyglot-hooks/stop.sh" },
    ];
    expect(alreadyInstalled(arr, "stop.sh")).toBe(true);
  });

  test("recognizes existing polyglot-hooks nested entry → skip", () => {
    const arr = [
      { matcher: "*", hooks: [{ type: "command", command: "bash /Users/x/.claude/polyglot-hooks/post-tool-use.sh" }] },
    ];
    expect(alreadyInstalled(arr, "post-tool-use.sh")).toBe(true);
  });

  test("unrelated hook → not installed", () => {
    const arr = [
      { matcher: "*", command: "bash ~/.claude/other-tool/hook.sh" },
    ];
    expect(alreadyInstalled(arr, "stop.sh")).toBe(false);
  });

  test("script substring must match exactly (no false positives)", () => {
    const arr = [
      { matcher: "*", command: "bash ~/.claude/polyglot-hooks/post-tool-use.sh" },
    ];
    // looking for stop.sh should not match because the entry is for post-tool-use.sh
    expect(alreadyInstalled(arr, "stop.sh")).toBe(false);
  });
});

describe("install-hooks.mjs entry builders", () => {
  test("buildEntryFlat shape", () => {
    const e = buildEntryFlat("*", "stop.sh");
    expect(e.matcher).toBe("*");
    expect(typeof e.command).toBe("string");
    expect(e.command).toContain("polyglot-hooks");
    expect(e.command).toContain("stop.sh");
  });

  test("buildEntryNested shape includes type+timeout", () => {
    const e = buildEntryNested("*", "stop.sh");
    expect(e.matcher).toBe("*");
    expect(Array.isArray(e.hooks)).toBe(true);
    expect(e.hooks[0].type).toBe("command");
    expect(typeof e.hooks[0].command).toBe("string");
    expect(typeof e.hooks[0].timeout).toBe("number");
  });
});
