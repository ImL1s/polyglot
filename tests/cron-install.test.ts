import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderPlist, findPlistTemplate } from "../src/cli.ts";

const TEMPLATE_PATH = join(import.meta.dir, "..", "templates", "com.polyglot.daily.plist");

describe("plist template", () => {
  test("template file exists at templates/com.polyglot.daily.plist", () => {
    expect(existsSync(TEMPLATE_PATH)).toBe(true);
  });

  test("template contains the expected placeholders", () => {
    const tpl = readFileSync(TEMPLATE_PATH, "utf-8");
    expect(tpl).toContain("${LT_BIN}");
    expect(tpl).toContain("${HOUR}");
    expect(tpl).toContain("${MINUTE}");
    expect(tpl).toContain("<string>com.polyglot.daily</string>");
  });

  test("findPlistTemplate resolves to the repo template when run from src/", () => {
    expect(findPlistTemplate()).toBe(TEMPLATE_PATH);
  });
});

describe("renderPlist", () => {
  const tpl = readFileSync(TEMPLATE_PATH, "utf-8");

  test("substitutes LT_BIN, HOUR, MINUTE into template", () => {
    const out = renderPlist(tpl, { LT_BIN: "/Users/me/.local/bin/lt", HOUR: 9, MINUTE: 30 });
    expect(out).toContain("<string>/Users/me/.local/bin/lt</string>");
    expect(out).toContain("<integer>9</integer>");
    expect(out).toContain("<integer>30</integer>");
    expect(out).not.toContain("${LT_BIN}");
    expect(out).not.toContain("${HOUR}");
    expect(out).not.toContain("${MINUTE}");
  });

  test("uses new Label com.polyglot.daily, not legacy com.jp-trainer.daily", () => {
    const out = renderPlist(tpl, { LT_BIN: "/x", HOUR: 0, MINUTE: 0 });
    expect(out).toContain("<string>com.polyglot.daily</string>");
    expect(out).not.toContain("com.jp-trainer.daily");
  });

  test("preserves XML structure (declaration + plist + dict)", () => {
    const out = renderPlist(tpl, { LT_BIN: "/x", HOUR: 7, MINUTE: 0 });
    expect(out).toMatch(/^<\?xml version="1\.0"/);
    expect(out).toContain("<plist version=\"1.0\">");
    expect(out).toContain("<key>ProgramArguments</key>");
    expect(out).toContain("<key>StartCalendarInterval</key>");
    expect(out).toContain("<key>Hour</key>");
    expect(out).toContain("<key>Minute</key>");
  });

  test("handles edge values (0, 23, 59)", () => {
    const out = renderPlist(tpl, { LT_BIN: "/x", HOUR: 23, MINUTE: 59 });
    expect(out).toContain("<integer>23</integer>");
    expect(out).toContain("<integer>59</integer>");
    const out2 = renderPlist(tpl, { LT_BIN: "/x", HOUR: 0, MINUTE: 0 });
    expect(out2).toContain("<integer>0</integer>");
  });
});
