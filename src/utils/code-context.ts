/**
 * Detects whether a string looks like code or a code-flavored shell context.
 * Used by D6 (immersion gating) and D19 (ambient mix) so we don't inject
 * Japanese vocabulary into snippets the user is actively reading or writing.
 */
export function looksLikeCodeContext(s: string): boolean {
  return /```|^import |\.dart\b|\.ts\b|\.tsx\b|\.py\b|\.go\b|\.rs\b|\bclass \w+|\bfunction \w+|\bconst \w+\s*=|\bdef \w+|\bfn \w+/.test(s);
}

export function looksLikeCodeContextStrict(s: string): boolean {
  return looksLikeCodeContext(s) || /^\$\s|^\#\s|^\>\s|^https?:\/\//.test(s.trim()) || /`[^`]+`/.test(s);
}
