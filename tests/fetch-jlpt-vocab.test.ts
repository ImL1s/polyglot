import { describe, test, expect } from "bun:test";
import { readingToRomaji, slugify, katakanaToHiragana } from "../scripts/fetch-jlpt-vocab.ts";

// Concept ids embed the romanized reading: "ja-vocab-n3-benkyou".
// Stability of these ids matters because user FSRS state in reviews.db is
// keyed by id; if a re-import slugifies the same reading differently, the
// existing study history would orphan. Lock down the rules.
describe("hiragana → romaji slug", () => {
  describe("basic gojuon", () => {
    test("plain row", () => {
      expect(readingToRomaji("あいうえお")).toBe("aiueo");
      expect(readingToRomaji("かきくけこ")).toBe("kakikukeko");
      expect(readingToRomaji("さしすせそ")).toBe("sashisuseso");
      expect(readingToRomaji("たちつてと")).toBe("tachitsuteto");
      expect(readingToRomaji("なにぬねの")).toBe("naninuneno");
      expect(readingToRomaji("はひふへほ")).toBe("hahifuheho");
    });

    test("voiced (dakuten)", () => {
      expect(readingToRomaji("がぎぐげご")).toBe("gagigugego");
      expect(readingToRomaji("ざじずぜぞ")).toBe("zajizuzezo");
      expect(readingToRomaji("だぢづでど")).toBe("dajizudedo");
      expect(readingToRomaji("ばびぶべぼ")).toBe("babibubebo");
    });

    test("semi-voiced (handakuten)", () => {
      expect(readingToRomaji("ぱぴぷぺぽ")).toBe("papipupepo");
    });
  });

  describe("yōon (拗音 — small ya/yu/yo)", () => {
    test("kya / kyu / kyo", () => {
      expect(readingToRomaji("きゃ")).toBe("kya");
      expect(readingToRomaji("きゅ")).toBe("kyu");
      expect(readingToRomaji("きょ")).toBe("kyo");
    });

    test("benkyou (勉強)", () => {
      expect(readingToRomaji("べんきょう")).toBe("benkyou");
    });

    test("sha / shu / sho", () => {
      expect(readingToRomaji("しゃ")).toBe("sha");
      expect(readingToRomaji("しゅ")).toBe("shu");
      expect(readingToRomaji("しょ")).toBe("sho");
    });

    test("cha / chu / cho", () => {
      expect(readingToRomaji("ちゃ")).toBe("cha");
      expect(readingToRomaji("ちゅ")).toBe("chu");
      expect(readingToRomaji("ちょ")).toBe("cho");
    });

    test("ja / ju / jo", () => {
      expect(readingToRomaji("じゃ")).toBe("ja");
      expect(readingToRomaji("じゅ")).toBe("ju");
      expect(readingToRomaji("じょ")).toBe("jo");
    });
  });

  describe("sokuon (促音 — small tsu doubles next consonant)", () => {
    test("gakkou (学校)", () => {
      // がっこう: ga + small-tsu doubles k of kou → "gakkou"
      expect(readingToRomaji("がっこう")).toBe("gakkou");
    });

    test("zasshi (雑誌)", () => {
      // ざっし: za + small-tsu doubles s of shi → "zasshi"
      expect(readingToRomaji("ざっし")).toBe("zasshi");
    });

    test("kitte (切手)", () => {
      expect(readingToRomaji("きって")).toBe("kitte");
    });

    test("trailing small tsu (no following char) is silently dropped", () => {
      // edge case: 「あっ」 — just "a" since っ has nothing to double
      expect(readingToRomaji("あっ")).toBe("a");
    });
  });

  describe("hatsuon (撥音 — n)", () => {
    test("standalone ん", () => {
      expect(readingToRomaji("ほん")).toBe("hon");
      expect(readingToRomaji("にほん")).toBe("nihon");
    });

    test("ん before vowel — keeps simple n (we don't disambiguate n' here)", () => {
      // この slug 化函数不做 n+vowel 二义性消歧（kani vs kan'i），
      // 当作 simple n 拼接，因为 id 只要 stable 不需要 phonetic 准确
      expect(readingToRomaji("かんい")).toBe("kani");
    });
  });

  describe("katakana → hiragana fallback", () => {
    test("simple katakana", () => {
      expect(katakanaToHiragana("カタカナ")).toBe("かたかな");
    });

    test("readingToRomaji handles katakana input", () => {
      expect(readingToRomaji("コンピューター")).toMatch(/^konpyu/);
    });

    test("mixed kana", () => {
      expect(katakanaToHiragana("ガクセイ")).toBe("がくせい");
    });
  });

  describe("noise stripping", () => {
    test("leading tilde (〜)", () => {
      expect(readingToRomaji("〜やすい")).toBe("yasui");
    });

    test("ASCII tilde (~)", () => {
      expect(readingToRomaji("~です")).toBe("desu");
    });

    test("parens / brackets / punctuation", () => {
      expect(readingToRomaji("ね（よ）")).toBe("neyo");
      expect(readingToRomaji("こ・れ")).toBe("kore");
      expect(readingToRomaji("な、に")).toBe("nani");
    });

    test("whitespace", () => {
      expect(readingToRomaji("こ ん にち は")).toBe("konnichiha");
    });

    test("kanji embedded in reading is silently skipped", () => {
      // (occasionally egg rolls reading column has stray kanji);
      // we drop unknown chars rather than crashing.
      expect(readingToRomaji("べん強きょう")).toBe("benkyou");
    });
  });

  describe("slugify fallback", () => {
    test("normal reading produces romaji", () => {
      expect(slugify("べんきょう", "勉強")).toBe("benkyou");
    });

    test("empty / unmappable reading falls back to hex of kanji bytes", () => {
      // when the reading is purely non-kana noise, slugify falls back to
      // a hex encoding of the kanji form so we still get a stable, unique id.
      const result = slugify("(_)", "高校");
      // "(_)" → all stripped → "" → falls back to hex of "高校" (utf-8) prefix
      expect(result).toMatch(/^[0-9a-f]+$/);
      expect(result.length).toBeLessThanOrEqual(16);
    });

    test("two different kanji produce two different fallback slugs", () => {
      const a = slugify("", "学校");
      const b = slugify("", "病院");
      expect(a).not.toBe(b);
    });
  });

  describe("real-world JLPT samples (regression lock)", () => {
    test("各 vocab id stays stable under the current rules", () => {
      const samples: Array<[string, string]> = [
        ["こうこう", "koukou"],     // 高校
        ["まる", "maru"],           // 丸
        ["とう", "tou"],            // 党
        ["りけい", "rikei"],        // 理系
        ["せんせい", "sensei"],     // 先生
        ["がくせい", "gakusei"],    // 学生
        ["みず", "mizu"],           // 水
        ["でんしゃ", "densha"],     // 電車
        ["がっこう", "gakkou"],     // 学校
        ["ありがとう", "arigatou"], // ありがとう
      ];
      for (const [reading, expected] of samples) {
        expect(readingToRomaji(reading)).toBe(expected);
      }
    });
  });
});
