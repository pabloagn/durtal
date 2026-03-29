export type QueryType = "isbn" | "author" | "title" | "general";

export interface ClassifiedQuery {
  type: QueryType;
  raw: string;
  normalized: string;
  isbnClean?: string;
  /** 0-1 confidence that this is an author query — used as ranking hint */
  authorScore: number;
}

/** Words that signal a title rather than an author name */
const TITLE_SIGNALS = new Set([
  // English
  "the", "a", "an", "of", "and", "in", "on", "at", "to", "for", "with", "by",
  "from", "or", "not", "no", "is", "was", "are", "how", "why", "what", "when",
  "where", "who", "his", "her", "my", "our", "their", "its", "story", "tales",
  "book", "night", "last", "first", "new", "old", "great", "little", "dark",
  // French
  "le", "la", "les", "un", "une", "des", "du", "et", "ou", "dans", "histoire",
  // Spanish
  "el", "los", "las", "del", "en", "con", "por", "como",
  // German
  "der", "die", "das", "ein", "eine", "und",
  // Italian
  "il", "lo", "gli", "nel",
  // Portuguese
  "o", "os", "as", "do", "da", "dos",
]);

/** Common name prefixes/particles that don't disqualify author classification */
const NAME_PARTICLES = new Set([
  "de", "di", "du", "von", "van", "le", "la", "el", "al", "bin", "ibn",
  "mc", "mac", "o'", "st", "st.",
]);

function isIsbn(raw: string): string | null {
  const clean = raw.replace(/[-\s]/g, "");
  if (/^\d{13}$/.test(clean) || /^\d{10}$/.test(clean)) return clean;
  if (/^\d{9}[xX]$/.test(clean)) return clean;
  return null;
}

function scoreAuthorLikelihood(normalized: string): number {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  // Single-word: could be author (Voltaire) or title (Dune) — ambiguous
  if (words.length === 1) {
    const word = words[0];
    if (word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) return 0.1;
    if (word.includes("-") && word.length > 3) return 0.7;
    return 0.4;
  }

  // "Last, First" pattern — very strong author signal
  if (normalized.includes(",")) {
    const parts = normalized.split(",").map((p) => p.trim());
    if (
      parts.length === 2 &&
      parts.every((p) => p.length > 0 && p[0] === p[0].toUpperCase())
    ) {
      return 0.95;
    }
  }

  // Check for title-signal words anywhere in the query
  const lowerWords = words.map((w) => w.toLowerCase());
  const titleSignalCount = lowerWords.filter(
    (w) => TITLE_SIGNALS.has(w) && !NAME_PARTICLES.has(w),
  ).length;
  if (titleSignalCount > 0) return 0.15;

  // 5+ words — almost certainly a title
  if (words.length >= 5) return 0.1;

  // Count capitalization patterns
  let capitalizedCount = 0;
  let lowerCount = 0;
  let hasInitials = false;

  for (const word of words) {
    const clean = word.replace(/[.']/g, "");
    if (!clean) continue;

    if (clean.length <= 2 && clean === clean.toUpperCase()) {
      hasInitials = true;
      capitalizedCount++;
    } else if (
      clean[0] === clean[0].toUpperCase() &&
      clean[0] !== clean[0].toLowerCase()
    ) {
      capitalizedCount++;
    } else if (NAME_PARTICLES.has(word.toLowerCase())) {
      // neutral — don't count
    } else {
      lowerCount++;
    }
  }

  // Initials present (e.g., "J K Rowling", "J.R.R. Tolkien") — strong author signal
  if (hasInitials && lowerCount === 0 && words.length >= 2) return 0.9;

  // All capitalized, 2-4 words — genuinely ambiguous
  // Could be "Gabriel Garcia" (author) or "Infinite Jest" (title) or "Bataille Eye" (author+title mix)
  if (lowerCount === 0 && words.length >= 2 && words.length <= 4) {
    return 0.5;
  }

  // Mix of caps and lowercase — more title-like
  if (lowerCount > 0 && capitalizedCount > 0) return 0.25;

  return 0.35;
}

export function classifyQuery(raw: string): ClassifiedQuery {
  const normalized = raw.trim().replace(/\s+/g, " ");

  const isbnClean = isIsbn(normalized);
  if (isbnClean) {
    return { type: "isbn", raw, normalized, isbnClean, authorScore: 0 };
  }

  const authorScore = scoreAuthorLikelihood(normalized);

  // Only classify as "author" with very high confidence (comma, initials)
  if (authorScore >= 0.85) {
    return { type: "author", raw, normalized, authorScore };
  }

  // Only classify as "title" when clearly a title
  if (authorScore <= 0.15) {
    return { type: "title", raw, normalized, authorScore };
  }

  // Everything else: general comprehensive search
  return { type: "general", raw, normalized, authorScore };
}
