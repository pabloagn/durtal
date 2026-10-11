import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import {
  authorAgreement,
  authorKey,
  ebookFlags,
  identifierKeys,
  titleKeys,
  type AuthorKey,
  type TitleKeys,
} from "./keys";
import { MATCH_MODEL, probabilityForBits } from "./model";
import { strictWordSimilarity } from "./similarity";
import type { IndexedWork, MatchCatalogue } from "./catalogue";
import type { MatchEbook, MatchFlag, PairScore, Reason } from "./types";

export interface PreparedMatchEbook {
  title: TitleKeys;
  authors: readonly AuthorKey[];
  ids: ReturnType<typeof identifierKeys>;
  flags: readonly MatchFlag[];
  shared: boolean;
  identifierOwners: ReadonlySet<string>;
}
/** Prepare ebook-wide evidence once, rather than scanning the catalogue for every pair. */
export function prepareMatchEbook(
  ebook: MatchEbook,
  catalogue: MatchCatalogue,
): PreparedMatchEbook {
  const title = titleKeys(
    ebook.title,
    ebook.subtitle,
    ebook.language,
    ebook.series,
  );
  const authors = ebook.authors
    .map(authorKey)
    .filter((key): key is AuthorKey => !!key);
  const ids = identifierKeys(ebook.isbns, ebook.identifiers);
  const flags: MatchFlag[] = ebookFlags(ebook);
  // A title naming two catalogue books by this author is an omnibus even without punctuation.
  const mentioned = new Set(
    catalogue.works
      .filter((other) =>
        ["identity", "compatible"].includes(
          authorAgreement(authors, other.authors),
        ),
      )
      .flatMap((other) =>
        other.titles
          .filter(
            (key) =>
              key.full.length >= 4 &&
              ` ${title.full} `.includes(` ${key.full} `),
          )
          .map((key) => key.full),
      ),
  );
  if (mentioned.size > 1 && !flags.includes("omnibus")) flags.push("omnibus");
  const shared = ids.isbns.some((isbn) => catalogue.sharedIsbns.has(isbn));
  if (shared) flags.push("shared_isbn");
  const identifierOwners = new Set(
    [
      ...ids.isbns
        .filter((isbn) => !catalogue.sharedIsbns.has(isbn))
        .map((isbn) => `isbn:${isbn}`),
      ...ids.external,
    ].flatMap((key) => [...(catalogue.identifierWorkIds.get(key) ?? [])]),
  );
  return { title, authors, ids, flags, shared, identifierOwners };
}
export function scorePair(
  ebook: MatchEbook,
  work: IndexedWork,
  catalogue: MatchCatalogue,
  prepared = prepareMatchEbook(ebook, catalogue),
): PairScore {
  const { title, authors, ids, flags, shared, identifierOwners } = prepared;
  const authorLevel = authorAgreement(authors, work.authors);
  const reasons: Reason[] = [];
  const vetoes: Reason[] = [];
  const equalIsbns = ids.isbns.filter(
    (isbn) => work.isbns.has(isbn) && !catalogue.sharedIsbns.has(isbn),
  );
  const equalExternal = ids.external.filter((id) => work.external.has(id));
  const contradictingIdentifierOwner = [...identifierOwners].some(
    (owner) => owner !== work.source.id,
  );
  if (contradictingIdentifierOwner)
    vetoes.push({
      code: "identifier_owners",
      text: "An identifier belongs to another catalogue book; choose which observation is correct",
    });
  const identifierEditions = [...work.editionIdentifiers]
    .filter(
      ([, keys]) =>
        keys.isbns.some((isbn) => equalIsbns.includes(isbn)) ||
        keys.external.some((id) => equalExternal.includes(id)),
    )
    .map(([id]) => id);
  let titleExact = false;
  let titleSimilarity = 0;
  let commonTitle = false;
  let titleNumbers: string | null = null;
  for (const other of work.titles)
    for (const a of title.all)
      for (const b of other.all) {
        const exact = a === b;
        const similarity = exact ? 1 : strictWordSimilarity(a, b);
        if (similarity > titleSimilarity) {
          titleSimilarity = similarity;
          titleNumbers = other.numbers;
          commonTitle = exact && catalogue.commonTitles.has(a);
        }
        if (exact) titleExact = true;
      }
  // An unnumbered work title may tie the identified edition's cleaned title.
  // Keep that edition's volume evidence independently of the winning title key.
  const identifiedEditionNumbers = work.source.editions
    .filter((edition) => identifierEditions.includes(edition.id))
    .map(
      (edition) =>
        titleKeys(edition.title, edition.subtitle, edition.language).numbers,
    );
  if (
    title.numbers &&
    [titleNumbers, ...identifiedEditionNumbers].some(
      (numbers) => !!numbers && title.numbers !== numbers,
    )
  )
    vetoes.push({
      code: "number_signature",
      text: "The titles name different numbered volumes or years",
    });
  const series = normalizeSearchText(ebook.series ?? "");
  const sameSeries = !!series && work.series.has(series);
  const position =
    ebook.seriesIndex ??
    (title.removedSeriesPosition ? Number(title.removedSeriesPosition) : null);
  const workPosition =
    work.source.seriesPosition === null
      ? null
      : Number(work.source.seriesPosition);
  if (
    sameSeries &&
    position !== null &&
    workPosition !== null &&
    Number.isFinite(workPosition) &&
    position !== workPosition
  )
    vetoes.push({
      code: "series_position",
      text: "Same series, another position",
    });
  if (
    ebook.publishedYear != null &&
    work.source.originalYear !== null &&
    ebook.publishedYear < work.source.originalYear - 1
  )
    vetoes.push({
      code: "year",
      text: "The file's publication year predates the work by more than a year",
    });
  // Author agreement may propose translations, but a partial extra creator must be reviewed.
  if (
    authors.length > 1 &&
    authors.some(
      (author) => authorAgreement([author], work.authors) === "disagree",
    )
  )
    vetoes.push({
      code: "author_set",
      text: "At least one file author disagrees with the book's authors",
    });
  if (authorLevel === "disagree" && identifierEditions.length)
    vetoes.push({
      code: "author_disagrees",
      text: "The file's author disagrees with the identified edition's book; review the identifier",
    });
  // Do not add the ISBN and external-id weights for the same identity evidence.
  const identifierWeight = equalIsbns.length
    ? MATCH_MODEL.isbn
    : equalExternal.length
      ? MATCH_MODEL.identifier
      : 0;
  const titleWeight = !title.all.length
    ? 0
    : titleExact
      ? commonTitle
        ? MATCH_MODEL.title.similar
        : MATCH_MODEL.title.exact
      : titleSimilarity >= 0.8
        ? MATCH_MODEL.title.similar
        : titleSimilarity >= 0.5
          ? MATCH_MODEL.title.partial
          : MATCH_MODEL.title.disagree;
  const language = normalizeLanguage(ebook.language);
  const languageWeight =
    !language || !work.languages.size
      ? 0
      : work.languages.has(language)
        ? MATCH_MODEL.language.agrees
        : MATCH_MODEL.language.disagrees;
  const seriesWeight =
    sameSeries &&
    position !== null &&
    workPosition !== null &&
    position === workPosition
      ? MATCH_MODEL.seriesPosition
      : 0;
  const components = {
    prior: MATCH_MODEL.prior,
    identifier: identifierWeight,
    title: titleWeight,
    author: MATCH_MODEL.author[authorLevel],
    language: languageWeight,
    series: seriesWeight,
  };
  const weightBits = Object.values(components).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (equalIsbns.length)
    reasons.push({ code: "isbn", text: `Same ISBN ${equalIsbns.join(", ")}` });
  if (equalExternal.length)
    reasons.push({
      code: "identifier",
      text: `Same identifier ${equalExternal.join(", ")}`,
    });
  reasons.push({
    code: "title",
    text: titleExact
      ? "Same title key"
      : `Title similarity ${titleSimilarity.toFixed(3)}`,
  });
  reasons.push({
    code: "author",
    text:
      authorLevel === "identity"
        ? "Same author identity"
        : authorLevel === "compatible"
          ? "Compatible author name; confirm the person"
          : authorLevel === "missing"
            ? "Author identity is missing"
            : "Authors disagree",
  });
  if (commonTitle)
    reasons.push({
      code: "common_title",
      text: "This title is used by at least three authors; its identifying weight is reduced",
    });
  if (shared)
    reasons.push({
      code: "shared_isbn",
      text: "At least three ebooks with different titles share an ISBN; it is not identifying",
    });
  if (languageWeight)
    reasons.push({
      code: "language",
      text:
        languageWeight > 0
          ? "Language agrees with the book or an identified edition"
          : "Another language; a translation needs review",
    });
  if (seriesWeight)
    reasons.push({ code: "series", text: "Same series and position" });
  // A confirmed ISBN can corroborate either title or author. An actual title mismatch and
  // author mismatch is a conflict, not a highly scored automatic link.
  const identifierConflict =
    (identifierWeight > 0 &&
      titleSimilarity < 0.8 &&
      !["identity", "compatible"].includes(authorLevel)) ||
    shared ||
    contradictingIdentifierOwner;
  return {
    workId: work.source.id,
    weightBits,
    probability: probabilityForBits(weightBits),
    titleSimilarity,
    titleExact,
    authorLevel,
    identifierEditions,
    identifierMethods: equalIsbns.length
      ? ["isbn"]
      : equalExternal.length
        ? ["identifier"]
        : [],
    identifierConflict,
    flags,
    vetoes,
    reasons: [...reasons, ...vetoes],
    components,
  };
}
