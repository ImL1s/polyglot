#!/usr/bin/env bun
/**
 * Fetch and convert public-domain JLPT vocab into data/seeds/n{5..2}-vocab.yaml
 *
 * Sources:
 *   - 5mdld/anki-jlpt-decks (eggrolls JLPT 10k v3): kanji + reading + zh meaning + example
 *   - Bluskyo/JLPT_Vocabulary: kanji + reading + level (used to split N4+N5 deck)
 *
 * Both repos are publicly redistributable (Anki MIT-style sharing for eggrolls
 * deck, MIT for Bluskyo). We import only the fields we need.
 *
 * Usage:
 *   bun run scripts/fetch-jlpt-vocab.ts                 # fetch + write yaml
 *   bun run scripts/fetch-jlpt-vocab.ts --offline /tmp  # use cached CSVs in /tmp
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

const EGG_URL =
  "https://raw.githubusercontent.com/5mdld/anki-jlpt-decks/master/eggrolls-JLPT10k-v3/notes.csv";
const BLUSKYO_URL =
  "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/main/data/results/JLPTWords.csv";

const SEEDS_DIR = join(import.meta.dir, "..", "data", "seeds");

type Level = "N5" | "N4" | "N3" | "N2";

interface Seed {
  id: string;
  type: "vocab";
  level: Level;
  ja: string;
  reading?: string;
  zh: string;
  examples?: { ja: string; zh: string }[];
  pos?: string;
}

async function loadCsv(url: string, cachePath?: string): Promise<string> {
  if (cachePath && existsSync(cachePath)) {
    return readFileSync(cachePath, "utf-8");
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url}: ${r.status}`);
  const text = await r.text();
  if (cachePath) writeFileSync(cachePath, text, "utf-8");
  return text;
}

function buildBluskyoLevelMap(csv: string): Map<string, Level> {
  // Kanji,Reading,Level  (Level 1=N1 .. 5=N5)
  const map = new Map<string, Level>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    if (cols.length < 3) continue;
    const kanji = cols[0]?.trim();
    const lvl = cols[2]?.trim();
    if (!kanji || !lvl) continue;
    const numeric = parseInt(lvl, 10);
    const level: Level | null =
      numeric === 5 ? "N5" : numeric === 4 ? "N4" : numeric === 3 ? "N3" : numeric === 2 ? "N2" : null;
    if (!level) continue;
    // first occurrence wins (lowest level seen first, since Bluskyo orders by reading)
    if (!map.has(kanji)) map.set(kanji, level);
  }
  return map;
}

function deckToLevel(deck: string): Level | null {
  // examples:
  //   eggrolls-JLPT10k-v3::1-N4+N5
  //   eggrolls-JLPT10k-v3::2-N3::1-高频
  //   eggrolls-JLPT10k-v3::4-N1::3-低频
  if (deck.includes("1-N4+N5")) return "N5"; // default; will be split via bluskyo
  if (deck.includes("2-N3")) return "N3";
  if (deck.includes("3-N2")) return "N2";
  if (deck.includes("4-N1")) return null; // skip N1
  return null;
}

const HIRAGANA_TO_ROMAJI: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "wo", ん: "n",
  ゃ: "ya", ゅ: "yu", ょ: "yo", っ: "",
};

const KATAKANA_OFFSET = "ア".charCodeAt(0) - "あ".charCodeAt(0);

function katakanaToHiragana(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= "ァ".charCodeAt(0) && code <= "ヶ".charCodeAt(0)) {
      out += String.fromCharCode(code - KATAKANA_OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

function readingToRomaji(reading: string): string {
  // strip leading tilde / parenthetical / non-kana noise
  const cleaned = katakanaToHiragana(reading)
    .replace(/[〜~]/g, "")
    .replace(/[（）()【】\[\]・/／、，,。.\s]/g, "")
    .trim();
  if (!cleaned) return "";

  let out = "";
  const chars = [...cleaned];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1];
    // small ya/yu/yo combo
    if (next && (next === "ゃ" || next === "ゅ" || next === "ょ")) {
      const base = HIRAGANA_TO_ROMAJI[ch];
      const small = HIRAGANA_TO_ROMAJI[next];
      if (base && small) {
        // ki + ya -> kya
        out += base.replace(/i$/, "") + small;
        i++;
        continue;
      }
    }
    // sokuon (small tsu) doubles next consonant
    if (ch === "っ" && next) {
      const nr = HIRAGANA_TO_ROMAJI[next];
      if (nr) {
        out += nr[0] || "";
        continue;
      }
    }
    const r = HIRAGANA_TO_ROMAJI[ch];
    if (r !== undefined) {
      out += r;
    } else {
      // unknown char (kanji slipped in, etc.) — skip
    }
  }
  return out;
}

function slugify(reading: string, fallback: string): string {
  const r = readingToRomaji(reading);
  if (r) return r;
  // last resort: hash-like fallback (kanji bytes)
  return Buffer.from(fallback, "utf-8").toString("hex").slice(0, 16);
}

function parseEggCsv(tsv: string, levelMap: Map<string, Level>): Seed[] {
  const lines = tsv.split(/\r?\n/);
  const seeds: Seed[] = [];
  const seenIds = new Set<string>();
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 16) continue;
    const deck = cols[1] ?? "";
    const ja = cols[3]?.trim();
    const pos = cols[5]?.trim() || undefined;
    const reading = cols[6]?.trim();
    const zh = cols[7]?.trim();
    const exampleJa = cols[12]?.trim();
    const exampleZh = cols[14]?.trim();
    if (!ja || !reading || !zh) continue;

    let level = deckToLevel(deck);
    if (!level) continue;

    // refine N4+N5 split: prefer Bluskyo level if known
    if (deck.includes("1-N4+N5")) {
      const refined = levelMap.get(ja);
      if (refined === "N5" || refined === "N4") {
        level = refined;
      }
      // else fallback to N5 (default)
    }

    // build id
    let id = `ja-vocab-${level.toLowerCase()}-${slugify(reading, ja)}`;
    if (seenIds.has(id)) {
      // disambiguate with kanji-derived suffix
      id = `${id}-${Buffer.from(ja, "utf-8").toString("hex").slice(0, 6)}`;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const seed: Seed = { id, type: "vocab", level, ja, reading, zh };
    if (pos) seed.pos = pos;
    if (exampleJa && exampleZh) seed.examples = [{ ja: exampleJa, zh: exampleZh }];
    seeds.push(seed);
  }
  return seeds;
}

async function main() {
  const offlineIdx = process.argv.indexOf("--offline");
  const offlineDir = offlineIdx > 0 ? process.argv[offlineIdx + 1] : undefined;

  const eggCachePath = offlineDir ? join(offlineDir, "jlpt-egg.csv") : undefined;
  const bluskyoCachePath = offlineDir ? join(offlineDir, "jlpt-bluskyo.csv") : undefined;

  const [eggCsv, bluskyoCsv] = await Promise.all([
    loadCsv(EGG_URL, eggCachePath),
    loadCsv(BLUSKYO_URL, bluskyoCachePath),
  ]);

  const levelMap = buildBluskyoLevelMap(bluskyoCsv);
  const seeds = parseEggCsv(eggCsv, levelMap);

  const buckets: Record<Level, Seed[]> = { N5: [], N4: [], N3: [], N2: [] };
  for (const s of seeds) buckets[s.level].push(s);

  if (!existsSync(SEEDS_DIR)) mkdirSync(SEEDS_DIR, { recursive: true });

  for (const lvl of ["N5", "N4", "N3", "N2"] as Level[]) {
    const path = join(SEEDS_DIR, `${lvl.toLowerCase()}-vocab.yaml`);
    const yaml = YAML.stringify({ concepts: buckets[lvl] });
    writeFileSync(path, yaml, "utf-8");
    console.log(`wrote ${path}: ${buckets[lvl].length} entries`);
  }

  console.log(`total vocab: ${seeds.length}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
