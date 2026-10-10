import { normalizeLanguage } from "@/lib/utils/language";
import { normalizeSearchText } from "@/lib/utils/search-text";
import {
  authorKey,
  duplicateMetadataKey,
  identifierKeys,
  titleKeys,
  type AuthorKey,
  type TitleKeys,
} from "./keys";
import type { CatalogueSnapshot, MatchEbook, MatchWork } from "./types";

export interface IndexedWork {
  source: MatchWork;
  titles: readonly TitleKeys[];
  authors: readonly AuthorKey[];
  languages: ReadonlySet<string>;
  series: ReadonlySet<string>;
  isbns: ReadonlySet<string>;
  external: ReadonlySet<string>;
  editionIdentifiers: ReadonlyMap<string, ReturnType<typeof identifierKeys>>;
}
export interface MatchCatalogue {
  source: CatalogueSnapshot;
  works: readonly IndexedWork[];
  byWorkId: ReadonlyMap<string, IndexedWork>;
  isbnEditionIds: ReadonlyMap<string, readonly string[]>;
  identifierWorkIds: ReadonlyMap<string, ReadonlySet<string>>;
  sharedIsbns: ReadonlySet<string>;
  commonTitles: ReadonlySet<string>;
  duplicateGroups: ReadonlyMap<string, readonly MatchEbook[]>;
}
export function authorForms(
  author: CatalogueSnapshot["authors"][number],
): AuthorKey[] {
  return [
    author.name,
    author.sortName,
    author.realName,
    [author.firstName, author.lastName].filter(Boolean).join(" "),
    ...author.aliases,
  ]
    .filter((name): name is string => !!name)
    .map(authorKey)
    .filter((key): key is AuthorKey => !!key);
}
/** Builds indexes without changing input records. No global connection or catalogue service is imported. */
export function indexCatalogue(source: CatalogueSnapshot): MatchCatalogue {
  const workIds = new Set<string>();
  const editionIds = new Set<string>();
  const copyIds = new Set<string>();
  const isbnEditionIds = new Map<string, string[]>();
  const identifierWorkIds = new Map<string, Set<string>>();
  const titleAuthors = new Map<string, Set<string>>();
  const authorIdsByIdentity = new Map(
    source.authors.flatMap((author) =>
      authorForms(author).map((key) => [key.identity, author.id] as const),
    ),
  );
  const addTitle = (
    titles: readonly TitleKeys[],
    authors: readonly string[],
  ) => {
    for (const key of titles.flatMap((title) => [...title.all])) {
      const held = titleAuthors.get(key) ?? new Set<string>();
      authors.forEach((author) => held.add(author));
      titleAuthors.set(key, held);
    }
  };
  const works = [...source.works]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((work): IndexedWork => {
      if (work.kind !== "book" || workIds.has(work.id))
        throw new Error("Matching requires unique book works");
      workIds.add(work.id);
      const titles = [
        titleKeys(work.title, null, work.originalLanguage),
        ...(work.originalTitle
          ? [titleKeys(work.originalTitle, null, work.originalLanguage)]
          : []),
      ];
      const languages = new Set<string>();
      const original = normalizeLanguage(work.originalLanguage);
      if (original) languages.add(original);
      const ids = identifierKeys([], work.identifiers);
      const isbns = new Set(ids.isbns);
      const external = new Set(ids.external);
      const editionIdentifiers = new Map<
        string,
        ReturnType<typeof identifierKeys>
      >();
      for (const edition of work.editions) {
        if (edition.workId !== work.id || editionIds.has(edition.id))
          throw new Error(
            "An edition must belong to exactly one candidate book",
          );
        editionIds.add(edition.id);
        titles.push(
          titleKeys(edition.title, edition.subtitle, edition.language),
        );
        const language = normalizeLanguage(edition.language);
        if (language && edition.metadataSource !== "phantom_canon")
          languages.add(language);
        const keys = identifierKeys(
          [edition.isbn13 ?? "", edition.isbn10 ?? ""],
          edition.identifiers,
        );
        editionIdentifiers.set(edition.id, keys);
        keys.isbns.forEach((isbn) => {
          isbns.add(isbn);
          isbnEditionIds.set(isbn, [
            ...(isbnEditionIds.get(isbn) ?? []),
            edition.id,
          ]);
        });
        keys.external.forEach((id) => external.add(id));
      }
      for (const copy of work.copies) {
        if (!editionIdentifiers.has(copy.editionId) || copyIds.has(copy.id))
          throw new Error("A digital copy must belong to its candidate book");
        copyIds.add(copy.id);
      }
      addTitle(
        titles,
        work.authors.map((author) => author.id),
      );
      for (const key of [
        ...[...isbns].map((isbn) => `isbn:${isbn}`),
        ...external,
      ]) {
        const owners = identifierWorkIds.get(key) ?? new Set<string>();
        owners.add(work.id);
        identifierWorkIds.set(key, owners);
      }
      return {
        source: work,
        titles,
        authors: work.authors.flatMap(authorForms),
        languages,
        series: new Set(work.series.map(normalizeSearchText).filter(Boolean)),
        isbns,
        external,
        editionIdentifiers,
      };
    });
  const isbnTitles = new Map<
    string,
    { ebooks: Set<string>; titles: Set<string> }
  >();
  const ebookIds = new Set<string>();
  const duplicateGroups = new Map<string, MatchEbook[]>();
  for (const ebook of source.ebooks) {
    if (ebookIds.has(ebook.id))
      throw new Error("Matching requires unique ebook records");
    ebookIds.add(ebook.id);
    const duplicateKey = duplicateMetadataKey(ebook);
    if (duplicateKey)
      duplicateGroups.set(duplicateKey, [
        ...(duplicateGroups.get(duplicateKey) ?? []),
        ebook,
      ]);
    const titles = titleKeys(
      ebook.title,
      ebook.subtitle,
      ebook.language,
      ebook.series,
    );
    const authors = ebook.authors
      .map(authorKey)
      .filter((key): key is AuthorKey => !!key)
      .map(
        (key) =>
          authorIdsByIdentity.get(key.identity) ?? `name:${key.identity}`,
      );
    addTitle([titles], authors);
    for (const isbn of identifierKeys(ebook.isbns, ebook.identifiers).isbns) {
      const held = isbnTitles.get(isbn) ?? {
        ebooks: new Set<string>(),
        titles: new Set<string>(),
      };
      held.ebooks.add(ebook.id);
      held.titles.add(titles.main);
      isbnTitles.set(isbn, held);
    }
  }
  return {
    source,
    works,
    byWorkId: new Map(works.map((work) => [work.source.id, work])),
    isbnEditionIds,
    identifierWorkIds,
    duplicateGroups,
    sharedIsbns: new Set(
      [...isbnTitles]
        .filter(([, held]) => held.ebooks.size >= 3 && held.titles.size > 1)
        .map(([isbn]) => isbn),
    ),
    commonTitles: new Set(
      [...titleAuthors]
        .filter(([, authors]) => authors.size >= 3)
        .map(([title]) => title),
    ),
  };
}
