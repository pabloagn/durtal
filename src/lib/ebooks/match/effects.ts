import { normalizeLanguage } from "@/lib/utils/language";
import { naturalAuthorName, defaultSortName } from "@/lib/utils/author-names";
import { authorForms, type MatchCatalogue } from "./catalogue";
import { authorAgreement, authorKey, identifierKeys, titleKeys } from "./keys";
import { preferredMatchFile } from "./editions";
import type { MatchEbook, NewEditionEffect, Reason } from "./types";

export interface AuthorEffect {
  existingId: string | null;
  /** Pure batch identity; the writer allocates an actual UUID once for each distinct key. */
  createKey: string | null;
  name: string;
  sortName: string;
}
export interface AccessionEffect {
  ebookId: string;
  ready: boolean;
  missing: readonly string[];
  ambiguities: readonly Reason[];
  authors: readonly AuthorEffect[];
  work: {
    kind: "book";
    title: string;
    originalLanguage: string;
    originalYear: null;
    catalogueStatus: "accessioned";
    metadataSource: "ebook";
    metadataSourceId: string;
    seriesName: string | null;
    seriesPosition: string | null;
  } | null;
  edition: NewEditionEffect | null;
  copy: {
    locationId: string;
    format: "epub" | "pdf" | "ebook";
    fileSizeBytes: number;
    status: "available";
  } | null;
  text: string;
}
export interface AccessionChoices {
  /** Explicit existing author id or user-chosen new author name; unknown ids are refused. */
  authors?: readonly ({ id: string } | { name: string })[];
  language?: string;
  isbn13?: string | null;
}
function accessionText(
  effect: Pick<AccessionEffect, "ready" | "work" | "authors">,
): string {
  return effect.ready
    ? `Creates ${effect.work!.title}, its edition and a digital copy · ${effect.authors.map((author) => `${author.existingId ? "author already in Durtal" : "new author"}: ${author.name}`).join("; ")}`
    : `Needs review before creating ${effect.work?.title || "the book"}`;
}
function resolveAuthor(
  name: string,
  catalogue: MatchCatalogue,
): { effect: AuthorEffect | null; ambiguity: Reason | null } {
  const key = authorKey(name);
  if (!key) return { effect: null, ambiguity: null };
  const exact = catalogue.source.authors.filter((author) =>
    authorForms(author).some((form) => form.identity === key.identity),
  );
  if (exact.length > 1)
    return {
      effect: null,
      ambiguity: {
        code: "author_identity",
        text: `Several catalogue people are named ${name}; choose the author`,
      },
    };
  if (exact.length === 1)
    return {
      effect: {
        existingId: exact[0].id,
        createKey: null,
        name: exact[0].name,
        sortName: exact[0].sortName ?? defaultSortName(exact[0].name),
      },
      ambiguity: null,
    };
  const compatible = catalogue.source.authors.filter(
    (author) => authorAgreement([key], authorForms(author)) === "compatible",
  );
  if (compatible.length)
    return {
      effect: null,
      ambiguity: {
        code: "author_compatible",
        text: `${name} may be a catalogue person; choose the author before creating another`,
      },
    };
  const natural = naturalAuthorName(name).trim();
  return {
    effect: {
      existingId: null,
      createKey: `author:${key.identity}`,
      name: natural,
      sortName: defaultSortName(natural),
    },
    ambiguity: null,
  };
}
/** Preview only. Publication dates never become original work years; no inferred translator is created. */
export function accessionEffect(
  ebook: MatchEbook,
  catalogue: MatchCatalogue,
  choices: AccessionChoices = {},
): AccessionEffect {
  const missing: string[] = [];
  const ambiguities: Reason[] = [];
  const authors: AuthorEffect[] = [];
  if (ebook.instanceId || ebook.matchState === "linked")
    ambiguities.push({
      code: "already_linked",
      text: "This ebook already belongs to a book",
    });
  for (const entry of choices.authors ??
    ebook.authors.map((name) => ({ name }))) {
    if ("id" in entry) {
      const author = catalogue.source.authors.find(
        (candidate) => candidate.id === entry.id,
      );
      if (!author)
        ambiguities.push({
          code: "author_missing",
          text: "The chosen author no longer exists",
        });
      else
        authors.push({
          existingId: author.id,
          createKey: null,
          name: author.name,
          sortName: author.sortName ?? defaultSortName(author.name),
        });
    } else {
      // A supplied name is an explicit choice to create that person, except ambiguous exact identities.
      const resolved = resolveAuthor(entry.name, catalogue);
      if (
        resolved.ambiguity &&
        !(choices.authors && resolved.ambiguity.code === "author_compatible")
      )
        ambiguities.push(resolved.ambiguity);
      else if (resolved.effect) authors.push(resolved.effect);
      else if (choices.authors && authorKey(entry.name))
        authors.push({
          existingId: null,
          createKey: `author:${authorKey(entry.name)!.identity}`,
          name: naturalAuthorName(entry.name),
          sortName: defaultSortName(naturalAuthorName(entry.name)),
        });
    }
  }
  const uniqueAuthors = [
    ...new Map(
      authors.map((author) => [author.existingId ?? author.createKey, author]),
    ).values(),
  ];
  if (!uniqueAuthors.length) missing.push("author");
  const file = preferredMatchFile(ebook);
  const detected = new Set(
    ebook.files
      .filter((item) => item.availability !== "blocked")
      .map((item) => normalizeLanguage(item.textLanguage))
      .filter((language): language is string => !!language),
  );
  const language =
    normalizeLanguage(choices.language) ??
    (choices.language === undefined
      ? (normalizeLanguage(ebook.language) ??
        (detected.size === 1 ? [...detected][0] : null))
      : null);
  if (!language) missing.push("language");
  if (!file) missing.push("verified_file");
  if (!catalogue.source.ebookLocationId) missing.push("ebook_location");
  const isbns = identifierKeys(ebook.isbns, ebook.identifiers).isbns;
  let isbn13: string | null = null;
  if (choices.isbn13 !== undefined) {
    if (choices.isbn13 !== null && !isbns.includes(choices.isbn13))
      ambiguities.push({
        code: "isbn_choice",
        text: "Choose a valid ISBN declared by this ebook, or create the edition without one",
      });
    else isbn13 = choices.isbn13;
  } else if (isbns.length > 1)
    ambiguities.push({
      code: "multiple_isbns",
      text: "Choose which ISBN identifies the ebook edition, or create it without one",
    });
  else isbn13 = isbns[0] ?? null;
  if (
    isbn13 &&
    (catalogue.isbnEditionIds.has(isbn13) || catalogue.sharedIsbns.has(isbn13))
  )
    ambiguities.push({
      code: "isbn_held",
      text: "This ISBN is shared or already held; link the existing book or choose no ISBN",
    });
  const title = titleKeys(
    ebook.title,
    ebook.subtitle,
    ebook.language,
    ebook.series,
  ).cleaned;
  if (!title) missing.push("title");
  const work: AccessionEffect["work"] = language
    ? {
        kind: "book",
        title,
        originalLanguage: language,
        originalYear: null,
        catalogueStatus: "accessioned",
        metadataSource: "ebook",
        metadataSourceId: ebook.id,
        seriesName: ebook.series ?? null,
        seriesPosition:
          ebook.seriesIndex == null ? null : String(ebook.seriesIndex),
      }
    : null;
  const edition = language
    ? {
        title,
        subtitle: ebook.subtitle ?? null,
        language,
        isbn13,
        publisher: ebook.publisher ?? null,
        publicationYear: ebook.publishedYear ?? null,
        metadataSource: "ebook" as const,
        coverSourceKey: file?.coverKey ?? null,
      }
    : null;
  const copy =
    file && catalogue.source.ebookLocationId
      ? {
          locationId: catalogue.source.ebookLocationId,
          format:
            file.format === "epub" || file.format === "kepub"
              ? ("epub" as const)
              : file.format === "pdf"
                ? ("pdf" as const)
                : ("ebook" as const),
          fileSizeBytes: file.sizeBytes,
          status: "available" as const,
        }
      : null;
  const ready = !missing.length && !ambiguities.length;
  return {
    ebookId: ebook.id,
    ready,
    missing,
    ambiguities,
    authors: uniqueAuthors,
    work,
    edition,
    copy,
    text: accessionText({ ready, work, authors: uniqueAuthors }),
  };
}
/** Unambiguous initial/full-name variants in one batch share one new-author key. Never cluster two known people. */
export function accessionBatchEffects(
  ebooks: readonly MatchEbook[],
  catalogue: MatchCatalogue,
  choices: ReadonlyMap<string, AccessionChoices> = new Map(),
): AccessionEffect[] {
  const effects = [...ebooks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((ebook) => accessionEffect(ebook, catalogue, choices.get(ebook.id)));
  const newAuthors = [
    ...new Map(
      effects
        .flatMap((effect) => effect.authors)
        .filter((author) => author.createKey)
        .map((author) => [author.createKey!, author]),
    ).values(),
  ];
  for (const author of newAuthors) {
    const key = authorKey(author.name)!;
    const compatible = newAuthors.filter(
      (other) =>
        other.createKey !== author.createKey &&
        authorAgreement([key], [authorKey(other.name)!]) === "compatible",
    );
    const full = [author, ...compatible].filter((other) =>
      authorKey(other.name)!.given.every((part) => part.length > 1),
    );
    const distinctFull = new Set(
      full.map((other) => authorKey(other.name)!.identity),
    );
    if (distinctFull.size > 1) {
      for (const effect of effects.filter((effect) =>
        effect.authors.some((entry) => entry.createKey === author.createKey),
      )) {
        effect.ready = false;
        effect.ambiguities = [
          ...effect.ambiguities,
          {
            code: "batch_author",
            text: `${author.name} is compatible with several full names; choose the author`,
          },
        ];
        effect.text = "Needs an author choice before batch accession";
      }
      continue;
    }
    const leader = [...(full.length ? full : [author, ...compatible])].sort(
      (a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name),
    )[0];
    for (const effect of effects)
      effect.authors = effect.authors.map((entry) =>
        entry.createKey === author.createKey ? { ...leader } : entry,
      );
  }
  for (const effect of effects) {
    effect.authors = [
      ...new Map(
        effect.authors.map((author) => [
          author.existingId ?? author.createKey,
          author,
        ]),
      ).values(),
    ];
    effect.text = accessionText(effect);
  }
  return effects;
}
