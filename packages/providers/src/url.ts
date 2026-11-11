const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;

/**
 * Finds the first http(s) URL in shared text. Never treat the whole shared
 * text as a URL — share sheets commonly wrap the link in prose.
 */
export function extractFirstUrl(input: string): string | null {
  const match = URL_PATTERN.exec(input);
  if (match === null) {
    return null;
  }
  // Trailing punctuation usually belongs to the surrounding sentence.
  const candidate = match[0].replace(/[.,;:!?)\]]+$/, '');
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}
