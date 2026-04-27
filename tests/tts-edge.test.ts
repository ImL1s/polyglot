import { describe, test, expect } from "bun:test";
import {
  speak,
  LANG_TO_VOICE_EDGE,
  getEdgeVoice,
  type SpawnFn,
} from "../src/tts.ts";
import { patchProfile, readProfile } from "../src/profile.ts";

/**
 * Edge-tts (Linux fallback) tests live in this file separately from the
 * existing tts.test.ts so the macOS-vs-edge contract is easy to read in one
 * place. We rely on captured spawn (no real edge-tts subprocess) so CI on
 * machines without edge-tts installed still passes.
 */
function captureSpawn(): { calls: string[][]; spawn: SpawnFn } {
  const calls: string[][] = [];
  const spawn: SpawnFn = (cmd) => {
    calls.push(cmd);
    return { exited: Promise.resolve(0) };
  };
  return { calls, spawn };
}

async function withEngine<T>(engine: string, fn: () => Promise<T>): Promise<T> {
  const before = readProfile().tts_engine;
  patchProfile({ tts_engine: engine });
  try {
    return await fn();
  } finally {
    patchProfile({ tts_engine: before });
  }
}

describe("LANG_TO_VOICE_EDGE", () => {
  test("includes ja, ko, en, zh as planner spec required", () => {
    expect(LANG_TO_VOICE_EDGE.ja).toBe("ja-JP-NanamiNeural");
    expect(LANG_TO_VOICE_EDGE.ko).toBe("ko-KR-SunHiNeural");
    expect(LANG_TO_VOICE_EDGE.en).toBe("en-US-JennyNeural");
    expect(LANG_TO_VOICE_EDGE.zh).toBe("zh-CN-XiaoxiaoNeural");
  });

  test("getEdgeVoice returns the table value for a supported language", () => {
    expect(getEdgeVoice("ja")).toBe("ja-JP-NanamiNeural");
    expect(getEdgeVoice("ko")).toBe("ko-KR-SunHiNeural");
  });

  test("getEdgeVoice returns undefined for unsupported language", () => {
    expect(getEdgeVoice("fr")).toBeUndefined();
    expect(getEdgeVoice("")).toBeUndefined();
  });
});

describe("speak() edge backend auto-resolves voice from LANG_TO_VOICE_EDGE", () => {
  test("ja with no override → ja-JP-NanamiNeural", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("edge", () =>
      speak("猫", "ja", { spawn, rate: 180 }),
    );
    expect(result.engine).toBe("edge");
    expect(result.voice).toBe("ja-JP-NanamiNeural");
    expect(calls[0]).toEqual([
      "edge-tts",
      "--voice",
      "ja-JP-NanamiNeural",
      "--text",
      "猫",
    ]);
  });

  test("ko with no override → ko-KR-SunHiNeural (different from macos Yuna)", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("edge", () => speak("고양이", "ko", { spawn, rate: 180 }));
    expect(calls[0]).toEqual([
      "edge-tts",
      "--voice",
      "ko-KR-SunHiNeural",
      "--text",
      "고양이",
    ]);
  });

  test("explicit voice override beats LANG_TO_VOICE_EDGE default", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("edge", () =>
      speak("hello", "en", { spawn, voice: "en-GB-SoniaNeural", rate: 180 }),
    );
    expect(calls[0]).toEqual([
      "edge-tts",
      "--voice",
      "en-GB-SoniaNeural",
      "--text",
      "hello",
    ]);
  });

  test("profile.tts_voice_overrides[lang] beats edge default", async () => {
    const before = readProfile();
    patchProfile({ tts_voice_overrides: { ja: "ja-JP-KeitaNeural" } });
    try {
      const { calls, spawn } = captureSpawn();
      await withEngine("edge", () => speak("猫", "ja", { spawn, rate: 180 }));
      expect(calls[0]).toEqual([
        "edge-tts",
        "--voice",
        "ja-JP-KeitaNeural",
        "--text",
        "猫",
      ]);
    } finally {
      patchProfile({ tts_voice_overrides: before.tts_voice_overrides });
    }
  });

  test("edge engine + unsupported language → silent skip (reason=unsupported-language)", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("edge", () =>
      speak("bonjour", "fr", { spawn, rate: 180 }),
    );
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("unsupported-language");
    expect(calls).toHaveLength(0);
  });
});

describe("macos vs edge voice tables stay independent", () => {
  test("macos engine resolves ja → Kyoko (not ja-JP-NanamiNeural)", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("macos", () => speak("猫", "ja", { spawn, rate: 180 }));
    expect(calls[0]).toEqual(["say", "-v", "Kyoko", "-r", "180", "猫"]);
  });

  test("edge engine resolves ja → ja-JP-NanamiNeural (not Kyoko)", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("edge", () => speak("猫", "ja", { spawn, rate: 180 }));
    expect(calls[0]).toEqual([
      "edge-tts",
      "--voice",
      "ja-JP-NanamiNeural",
      "--text",
      "猫",
    ]);
  });
});
