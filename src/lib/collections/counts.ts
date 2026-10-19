import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";

/**
 * What a collection holds, each once, counted in SQL (`collectionTallySql`)
 * or from its member rows: every edition, the books they belong to, and the
 * whole works by kind except a book that also has an edition there (the
 * edition stands for it)
 */
export interface MemberTally {
  editions: number;
  /** Books held through their editions */
  byEdition: number;
  /** Books held whole, with no edition of theirs there */
  books: number;
  films: number;
  perfumes: number;
  paintings: number;
}

type CountedCollection =
  | { tally: MemberTally }
  | {
      tally?: undefined;
      collectionEditions?: { edition?: { workId: string } | null }[];
      collectionWorks?: { workId: string; work?: { kind: WorkKind } | null }[];
    };

/** A collection's tally: the one counted in SQL, else from its member rows */
export function memberTally(collection: CountedCollection): MemberTally {
  if (collection.tally) return collection.tally;
  const editions = collection.collectionEditions ?? [];
  const byEdition = new Set(editions.flatMap((m) => (m.edition ? [m.edition.workId] : [])));
  const works = (collection.collectionWorks ?? []).filter((m) => !byEdition.has(m.workId));
  const of = (kind: WorkKind) => works.filter((m) => (m.work?.kind ?? "book") === kind).length;
  return {
    editions: editions.length,
    byEdition: byEdition.size,
    books: of("book"),
    films: of("film"),
    perfumes: of("perfume"),
    paintings: of("painting"),
  };
}

/**
 * What a collection holds, counted as its page shows it: every edition, and
 * every whole work except a book that also has an edition there (the edition
 * stands for it). A book collected both ways counts once.
 */
export function collectionCounts(collection: CountedCollection) {
  const t = memberTally(collection);
  return { editionCount: t.editions, workCount: t.books + t.films + t.perfumes + t.paintings };
}

/**
 * A collection's one count line, the same on its card and its page: "6
 * books", "3 books · 1 perfume", "1,050 films". A book counts once, held
 * whole or through its editions; more editions than the books they hold say
 * so: "5 books (6 editions)" (SLN-915). `null` when it holds nothing, so
 * the card says "Empty" and the page leaves the line out.
 */
export function collectionCountLine(collection: CountedCollection) {
  const { books, editions, byEdition, kinds } = members(collection);
  const n = (count: number, one: string, many: string) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
  const shown = [
    books && `${n(books, "book", "books")}${editions > byEdition ? ` (${n(editions, "edition", "editions")})` : ""}`,
    ...kinds.map(([count, one, many]) => count && n(count, one, many)),
  ].filter(Boolean);
  return shown.length ? shown.join(" · ") : null;
}

/**
 * What the pager calls a collection's members, one per card: "books" when
 * each card is a book of its own, "editions" when every card is an edition,
 * a kind's name when all are of it, else "items" (SLN-886, SLN-915)
 */
export function collectionMembersNoun(collection: CountedCollection) {
  const { books, editions, byEdition, wholeBooks, kinds } = members(collection);
  const others = kinds.filter(([count]) => count > 0);
  if (!others.length && books && editions === byEdition) return "books";
  if (!others.length && editions && !wholeBooks) return "editions";
  if (!books && others.length === 1) return others[0][2];
  return "items";
}

/** What a collection holds, each once: a book collected both ways counts as its editions */
function members(collection: CountedCollection) {
  const t = memberTally(collection);
  const kinds: [number, string, string][] = [
    [t.films, "film", "films"],
    [t.perfumes, "perfume", "perfumes"],
    [t.paintings, "painting", "paintings"],
  ];
  return { books: t.byEdition + t.books, editions: t.editions, byEdition: t.byEdition, wholeBooks: t.books, kinds };
}

/**
 * What some works are called, given one kind per work: "perfume", "films";
 * works of more than one kind are "items", as the collection counts say
 */
export function worksNoun(kinds: readonly WorkKind[]) {
  const many = kinds.length !== 1;
  const kind = kinds[0];
  if (!kind || kinds.some((k) => k !== kind)) return many ? "items" : "item";
  const domain = WORK_DOMAINS[kind];
  return (many ? domain.pluralLabel : domain.label).toLowerCase();
}

/** The toast after a new collection takes what was chosen, one kind per work */
export function collectionCreatedMessage(kinds: readonly WorkKind[]) {
  return kinds.length === 1
    ? `Collection created with this ${worksNoun(kinds)}`
    : `Collection created with these ${kinds.length} ${worksNoun(kinds)}`;
}

/** The toast after a collection is deleted, given one kind per work it held */
export function collectionDeletedMessage(kinds: readonly WorkKind[]) {
  if (!kinds.length) return "Collection deleted";
  return `Collection deleted. Its ${worksNoun(kinds)} ${kinds.length === 1 ? "stays" : "stay"} in your library.`;
}

/** What a collection can hold: "books, perfumes, films and paintings" */
export function collectableNouns() {
  const nouns = getEnabledWorkKinds().map((kind) => WORK_DOMAINS[kind].pluralLabel.toLowerCase());
  return nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}` : (nouns[0] ?? "");
}
