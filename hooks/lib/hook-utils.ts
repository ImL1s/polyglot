import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

/**
 * Locate the lt binary. Prefer the compiled binary in ~/.local/bin/lt; fall
 * back to running src/cli.ts under bun for local dev.
 */
function ltCommand(): { cmd: string; prefix: string[] } {
  const compiled = join(homedir(), ".local", "bin", "lt");
  if (existsSync(compiled)) return { cmd: compiled, prefix: [] };
  const repoCli = join(import.meta.dir, "..", "..", "src", "cli.ts");
  return { cmd: "bun", prefix: [repoCli] };
}

export function runLt(args: string[], timeoutMs = 3000): { stdout: string; stderr: string; code: number } {
  const { cmd, prefix } = ltCommand();
  const res = spawnSync(cmd, [...prefix, ...args], { encoding: "utf-8", timeout: timeoutMs });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    code: typeof res.status === "number" ? res.status : 1,
  };
}

/** Emit a Claude Code hookSpecificOutput JSON line. Empty ctx = no inject. */
export function emitContext(eventName: string, additionalContext: string): void {
  if (!additionalContext) {
    process.stdout.write("{}");
    return;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  }));
}

export async function readStdinJson<T = Record<string, unknown>>(): Promise<T | null> {
  try {
    if (process.stdin.isTTY) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
    const raw = Buffer.concat(chunks).toString("utf-8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// Legacy alias retained for stop.ts compatibility.
export const readHookPayload = readStdinJson;
