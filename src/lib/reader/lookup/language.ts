import { normalizeLanguage } from "@/lib/utils/language";

/** Passage markup wins over catalogue metadata. An explicit override belongs to one lookup. */
export function lookupLanguage(input: {
  passage?: string | null;
  ebook?: string | null;
  edition?: string | null;
}): { language: string; guessed: boolean } {
  for (const raw of [input.passage, input.ebook, input.edition]) {
    const language = normalizeLanguage(raw);
    if (language) return { language, guessed: false };
  }
  return { language: "en", guessed: true };
}
