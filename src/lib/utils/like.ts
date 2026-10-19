/**
 * Escape the LIKE/ILIKE pattern characters (`%`, `_`, `\`) in user text,
 * so the text matches literally. Postgres uses `\` as the default escape.
 */
export function escapeLike(text: string): string {
  return text.replace(/[%_\\]/g, (c) => `\\${c}`);
}

/**
 * A LIKE/ILIKE pattern that matches rows containing `text` literally. A NUL
 * character, which Postgres refuses in text, is dropped (SLN-1137).
 */
export function containsPattern(text: string): string {
  return `%${escapeLike(text.replaceAll("\0", ""))}%`;
}
