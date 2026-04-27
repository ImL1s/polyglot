import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { LOG_FILE } from "./paths.ts";
import { readProfile } from "./profile.ts";

// macOS `say` voices per supported language. Each voice ships with the OS so
// no install step is needed; if the user runs an older macOS missing one of
// these, `say` exits non-zero and we silent-skip (D13 silent-fail principle).
export const LANG_TO_VOICE: Record<string, string> = {
  ja: "Kyoko",
  ko: "Yuna",
  en: "Samantha",
  zh: "Tingting",
  es: "Mónica",
};

export type TtsEngine = "macos" | "edge" | "none";

export interface SpeakOptions {
  /** Override profile.tts_engine. */
  engine?: TtsEngine | string;
  /** Word rate (macOS `say -r`); default 180. */
  rate?: number;
  /** Voice override; if omitted, picks via LANG_TO_VOICE[language]. */
  voice?: string;
  /** Wait for the spawned process to exit; default false (fire-and-forget). */
  blocking?: boolean;
  /**
   * Spawn injection point. Defaults to Bun.spawn but tests pass a stub so we
   * can assert the command line without touching the real audio subsystem.
   */
  spawn?: SpawnFn;
}

export interface SpawnHandle {
  exited: Promise<number>;
}

export type SpawnFn = (cmd: string[]) => SpawnHandle;

export interface SpeakResult {
  /** Backend that handled the request (or "none"/"skip" for no-ops). */
  engine: string;
  /** Voice picked, if any (only for macos/edge). */
  voice?: string;
  /** Whether a process was actually spawned. */
  spawned: boolean;
  /** Reason field when spawned=false (no-text / unsupported-language / ENOENT / engine=none). */
  reason?: string;
}

const DEFAULT_RATE = 180;

function logEvent(event: Record<string, unknown>): void {
  try {
    if (!existsSync(dirname(LOG_FILE))) mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify({ ts: Date.now(), ...event }) + "\n", "utf-8");
  } catch {
    // best-effort; never fail TTS on log write
  }
}

function defaultSpawn(cmd: string[]): SpawnHandle {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return { exited: proc.exited };
}

/**
 * Resolve the voice for a language. Profile.tts_voice_overrides[lang] wins
 * over the built-in LANG_TO_VOICE table so users can swap to a preferred
 * accent (e.g. en → "Daniel" instead of "Samantha") without code changes.
 */
function resolveVoice(language: string, override?: string): string | undefined {
  if (override) return override;
  const profile = readProfile();
  const overrides = (profile as { tts_voice_overrides?: Record<string, string> }).tts_voice_overrides;
  if (overrides && overrides[language]) return overrides[language];
  return LANG_TO_VOICE[language];
}

/**
 * Speak `text` in `language` via the configured backend. Failures (engine
 * none / unsupported language / ENOENT on the backend binary) are
 * silent-skipped per D13 — TTS is a sidecar and must never break the answer
 * flow. Returns a result describing what happened for tests/observability.
 */
export async function speak(
  text: string,
  language: string,
  opts: SpeakOptions = {},
): Promise<SpeakResult> {
  if (!text || !text.trim()) {
    return { engine: "skip", spawned: false, reason: "empty-text" };
  }

  const profile = readProfile();
  const engine = (opts.engine ?? profile.tts_engine ?? "macos") as string;
  const rate = opts.rate ?? (profile as { tts_rate?: number }).tts_rate ?? DEFAULT_RATE;
  const spawn = opts.spawn ?? defaultSpawn;

  if (engine === "none") {
    return { engine: "none", spawned: false, reason: "engine-none" };
  }

  const voice = resolveVoice(language, opts.voice);
  if (!voice) {
    logEvent({ event: "tts_skip", reason: "unsupported-language", language, engine });
    return { engine, spawned: false, reason: "unsupported-language" };
  }

  let cmd: string[];
  if (engine === "macos") {
    cmd = ["say", "-v", voice, "-r", String(rate), text];
  } else if (engine === "edge") {
    // edge-tts exposes `--voice` as the full neural voice id. We pass the same
    // value the user configured via tts_voice_overrides[lang]; LANG_TO_VOICE
    // fallback works fine for macOS but edge-tts users should override (e.g.
    // ja → "ja-JP-NanamiNeural"). If they didn't, edge-tts will reject and
    // we'll silent-skip below.
    cmd = ["edge-tts", "--voice", voice, "--text", text];
  } else {
    logEvent({ event: "tts_skip", reason: "unknown-engine", engine });
    return { engine, spawned: false, reason: "unknown-engine" };
  }

  let handle: SpawnHandle;
  try {
    handle = spawn(cmd);
  } catch (err) {
    // ENOENT on `say` (Linux without macOS) or `edge-tts` (not pip-installed)
    // is the expected silent path.
    logEvent({
      event: "tts_skip",
      reason: "spawn-error",
      engine,
      voice,
      error: err instanceof Error ? err.message : String(err),
    });
    return { engine, voice, spawned: false, reason: "spawn-error" };
  }

  if (opts.blocking) {
    try {
      await handle.exited;
    } catch {
      // process crash is non-fatal
    }
  }

  return { engine, voice, spawned: true };
}

/**
 * Build the bundle a skill should TTS for a concept on a successful answer:
 * the headword + reading + first example. Caller picks how much of it to
 * speak (e.g. `--full` flag in `lt say`). Returns null when the concept has
 * no `ja`-equivalent head text (which shouldn't happen in seed data).
 */
export function buildSpeakBundle(concept: {
  ja: string;
  reading: string | null;
  examples: { ja: string; zh: string }[];
}): { headword: string; reading?: string; example?: string } | null {
  if (!concept.ja) return null;
  return {
    headword: concept.ja,
    reading: concept.reading ?? undefined,
    example: concept.examples.length > 0 ? concept.examples[0].ja : undefined,
  };
}
