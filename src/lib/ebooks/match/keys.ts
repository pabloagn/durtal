import { createHash } from "node:crypto";
import {
  closeSpelling,
  identityName,
  numberSignature,
  stableStringify,
} from "@/lib/harmonization/normalize";
import { validIsbn10, validIsbn13, isbn10To13 } from "@/lib/match/plan";
import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import { naturalAuthorName } from "@/lib/utils/author-names";
import { strictWordSimilarity } from "./similarity";
import type { AuthorLevel, MatchEbook, MatchFlag } from "./types";

const ARTICLES: Record<string, readonly string[]> = {
  en: ["the", "a", "an"],
  fr: ["le", "la", "les", "un", "une", "l'"],
  es: ["el", "la", "los", "las", "un", "una"],
  de: ["der", "die", "das", "ein", "eine"],
  it: ["il", "lo", "la", "gli", "le", "i", "un", "una", "l'"],
  pt: ["o", "a", "os", "as", "um", "uma"],
  nl: ["de", "het", "een"],
};
const MISSING_NAMES = new Set([
  "unknown",
  "various",
  "anonymous",
  "uncredited",
  "inconnu",
  "desconocido",
  "autor desconocido",
]);
const PARTICLES = new Set([
  "de",
  "del",
  "della",
  "der",
  "di",
  "da",
  "du",
  "des",
  "van",
  "von",
  "la",
  "le",
  "bin",
  "ibn",
  "al",
]);
const unique = (values: readonly string[]) =>
  [...new Set(values.filter(Boolean))].sort();

export interface TitleKeys {
  cleaned: string;
  full: string;
  main: string;
  all: readonly string[];
  numbers: string;
  removedSeriesPosition: string | null;
}
export function titleKeys(
  title: string,
  subtitle?: string | null,
  language?: string | null,
  series?: string | null,
): TitleKeys {
  let removedSeriesPosition: string | null = null;
  const cleaned = title
    .replace(/[\[(]([^\])]+)[\])]/g, (marker, content: string) => {
      const position = /^(?:book|volume|vol\.?|tome)\s+(\d+(?:\.\d+)?)/i.exec(
        content.trim(),
      );
      if (position) {
        removedSeriesPosition = position[1];
        return " ";
      }
      if (
        /^(?:epub|pdf|retail|z-lib\.org|[\p{L} -]+ edition)$/iu.test(
          content.trim(),
        )
      )
        return " ";
      if (
        series &&
        normalizeSearchText(content) === normalizeSearchText(series)
      )
        return " ";
      return marker;
    })
    .replace(/\bretail\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const mainText = cleaned.split(/:|\s[-—]\s/, 1)[0].trim();
  const fullText = [cleaned, subtitle?.trim()].filter(Boolean).join(": ");
  const code = normalizeLanguage(language);
  const articles = code
    ? (ARTICLES[code] ?? [])
    : Object.values(ARTICLES).flat();
  const stripped = (text: string) => {
    const lower = text.toLowerCase().replace(/’/g, "'");
    for (const article of articles) {
      const prefix = article.endsWith("'") ? article : `${article} `;
      if (lower.startsWith(prefix))
        return normalizeSearchText(text.slice(prefix.length));
    }
    return "";
  };
  const full = normalizeSearchText(fullText);
  const main = normalizeSearchText(mainText);
  return {
    cleaned,
    full,
    main,
    all: unique([full, main, stripped(fullText), stripped(mainText)]),
    numbers: numberSignature(cleaned) || removedSeriesPosition || "",
    removedSeriesPosition,
  };
}

export interface AuthorKey {
  identity: string;
  surname: string;
  given: readonly string[];
  initials: string;
}
export function authorKey(value: string): AuthorKey | null {
  const identity = identityName(naturalAuthorName(value), true);
  if (!identity || MISSING_NAMES.has(identity)) return null;
  const parts = identity.split(" ");
  let surnameAt = parts.length - 1;
  while (surnameAt > 0 && PARTICLES.has(parts[surnameAt - 1])) surnameAt--;
  const given = parts.slice(0, surnameAt);
  return {
    identity,
    surname: parts.slice(surnameAt).join(" "),
    given,
    initials: given.map((part) => [...part][0]).join(""),
  };
}
const transliterationKey = (name: string) =>
  name
    .replace(/j(?=[aeiou])/g, "y")
    .replace(/w/g, "v")
    .replace(/ie|ye/g, "e")
    .replace(/(?:iy|ij|ii|yi|y)$/g, "i");
export function authorAgreement(
  left: readonly AuthorKey[],
  right: readonly AuthorKey[],
): AuthorLevel {
  if (!left.length || !right.length) return "missing";
  if (left.some((a) => right.some((b) => a.identity === b.identity)))
    return "identity";
  const compatible = left.some((a) =>
    right.some((b) => {
      if (closeSpelling(a.identity, b.identity)) return true;
      const surname =
        a.surname === b.surname ||
        transliterationKey(a.surname) === transliterationKey(b.surname) ||
        Math.max(
          strictWordSimilarity(a.surname, b.surname),
          strictWordSimilarity(b.surname, a.surname),
        ) >= 0.6;
      if (!surname || !a.given.length || !b.given.length) return false;
      const shorter = a.given.length <= b.given.length ? a.given : b.given;
      const longer = a.given.length <= b.given.length ? b.given : a.given;
      return shorter.every(
        (part, i) =>
          part === longer[i] ||
          ((part.length === 1 || longer[i].length === 1) &&
            part[0] === longer[i][0]),
      );
    }),
  );
  return compatible ? "compatible" : "disagree";
}
export function canonicalIsbn(value: string): string | null {
  const raw = value.replace(/^urn:isbn:/i, "").trim();
  const thirteen = validIsbn13(raw);
  const ten = thirteen ? null : validIsbn10(raw);
  return thirteen ?? (ten ? isbn10To13(ten) : null);
}
export function identifierKeys(
  isbns: readonly string[],
  identifiers: Readonly<Record<string, readonly string[]>>,
) {
  const isbn = new Set(
    isbns.map(canonicalIsbn).filter((n): n is string => !!n),
  );
  const external = new Set<string>();
  for (const [provider, values] of Object.entries(identifiers))
    for (const raw of values) {
      const value = raw.trim();
      if (provider === "asin" && /^\d{10}$/.test(value)) {
        const n = canonicalIsbn(value);
        if (n) isbn.add(n);
      } else if (provider === "asin" && /^B0[A-Z0-9]{8}$/i.test(value))
        external.add(`asin:${value.toUpperCase()}`);
      else if (
        ["goodreads", "google", "openlibrary", "oclc"].includes(provider) &&
        value
      )
        external.add(`${provider}:${value}`);
    }
  return { isbns: unique([...isbn]), external: unique([...external]) };
}
export function ebookFlags(ebook: MatchEbook): MatchFlag[] {
  const title = [ebook.title, ebook.subtitle].filter(Boolean).join(" ");
  const flags: MatchFlag[] = [];
  if (
    /[&;]|\s\/\s|\b(?:trilogy|omnibus|box set|complete works|obras completas|sämtliche werke)\b|[œo]e?uvres complètes|\b\d+\s*[-–]\s*\d+\b/iu.test(
      title,
    )
  )
    flags.push("omnibus");
  if (/\b(?:sample|excerpt|preview|extrait|leseprobe)\b/i.test(title))
    flags.push("sample");
  if (/\b(?:issue|no\.|nº|n°)\s*\d+|\b\d{4}[-/]\d{2}[-/]\d{2}\b/i.test(title))
    flags.push("periodical");
  if (ebook.identifiers.doi?.some((id) => id.trim())) flags.push("article");
  return flags;
}
/** No duplicate proposal without a known title, author identity and language. */
export function duplicateMetadataKey(ebook: MatchEbook): string | null {
  const title = titleKeys(ebook.title, ebook.subtitle, ebook.language).full;
  const authors = unique(
    ebook.authors.map((name) => authorKey(name)?.identity ?? ""),
  );
  const language = normalizeLanguage(ebook.language);
  return title && authors.length && language
    ? stableStringify({ title, authors, language })
    : null;
}
/** Decisions and timestamps are intentionally absent: deciding must not trigger rematching itself. */
export function matchFingerprint(ebook: MatchEbook): string {
  const ids = identifierKeys(ebook.isbns, ebook.identifiers);
  const { cleaned: _cleaned, ...title } = titleKeys(
    ebook.title,
    ebook.subtitle,
    ebook.language,
    ebook.series,
  );
  return createHash("sha256")
    .update(
      stableStringify({
        title,
        authors: unique(
          ebook.authors.map((name) => authorKey(name)?.identity ?? ""),
        ),
        language: normalizeLanguage(ebook.language),
        ...ids,
        doi: unique(ebook.identifiers.doi ?? []),
        series: normalizeSearchText(ebook.series ?? ""),
        seriesIndex: ebook.seriesIndex ?? null,
        publishedYear: ebook.publishedYear ?? null,
        files: ebook.files
          .map((file) => ({ sha256: file.sha256, format: file.format }))
          .sort(
            (a, b) =>
              a.sha256.localeCompare(b.sha256) ||
              a.format.localeCompare(b.format),
          ),
      }),
    )
    .digest("hex");
}
