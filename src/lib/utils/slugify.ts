/**
 * Slug generation utilities for human-readable URLs.
 * Pure utility module — no "use server", importable anywhere.
 */

/**
 * Characters that survive NFD normalization and need explicit transliteration.
 * Covers Polish, Scandinavian, German, Icelandic, Croatian, and other Latin-script
 * characters that don't decompose into base + combining mark.
 */
const TRANSLITERATION_MAP: Record<string, string> = {
  "\u00E6": "ae", // æ
  "\u00C6": "ae", // Æ
  "\u0153": "oe", // œ
  "\u0152": "oe", // Œ
  "\u00F8": "o",  // ø
  "\u00D8": "o",  // Ø
  "\u0142": "l",  // ł
  "\u0141": "l",  // Ł
  "\u00F0": "d",  // ð
  "\u00D0": "d",  // Ð
  "\u00FE": "th", // þ
  "\u00DE": "th", // Þ
  "\u00DF": "ss", // ß
  "\u0111": "d",  // đ
  "\u0110": "d",  // Đ
  "\u0127": "h",  // ħ
  "\u0126": "h",  // Ħ
  "\u0131": "i",  // ı (dotless i)
  "\u0138": "k",  // ĸ
  "\u014B": "ng", // ŋ
  "\u014A": "ng", // Ŋ
  "\u0167": "t",  // ŧ
  "\u0166": "t",  // Ŧ
};

const TRANSLITERATION_RE = new RegExp(
  `[${Object.keys(TRANSLITERATION_MAP).join("")}]`,
  "g",
);

/**
 * Convert arbitrary text to a URL-safe slug.
 * - Transliterates special Latin characters (ł → l, ß → ss, æ → ae, etc.)
 * - Normalises Unicode (NFD) and strips combining diacritics
 * - Lowercases
 * - Replaces non-alphanumeric characters with hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 */
export function slugify(text: string): string {
  return text
    .replace(TRANSLITERATION_RE, (ch) => TRANSLITERATION_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumeric → hyphen
    .replace(/-{2,}/g, "-") // collapse runs
    .replace(/^-+|-+$/g, ""); // trim edges
}

/**
 * Truncate a slug at a word boundary (hyphen) so the result is at most
 * `maxLength` characters.
 *
 * - If the result already fits, it is returned as-is.
 * - If truncation would land mid-word, backtrack to the previous hyphen.
 * - If the very first word exceeds `maxLength`, use the first `maxLength` chars.
 * - Never returns an empty string.
 */
export function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const candidate = text.slice(0, maxLength);
  const lastHyphen = candidate.lastIndexOf("-");

  if (lastHyphen > 0) {
    return candidate.slice(0, lastHyphen);
  }

  // First word alone exceeds maxLength — hard truncate
  return candidate;
}

/**
 * Generate a slug for a work.
 * Format: `{title-slug}-by-{author-slug}`
 * Title portion is truncated to 30 characters at a word boundary.
 *
 * Edge cases:
 * - If the slugified title is empty (e.g. all non-Latin chars) → falls back
 *   to first 8 hex chars of the work's UUID (pass via `fallbackId`).
 * - If authorName is empty → omit the `-by-` segment entirely.
 */
export function generateWorkSlug(
  title: string,
  primaryAuthorName: string,
  fallbackId?: string,
): string {
  const titleSlug = truncateAtWordBoundary(slugify(title), 30);
  const authorSlug = slugify(primaryAuthorName);
  const idPrefix = fallbackId ? fallbackId.replace(/-/g, "").slice(0, 8) : "work";

  if (!titleSlug && !authorSlug) return idPrefix;
  if (!titleSlug) return `${idPrefix}-by-${authorSlug}`;
  if (!authorSlug) return titleSlug;

  return `${titleSlug}-by-${authorSlug}`;
}

/**
 * Generate a slug for an author.
 * Simply slugifies the full name.
 */
export function generateAuthorSlug(name: string): string {
  const slug = slugify(name);
  return slug || "author";
}

/**
 * Make a slug unique by appending -2, -3, … when the base slug already
 * exists in the provided list.
 *
 * The provided `existingSlugs` list must NOT include the current entity's
 * own slug when doing an update (so pass the filtered list).
 */
export function makeUnique(baseSlug: string, existingSlugs: string[]): string {
  if (!existingSlugs.includes(baseSlug)) return baseSlug;

  let counter = 2;
  while (existingSlugs.includes(`${baseSlug}-${counter}`)) {
    counter++;
  }
  return `${baseSlug}-${counter}`;
}
