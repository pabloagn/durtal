import { identityName, normalize } from "@/lib/harmonization/normalize";
import { normalizeLanguage } from "@/lib/utils/language";

/*
 * Where a library e-book and the Durtal book it is linked to disagree
 * (SLN-658). Nothing is stored: a difference is computed from the e-book's
 * own fields and the book's, so it is gone once they agree. Pure module.
 */

export const DIFFERENCE_FIELDS = ["title", "subtitle", "authors", "series", "seriesIndex", "language", "year", "publisher", "isbn", "cover", "status"] as const;
export type DifferenceField = (typeof DIFFERENCE_FIELDS)[number];

export const DIFFERENCE_LABELS: Record<DifferenceField, string> = {
  title: "Title",
  subtitle: "Subtitle",
  authors: "Authors",
  series: "Series",
  seriesIndex: "Number in series",
  language: "Language",
  year: "Year",
  publisher: "Publisher",
  isbn: "ISBN",
  cover: "Cover",
  status: "Status",
};

/** The statuses of a book Durtal does not hold yet, though its e-book is here */
export const NOT_HELD_STATUSES = ["wanted", "on_order"] as const;

/** Both sides of one linked e-book, as stored */
export interface DifferenceSides {
  ebookId: string;
  workId: string;
  editionId: string;
  slug: string | null;
  catalogueStatus: string;
  /** The edition's other copies, which a change to the edition also reaches */
  otherCopies: number;
  editionLocked: boolean;
  ebook: {
    title: string;
    subtitle: string | null;
    authors: string[];
    series: string | null;
    seriesIndex: number | null;
    language: string | null;
    year: number | null;
    publisher: string | null;
    isbns: string[];
    hasCover: boolean;
  };
  durtal: {
    workTitle: string;
    title: string;
    subtitle: string | null;
    /** Each author's name, with the name the book credits when it differs */
    authors: { name: string; creditedAs: string | null }[];
    series: string | null;
    seriesIndex: string | null;
    language: string;
    year: number | null;
    publisher: string | null;
    isbn13: string | null;
    hasCover: boolean;
  };
}

export interface Difference {
  ebookId: string;
  workId: string;
  editionId: string;
  slug: string | null;
  bookTitle: string;
  /** The e-book has a cover to show */
  ebookCover: boolean;
  field: DifferenceField;
  /** Durtal's value and the file's, as shown; null when there is none */
  durtal: string | null;
  file: string | null;
  /** "Keep Durtal's" is offered */
  keep: boolean;
  /** "Use the file's" is offered; otherwise `why` says why not */
  use: boolean;
  why: string | null;
  /** What else a change to the book reaches */
  note: string | null;
}

const same = (a: string | null, b: string | null) => normalize(a) === normalize(b);
const index = (value: string | number | null) => {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export const formatIndex = (value: number) => String(Number(value.toFixed(2)));

/** Every difference of one e-book, in the order of DIFFERENCE_FIELDS */
export function differencesOf(sides: DifferenceSides): Difference[] {
  const { ebook, durtal } = sides;
  const out: Difference[] = [];
  const edition = sides.editionLocked
    ? { use: false, why: "The edition's details are locked." }
    : { use: true, why: null };
  const reach = sides.otherCopies > 0 ? `The edition has ${sides.otherCopies === 1 ? "another copy" : `${sides.otherCopies} other copies`}, which this change also reaches.` : null;
  const add = (field: DifferenceField, durtalValue: string | null, fileValue: string | null, choice: { keep?: boolean; use: boolean; why: string | null; note?: string | null }) =>
    out.push({
      ebookId: sides.ebookId,
      workId: sides.workId,
      editionId: sides.editionId,
      slug: sides.slug,
      bookTitle: durtal.workTitle,
      ebookCover: ebook.hasCover,
      field,
      durtal: durtalValue,
      file: fileValue,
      keep: choice.keep ?? true,
      use: choice.use,
      why: choice.use ? null : choice.why,
      note: choice.use ? (choice.note ?? null) : null,
    });

  // A file with no value says nothing against Durtal's: only a value it has is compared
  const fullTitle = durtal.subtitle ? `${durtal.title}: ${durtal.subtitle}` : durtal.title;
  if (!same(ebook.title, durtal.title) && !same(ebook.title, fullTitle)) add("title", durtal.title, ebook.title, { ...edition, note: reach });
  if (ebook.subtitle && !same(ebook.subtitle, durtal.subtitle) && !normalize(durtal.title).endsWith(normalize(ebook.subtitle)))
    add("subtitle", durtal.subtitle, ebook.subtitle, { ...edition, note: reach });
  if (ebook.authors.length) {
    const theirs = ebook.authors.map((a) => identityName(a, true));
    const ours = durtal.authors.map((a) => [a.name, a.creditedAs].filter((n): n is string => !!n).map((n) => identityName(n, true)));
    const agree = theirs.length === ours.length && theirs.every((name) => ours.some((names) => names.includes(name)));
    if (!agree)
      add("authors", durtal.authors.map((a) => a.name).join(" & ") || null, ebook.authors.join(" & "), {
        use: false,
        why: "Authors are changed on the book's page.",
      });
  }
  if (ebook.series && !same(ebook.series, durtal.series)) add("series", durtal.series, ebook.series, { use: true, why: null });
  // A number only means something in the same series
  if (ebook.seriesIndex !== null && ebook.series && same(ebook.series, durtal.series) && index(durtal.seriesIndex) !== ebook.seriesIndex)
    add("seriesIndex", durtal.seriesIndex, formatIndex(ebook.seriesIndex), { use: true, why: null });
  const language = normalizeLanguage(ebook.language);
  if (language && language !== normalizeLanguage(durtal.language)) add("language", durtal.language, language, { ...edition, note: reach });
  if (ebook.year !== null && ebook.year !== durtal.year) add("year", durtal.year === null ? null : String(durtal.year), String(ebook.year), { ...edition, note: reach });
  if (ebook.publisher && !same(ebook.publisher, durtal.publisher)) add("publisher", durtal.publisher, ebook.publisher, { ...edition, note: reach });
  if (ebook.isbns.length && !(durtal.isbn13 && ebook.isbns.includes(durtal.isbn13)))
    add("isbn", durtal.isbn13, ebook.isbns.join(", "), ebook.isbns.length > 1 ? { use: false, why: "The file has more than one ISBN." } : { ...edition, note: reach });
  // Two covers cannot be compared: only a book without one has a difference
  if (ebook.hasCover && !durtal.hasCover)
    add("cover", null, "The e-book's cover", { keep: false, ...edition, note: reach });
  if ((NOT_HELD_STATUSES as readonly string[]).includes(sides.catalogueStatus))
    add("status", sides.catalogueStatus === "wanted" ? "Wanted" : "On order", "The e-book is here", { keep: false, use: false, why: null });
  return out;
}
