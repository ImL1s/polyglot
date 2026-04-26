import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

/**
 * Hook shell pre-gate distribution test (Adjustment D).
 *
 * Spec: hooks/stop.sh reads inject_rate from $HOME/.config/polyglot/profile.yaml
 * and rolls awk srand(rand()) on each invocation. Aggregated over N samples,
 * the empirical pass-rate must roughly match the target ± tolerance.
 *
 * We isolate HOME to a tmpdir, write a known profile.yaml, and replace the
 * heavy bun stage with a no-op trampoline so we can sample dice exits cheaply.
 */

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const SRC_STOP_SH = join(REPO_ROOT, "hooks", "stop.sh");

let tmp: string;
let stopShPath: string;

beforeEach(() => {
  tmp = join(tmpdir(), `polyglot-pregate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(tmp, ".config", "polyglot"), { recursive: true });
  mkdirSync(join(tmp, ".local", "bin"), { recursive: true });
  mkdirSync(join(tmp, "hooks"), { recursive: true });
  // Stub binary so the shell script doesn't fall through to the dev fallback
  // path that calls real bun + cli.ts.
  const stubLt = join(tmp, ".local", "bin", "lt");
  writeFileSync(stubLt, "#!/bin/bash\nexit 0\n", "utf-8");
  chmodSync(stubLt, 0o755);
  // Stub bun trampoline target. The real shell calls
  // `exec bun "$HOOKS_DIR/stop.ts"` after the gate passes — replace stop.ts
  // with a no-op shell file invoked through a wrapper that exits 42 so we
  // can detect "gate passed".
  const passedMarker = join(tmp, "hooks", "stop.ts");
  writeFileSync(passedMarker, "exit 42\n", "utf-8");
  chmodSync(passedMarker, 0o755);
  stopShPath = join(tmp, "hooks", "stop.sh");
  // Generate an isolated copy of stop.sh that points HOOKS_DIR at our tmp
  // hooks dir and skips the bun+cli.ts dev fallback branch (always uses the
  // stub lt binary above).
  const original = require("node:fs").readFileSync(SRC_STOP_SH, "utf-8") as string;
  const isolated = original
    .replace(
      'PROFILE="$HOME/.config/polyglot/profile.yaml"',
      `PROFILE="${tmp}/.config/polyglot/profile.yaml"`,
    )
    .replace(
      'LT_BIN="$HOME/.local/bin/lt"',
      `LT_BIN="${tmp}/.local/bin/lt"`,
    )
    .replace(
      /HOOKS_DIR="\$HOME\/\.claude\/jp-trainer-hooks"\n\[ ! -d "\$HOOKS_DIR" \] && HOOKS_DIR="[^"]+"/,
      `HOOKS_DIR="${tmp}/hooks"`,
    )
    // The stop.ts trampoline above is a sh script with `exit 42`; invoke via
    // sh, not bun, so we don't depend on the user's bun PATH.
    .replace('exec bun "$HOOKS_DIR/stop.ts" <&3', `exec sh "$HOOKS_DIR/stop.ts" <&3`);
  writeFileSync(stopShPath, isolated, "utf-8");
  chmodSync(stopShPath, 0o755);
});

afterEach(() => {
  if (tmp && existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
});

function runShell(rolls: number): { passed: number; bailed: number } {
  let passed = 0;
  let bailed = 0;
  for (let i = 0; i < rolls; i++) {
    const res = spawnSync("/bin/bash", [stopShPath], {
      env: { ...process.env, HOME: tmp, RANDOM: String(Math.floor(Math.random() * 65535)) },
      stdio: ["ignore", "ignore", "ignore"],
    });
    if (res.status === 42) passed++;
    else bailed++;
  }
  return { passed, bailed };
}

describe("hook shell pre-gate (Adjustment D)", () => {
  test("inject_rate=0 → 0 passes (gate always bails)", () => {
    writeFileSync(
      join(tmp, ".config", "polyglot", "profile.yaml"),
      "inject_rate: 0\nrespect_work_hours: false\n",
      "utf-8",
    );
    const { passed } = runShell(50);
    expect(passed).toBe(0);
  });

  test("inject_rate=1 → 100% passes (gate always lets through)", () => {
    writeFileSync(
      join(tmp, ".config", "polyglot", "profile.yaml"),
      "inject_rate: 1\nrespect_work_hours: false\n",
      "utf-8",
    );
    const { passed } = runShell(50);
    expect(passed).toBe(50);
  });

  test("inject_rate=0.5 → roughly half pass (broad tolerance, 80 rolls)", () => {
    writeFileSync(
      join(tmp, ".config", "polyglot", "profile.yaml"),
      "inject_rate: 0.5\nrespect_work_hours: false\n",
      "utf-8",
    );
    const N = 80;
    const { passed } = runShell(N);
    const empirical = passed / N;
    // awk srand($RANDOM) variance is high at small N; tolerance is wide enough
    // to absorb noise but narrow enough to fail if the gate is degenerately
    // always-pass (1.0) or always-fail (0.0).
    expect(empirical).toBeGreaterThan(0.20);
    expect(empirical).toBeLessThan(0.80);
  }, { timeout: 15000 });

  test("missing profile → exit 0 silently (no pass)", () => {
    // Don't write profile.yaml at all.
    const { passed } = runShell(20);
    expect(passed).toBe(0);
  });
});
