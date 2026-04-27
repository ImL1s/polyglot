/**
 * Listening drill scoring (Phase 1.2 D15). When the skill plays
 * `concept.ja` via `lt say` and asks the user for the kana reading, this
 * helper compares the user's input against `concept.reading` to produce a
 * rating ∈ {1,2,3,4} that respects the planner v4 constraint:
 *
 *   "听力 drill 评 rating 时把 reading mismatch 当 rating 2 起跳"
 *
 * That means: a correct read is rating_4_easy; any kana mismatch caps at
 * rating_2_hard (never gets bumped to rating_3); empty input is rating_1.
 *
 * Pure function so tests don't need a DB or skill harness.
 */

export interface ListeningGrade {
  rating: 1 | 2 | 3 | 4;
  rubric: string;
  normalized_user: string;
  normalized_expected: string;
  exact_match: boolean;
}

/**
 * Normalize kana for comparison. Strips whitespace + punctuation and folds
 * katakana → hiragana so the user can type either script. Long-vowel mark
 * (ー) is preserved as-is because some readings use it semantically (e.g.
 * コーヒー → こーひー). We do NOT fold yōon (e.g. しゃ stays separate from しや)
 * since they encode different sounds.
 */
export function normalizeKana(s: string): string {
  if (!s) return "";
  // Strip whitespace and common punctuation users might add.
  const stripped = s.replace(/[\s.、。,!?！？]/g, "");
  // Katakana (U+30A1..U+30F6) → hiragana (U+3041..U+3096).
  return stripped.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

export function gradeListeningAnswer(
  userAnswer: string,
  expectedReading: string | null,
): ListeningGrade {
  const normUser = normalizeKana(userAnswer ?? "");
  const normExpected = normalizeKana(expectedReading ?? "");

  if (!normUser) {
    return {
      rating: 1,
      rubric: "rating_1_again",
      normalized_user: normUser,
      normalized_expected: normExpected,
      exact_match: false,
    };
  }

  const exact = normUser === normExpected;
  if (exact) {
    return {
      rating: 4,
      rubric: "rating_4_easy",
      normalized_user: normUser,
      normalized_expected: normExpected,
      exact_match: true,
    };
  }

  // Single-char-off (insertion/deletion/substitution = edit distance 1)
  // counts as rating_2_hard per D15 — close miss is still a miss but the
  // user heard most of it. Two+ chars off is rating_1_again because the
  // listening reception was wrong, not just the spelling.
  const dist = editDistance(normUser, normExpected);
  if (dist === 1) {
    return {
      rating: 2,
      rubric: "rating_2_hard",
      normalized_user: normUser,
      normalized_expected: normExpected,
      exact_match: false,
    };
  }
  return {
    rating: 1,
    rubric: "rating_1_again",
    normalized_user: normUser,
    normalized_expected: normExpected,
    exact_match: false,
  };
}

/**
 * Levenshtein distance over Unicode code points. Strings are short
 * (concept readings are typically ≤ 10 kana) so the O(m*n) DP is fine and
 * we don't need rolling arrays or banded variants.
 */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[m][n];
}
