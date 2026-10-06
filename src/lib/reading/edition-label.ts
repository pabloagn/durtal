import { languageName } from "@/lib/utils/language";

/*
 * An edition's short name (SLN-480), as quotes, their groups, the meta lines,
 * Copy and every edition picker in the tracker name it: "Penguin Classics,
 * 2003, tr. Edith Grossman". Pure, so the pages, the API and the tests share it.
 */

export interface LabelEdition {
  id: string;
  title: string;
  language: string | null;
  /** The linked house's name, else the free-text publisher */
  publisher: string | null;
  year: number | null;
  translators: string[];
  binding?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
}

/** What the browser gets once per edition its notes use */
export interface NoteEdition {
  label: string;
  title: string;
  publisher: string | null;
  year: number | null;
  translators: string[];
}

/** "Edith Grossman", "A and B", "A, B and C" */
export function namesText(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "Hardcover", "Saddle stitch" */
function bindingWord(binding: string) {
  const text = binding.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The edition's title when it differs from the book's, the publisher, the
 * year and "tr. Name", joined with commas; a part that is missing drops out.
 * An edition with none of them is "Edition not identified".
 */
export function editionShortLabel(edition: LabelEdition, workTitle: string): string {
  const title = edition.title.trim();
  const parts = [
    title && title.toLocaleLowerCase() !== workTitle.trim().toLocaleLowerCase() ? title : null,
    edition.publisher?.trim() || null,
    edition.year ? String(edition.year) : null,
    edition.translators.length ? `tr. ${namesText(edition.translators)}` : null,
  ];
  return parts.filter(Boolean).join(", ") || "Edition not identified";
}

/** Each label that more than one edition has */
function repeated(labels: Map<string, string>) {
  const counts = new Map<string, number>();
  for (const l of labels.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([l]) => l));
}

/**
 * A label for each of a book's editions, by id, told apart: the language
 * first when the editions span more than one (unless `language` is false),
 * then the binding, the ISBN's last four digits or the place among the
 * book's editions where two would read the same.
 */
export function editionLabels(editions: LabelEdition[], workTitle: string, { language }: { language?: boolean } = {}): Map<string, string> {
  const languages = new Set(editions.map((e) => e.language ?? ""));
  const withLanguage = language ?? languages.size > 1;
  const labels = new Map(
    editions.map((e) => {
      const short = editionShortLabel(e, workTitle);
      const lang = withLanguage && e.language ? (languageName(e.language) ?? e.language) : null;
      return [e.id, lang ? `${lang} · ${short}` : short];
    }),
  );
  const steps: ((e: LabelEdition, i: number, group: LabelEdition[]) => string | null)[] = [
    // The binding, only where the bindings differ
    (e, _i, group) => (e.binding && new Set(group.map((g) => g.binding ?? "")).size > 1 ? bindingWord(e.binding) : null),
    (e) => {
      const isbn = e.isbn13 ?? e.isbn10;
      return isbn ? `ISBN …${isbn.slice(-4)}` : null;
    },
    (_e, i) => `(${i + 1})`,
  ];
  for (const step of steps) {
    const twice = repeated(labels);
    if (!twice.size) break;
    for (const label of twice) {
      const group = editions.filter((e) => labels.get(e.id) === label);
      group.forEach((e) => {
        const extra = step(e, editions.indexOf(e), group);
        if (extra) labels.set(e.id, extra.startsWith("(") ? `${label} ${extra}` : `${label}, ${extra}`);
      });
    }
  }
  return labels;
}

/** The browser's summary of each edition, with its told-apart label */
export function noteEditionsOf(editions: LabelEdition[], workTitle: string): Record<string, NoteEdition> {
  const labels = editionLabels(editions, workTitle);
  return Object.fromEntries(
    editions.map((e) => [e.id, { label: labels.get(e.id)!, title: e.title, publisher: e.publisher, year: e.year, translators: e.translators }]),
  );
}

/** A drizzle edition with its publisher links and contributors, as a LabelEdition */
export function labelEditionOf(e: {
  id: string;
  title: string;
  language: string | null;
  publisher?: string | null;
  publicationYear: number | null;
  binding?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  publisherLinks?: { publisher: { name: string } | null }[];
  contributors?: { role: string; sortOrder?: number; author: { name: string } | null }[];
}): LabelEdition {
  return {
    id: e.id,
    title: e.title,
    language: e.language,
    publisher: e.publisherLinks?.find((l) => l.publisher)?.publisher?.name ?? e.publisher ?? null,
    year: e.publicationYear,
    translators: (e.contributors ?? [])
      .filter((c) => c.role === "translator" && c.author)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((c) => c.author!.name),
    binding: e.binding ?? null,
    isbn13: e.isbn13 ?? null,
    isbn10: e.isbn10 ?? null,
  };
}
