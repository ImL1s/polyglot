import { describe, test, expect } from "bun:test";
import { speak, buildSpeakBundle, LANG_TO_VOICE, type SpawnFn } from "../src/tts.ts";
import { patchProfile, readProfile } from "../src/profile.ts";

/**
 * TTS dispatch tests rely on injecting a fake `spawn` so we never run real
 * `say` / `edge-tts` processes during CI. All tests assert the command line
 * the dispatcher would have run, plus the silent-skip paths required by D13.
 *
 * Tests temporarily mutate profile.tts_engine via patchProfile() and restore
 * it in finally{} so the harness leaves no bleed-through state for the rest
 * of the suite.
 */
function captureSpawn(): { calls: string[][]; spawn: SpawnFn; throwsENOENT: SpawnFn } {
  const calls: string[][] = [];
  const spawn: SpawnFn = (cmd) => {
    calls.push(cmd);
    return { exited: Promise.resolve(0) };
  };
  const throwsENOENT: SpawnFn = (cmd) => {
    calls.push(cmd);
    const err = new Error("spawn say ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    throw err;
  };
  return { calls, spawn, throwsENOENT };
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

describe("LANG_TO_VOICE", () => {
  test("includes ja, ko, en, zh, es", () => {
    expect(LANG_TO_VOICE.ja).toBe("Kyoko");
    expect(LANG_TO_VOICE.ko).toBe("Yuna");
    expect(LANG_TO_VOICE.en).toBe("Samantha");
    expect(LANG_TO_VOICE.zh).toBe("Tingting");
    expect(LANG_TO_VOICE.es).toBe("Mónica");
  });
});

describe("speak() macos backend", () => {
  test("dispatches `say -v <voice> -r <rate> <text>` for ja", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("macos", () =>
      speak("猫", "ja", { spawn, rate: 200 }),
    );
    expect(result.engine).toBe("macos");
    expect(result.spawned).toBe(true);
    expect(result.voice).toBe("Kyoko");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["say", "-v", "Kyoko", "-r", "200", "猫"]);
  });

  test("picks Yuna voice for ko", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("macos", () => speak("고양이", "ko", { spawn, rate: 180 }));
    expect(calls[0]).toEqual(["say", "-v", "Yuna", "-r", "180", "고양이"]);
  });

  test("respects voice override option over LANG_TO_VOICE", async () => {
    const { calls, spawn } = captureSpawn();
    await withEngine("macos", () =>
      speak("hello", "en", { spawn, voice: "Daniel", rate: 180 }),
    );
    expect(calls[0]).toEqual(["say", "-v", "Daniel", "-r", "180", "hello"]);
  });

  test("ENOENT on spawn → silent skip with reason=spawn-error", async () => {
    const { throwsENOENT } = captureSpawn();
    const result = await withEngine("macos", () =>
      speak("猫", "ja", { spawn: throwsENOENT }),
    );
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("spawn-error");
    expect(result.engine).toBe("macos");
  });

  test("blocking=true awaits the spawned process", async () => {
    let resolved = false;
    const spawn: SpawnFn = () => ({
      exited: new Promise<number>((r) => setTimeout(() => { resolved = true; r(0); }, 10)),
    });
    const result = await withEngine("macos", () =>
      speak("猫", "ja", { spawn, blocking: true, rate: 180 }),
    );
    expect(result.spawned).toBe(true);
    expect(resolved).toBe(true);
  });

  test("blocking=false returns immediately without awaiting", async () => {
    const spawn: SpawnFn = () => ({
      exited: new Promise<number>(() => { /* never resolves */ }),
    });
    const start = Date.now();
    const result = await withEngine("macos", () =>
      speak("猫", "ja", { spawn, blocking: false, rate: 180 }),
    );
    const elapsed = Date.now() - start;
    expect(result.spawned).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("speak() edge backend", () => {
  test("dispatches `edge-tts --voice <voice> --text <text>`", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("edge", () =>
      speak("猫", "ja", { spawn, voice: "ja-JP-NanamiNeural", rate: 180 }),
    );
    expect(result.engine).toBe("edge");
    expect(result.spawned).toBe(true);
    expect(calls[0]).toEqual(["edge-tts", "--voice", "ja-JP-NanamiNeural", "--text", "猫"]);
  });

  test("ENOENT on edge-tts → silent skip", async () => {
    const { throwsENOENT } = captureSpawn();
    const result = await withEngine("edge", () =>
      speak("猫", "ja", { spawn: throwsENOENT, voice: "x", rate: 180 }),
    );
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("spawn-error");
  });
});

describe("speak() none backend", () => {
  test("returns engine=none without spawning", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("none", () => speak("猫", "ja", { spawn }));
    expect(result.engine).toBe("none");
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("engine-none");
    expect(calls).toHaveLength(0);
  });
});

describe("speak() guards", () => {
  test("empty text → engine=skip without spawning", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("macos", () => speak("   ", "ja", { spawn }));
    expect(result.engine).toBe("skip");
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("empty-text");
    expect(calls).toHaveLength(0);
  });

  test("unsupported language → silent skip with reason=unsupported-language", async () => {
    const { calls, spawn } = captureSpawn();
    const result = await withEngine("macos", () =>
      speak("hello", "fr", { spawn, rate: 180 }),
    );
    expect(result.spawned).toBe(false);
    expect(result.reason).toBe("unsupported-language");
    expect(calls).toHaveLength(0);
  });
});

describe("buildSpeakBundle()", () => {
  test("returns headword/reading/example fields when present", () => {
    const concept = {
      ja: "猫",
      reading: "ねこ",
      examples: [{ ja: "猫が好きです", zh: "我喜欢猫" }],
    };
    const bundle = buildSpeakBundle(concept);
    expect(bundle).toEqual({
      headword: "猫",
      reading: "ねこ",
      example: "猫が好きです",
    });
  });

  test("omits reading/example when absent", () => {
    const concept = { ja: "犬", reading: null, examples: [] };
    const bundle = buildSpeakBundle(concept);
    expect(bundle).toEqual({ headword: "犬" });
  });

  test("returns null when ja is empty", () => {
    const concept = { ja: "", reading: null, examples: [] };
    expect(buildSpeakBundle(concept)).toBeNull();
  });
});

describe("tts_voice_overrides profile field", () => {
  test("override beats LANG_TO_VOICE default", async () => {
    const { calls, spawn } = captureSpawn();
    const before = readProfile();
    patchProfile({ tts_voice_overrides: { ja: "Otoya" } });
    try {
      await withEngine("macos", () => speak("猫", "ja", { spawn, rate: 180 }));
      expect(calls[0]).toEqual(["say", "-v", "Otoya", "-r", "180", "猫"]);
    } finally {
      patchProfile({ tts_voice_overrides: before.tts_voice_overrides });
    }
  });
});
