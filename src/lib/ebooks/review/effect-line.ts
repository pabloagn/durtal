import { languageName, normalizeLanguage } from "@/lib/utils/language";

/** Structural projection of SLN-495 LinkEffect, not a planner or permission to write. */
export interface LinkSentenceEffect {
  ready: boolean;
  missing: readonly string[];
  ambiguities: readonly { text: string }[];
  rule:
    | "isbn_edition"
    | "fill_copy"
    | "new_isbn_edition"
    | "placeholder_copy"
    | "new_edition";
  editionId: string | null;
  instanceId: string | null;
  movedFromEditionId: string | null;
  newEdition: { language: string; isbn13: string | null } | null;
  newCopy: object | null;
}
export interface EditionSentenceContext {
  workTitle: string;
  edition: {
    id: string;
    language: string | null;
    isbn13: string | null;
    placeholder: boolean;
  } | null;
}

function blocked(
  missing: readonly string[],
  ambiguities: readonly { text: string }[],
) {
  const labels: Record<string, string> = {
    author: "an author",
    language: "a language",
    verified_file: "an available verified file",
    ebook_location: "the eBooks location",
    title: "a title",
  };
  const reasons = [
    ...missing.map((item) => labels[item] ?? item),
    ...ambiguities.map((item) => item.text),
  ];
  return `Needs review${reasons.length ? `: ${reasons.join("; ")}` : " before writing"}`;
}
function editionWords(edition: NonNullable<EditionSentenceContext["edition"]>) {
  if (edition.placeholder) return "edition not identified";
  return [
    edition.language ? `${languageName(edition.language)} edition` : "edition",
    edition.isbn13 ? `ISBN ${edition.isbn13}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Refuse inconsistent context rather than describe a different edition from the effect. */
export function linkEffectLine(
  effect: LinkSentenceEffect,
  context: EditionSentenceContext,
): string {
  if (!effect.ready || effect.missing.length || effect.ambiguities.length)
    return blocked(effect.missing, effect.ambiguities);
  if (effect.newEdition) {
    if (!normalizeLanguage(effect.newEdition.language))
      throw new Error("An edition requires a known language");
    if (
      !["new_isbn_edition", "new_edition"].includes(effect.rule) ||
      effect.editionId ||
      effect.instanceId ||
      effect.movedFromEditionId ||
      !effect.newCopy ||
      (effect.rule === "new_isbn_edition") !== !!effect.newEdition.isbn13
    )
      throw new Error("Inconsistent new edition effect");
    return `Adds an edition in ${languageName(effect.newEdition.language)} (${effect.newEdition.isbn13 ? `ISBN ${effect.newEdition.isbn13}` : "without an ISBN"}) and a digital copy of ${context.workTitle}`;
  }
  if (!context.edition || effect.editionId !== context.edition.id)
    throw new Error("The effect's edition is missing from its preview");
  const edition = editionWords(context.edition);
  if (effect.instanceId) {
    if (effect.newCopy || !["isbn_edition", "fill_copy"].includes(effect.rule))
      throw new Error("Inconsistent fill effect");
    if (effect.movedFromEditionId) {
      if (
        effect.rule !== "isbn_edition" ||
        effect.movedFromEditionId === effect.editionId
      )
        throw new Error("Inconsistent move effect");
      return `Moves the digital copy of ${context.workTitle} to the ${edition} and fills it`;
    }
    return `Fills the digital copy of ${context.workTitle} (${edition})`;
  }
  if (
    !effect.newCopy ||
    effect.movedFromEditionId ||
    !["isbn_edition", "placeholder_copy"].includes(effect.rule)
  )
    throw new Error("Inconsistent copy effect");
  return `Adds a digital copy of ${context.workTitle} (${edition})`;
}

/** Structural projection of SLN-495 AccessionEffect; authors already resolved by that planner. */
export interface AccessionSentenceEffect {
  ready: boolean;
  missing: readonly string[];
  ambiguities: readonly { text: string }[];
  work: { title: string } | null;
  authors: readonly {
    name: string;
    existingId: string | null;
    createKey: string | null;
  }[];
  edition: object | null;
  copy: object | null;
}
export function accessionEffectLine(effect: AccessionSentenceEffect): string {
  if (!effect.ready || effect.missing.length || effect.ambiguities.length)
    return blocked(effect.missing, effect.ambiguities);
  if (
    !effect.work ||
    !effect.edition ||
    !effect.copy ||
    !effect.authors.length ||
    effect.authors.some((author) => !!author.existingId === !!author.createKey)
  )
    throw new Error("Incomplete accession effect");
  return `Creates the book ${effect.work.title}, its edition and a digital copy · ${effect.authors.map((author) => (author.existingId ? `author: ${author.name}, already in Durtal` : `new author: ${author.name}`)).join(" · ")}`;
}

export interface ReviewEffectCounts {
  ebooks: number;
  filledCopies: number;
  movedCopies: number;
  editions: number;
  copies: number;
  books: number;
  authors: number;
  works: number;
}
function count(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Effect counts must be nonnegative safe integers");
  return value.toLocaleString("en-US");
}
function quantity(
  value: number,
  plural: "copies" | "editions" | "books" | "authors",
) {
  const singular = {
    copies: "copy",
    editions: "edition",
    books: "book",
    authors: "author",
  };
  return `${count(value)} ${value === 1 ? singular[plural] : plural}`;
}
export function bulkEffectLine(
  action:
    | "accept"
    | "exclude_duplicates"
    | "exclude_not_a_book"
    | "keep"
    | "accession"
    | "mark_accessioned",
  effects: ReviewEffectCounts,
): string {
  for (const value of Object.values(effects)) count(value);
  if (
    effects.movedCopies > effects.filledCopies ||
    effects.filledCopies + effects.copies > effects.ebooks ||
    effects.editions > effects.copies ||
    effects.books > effects.ebooks ||
    effects.works > effects.ebooks
  )
    throw new Error("Inconsistent aggregate effects");
  const creates =
    effects.filledCopies +
    effects.movedCopies +
    effects.editions +
    effects.copies +
    effects.books +
    effects.authors;
  if (
    [
      "keep",
      "exclude_duplicates",
      "exclude_not_a_book",
      "mark_accessioned",
    ].includes(action) &&
    creates !== 0
  )
    throw new Error("This action cannot create catalogue rows or fill copies");
  if (action !== "mark_accessioned" && effects.works !== 0)
    throw new Error("This action cannot change catalogue status");
  if (
    action === "accept" &&
    (effects.books ||
      effects.authors ||
      effects.filledCopies + effects.copies !== effects.ebooks)
  )
    throw new Error("Every accepted link must fill or add one copy");
  if (
    action === "accession" &&
    (effects.books !== effects.ebooks ||
      effects.editions !== effects.ebooks ||
      effects.copies !== effects.ebooks ||
      effects.filledCopies ||
      effects.movedCopies)
  )
    throw new Error("Every accession must create one book, edition and copy");
  const writes = [
    effects.filledCopies
      ? `fills ${quantity(effects.filledCopies, "copies")}${effects.movedCopies ? ` (${count(effects.movedCopies)} moved)` : ""}`
      : null,
    effects.editions ? `adds ${quantity(effects.editions, "editions")}` : null,
    effects.copies ? `adds ${quantity(effects.copies, "copies")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  switch (action) {
    case "accept":
      return `Accept ${count(effects.ebooks)} likely matches${writes ? ` · ${writes}` : ""}`;
    case "exclude_duplicates":
      return `Set aside ${count(effects.ebooks)} duplicates · hides them; no files deleted`;
    case "exclude_not_a_book":
      return `Set aside ${count(effects.ebooks)} · hides them; no files deleted`;
    case "keep":
      return `Keep ${count(effects.ebooks)} as eBooks · marks them standalone; nothing is created`;
    case "accession":
      return `Creates ${quantity(effects.books, "books")}${writes ? ` · ${writes}` : ""}${effects.authors ? ` · creates ${quantity(effects.authors, "authors")}` : ""}`;
    case "mark_accessioned":
      return `Mark ${count(effects.works)} accessioned · records each status change`;
  }
}
