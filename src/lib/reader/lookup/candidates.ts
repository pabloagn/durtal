export const MAX_TRANSLATION_CHARACTERS = 1000;

export function cleanLookupText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
}

/** No stemming or inflection resolution: each provider tries these in order. */
export function lookupCandidates(text: string, language = "en"): string[] {
  const first = cleanLookupText(text);
  if (!first) return [];
  let lower: string;
  try {
    lower = first.toLocaleLowerCase(language);
  } catch {
    lower = first.toLowerCase();
  }
  return lower === first ? [first] : [first, lower];
}

export function lookupSelection(text: string, language = "en") {
  const cleaned = cleanLookupText(text);
  let segmenter: Intl.Segmenter;
  try {
    segmenter = new Intl.Segmenter(language, { granularity: "word" });
  } catch {
    segmenter = new Intl.Segmenter("en", { granularity: "word" });
  }
  // Only the 5/6 boundary matters. Do not segment an entire long passage.
  let words = 0;
  for (const part of segmenter.segment(cleaned)) {
    if (part.isWordLike && ++words > 5) break;
  }
  return {
    text: cleaned,
    kind:
      words === 0
        ? ("empty" as const)
        : words <= 5
          ? ("word" as const)
          : ("passage" as const),
    translatable:
      cleaned.length > 0 && text.length <= MAX_TRANSLATION_CHARACTERS,
  };
}
