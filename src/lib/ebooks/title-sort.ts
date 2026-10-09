import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";

/** One leading article only, for the declared language; unknown languages keep it. */
const ARTICLES: Readonly<Record<string, readonly string[]>> = {
  en: ["the", "a", "an"],
  fr: ["le", "la", "les", "l", "un", "une", "des"],
  es: ["el", "la", "los", "las", "un", "una", "unos", "unas"],
  de: ["der", "die", "das", "ein", "eine"],
  it: ["il", "lo", "la", "l", "i", "gli", "le", "un", "uno", "una"],
  pt: ["o", "a", "os", "as", "um", "uma", "uns", "umas"],
  nl: ["de", "het", "een"],
};

/** Pure preview of the six-digit key; the database will own persisted title_sort. */
export function ebookTitleSort(title: string, language: string | null): string {
  const normalized = normalizeSearchText(title);
  const words = normalized.split(" ");
  const articles = ARTICLES[normalizeLanguage(language) ?? ""] ?? [];
  // An article-only title remains sortable under its own name.
  const text =
    words.length > 1 && articles.includes(words[0])
      ? words.slice(1).join(" ")
      : normalized;
  return text.replace(/\d+/g, (number) => number.padStart(6, "0"));
}
