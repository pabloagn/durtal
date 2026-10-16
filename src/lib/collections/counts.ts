import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";

/**
 * What a collection holds, counted as its page shows it: every edition, and
 * every whole work except a book that also has an edition there (the edition
 * stands for it). A book collected both ways counts once.
 */
export function collectionCounts(collection: {
  collectionEditions?: { edition?: { workId: string } | null }[];
  collectionWorks?: { workId: string }[];
}) {
  const editions = collection.collectionEditions ?? [];
  const byEdition = new Set(editions.flatMap((m) => (m.edition ? [m.edition.workId] : [])));
  const works = (collection.collectionWorks ?? []).filter((m) => !byEdition.has(m.workId));
  return { editionCount: editions.length, workCount: works.length };
}

type CountedCollection = {
  collectionEditions?: { edition?: { workId: string } | null }[];
  collectionWorks?: { workId: string; work?: { kind: WorkKind } | null }[];
};

/**
 * A collection's one count line, the same on its card and its page: "6
 * books", "4 editions", "3 books · 1 perfume", "1,050 films". Counted as `collectionCounts`
 * counts (an edition stands for its book); `null` when it holds nothing, so
 * the card says "Empty" and the page leaves the line out.
 */
export function collectionCountLine(collection: CountedCollection) {
  const shown = countParts(collection);
  return shown.length
    ? shown.map(([n, one, many]) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`).join(" · ")
    : null;
}

/**
 * What the pager calls a collection's members: the count line's one noun
 * ("books") when it has one, else "items" (SLN-886)
 */
export function collectionMembersNoun(collection: CountedCollection) {
  const shown = countParts(collection);
  return shown.length === 1 ? shown[0][2] : "items";
}

/** The count line's parts with members, each once: a book collected both ways counts as its editions */
function countParts(collection: CountedCollection) {
  const editions = collection.collectionEditions ?? [];
  const byEdition = new Set(editions.flatMap((m) => (m.edition ? [m.edition.workId] : [])));
  const works = (collection.collectionWorks ?? []).filter((m) => !byEdition.has(m.workId));
  const of = (kind: WorkKind) => works.filter((m) => (m.work?.kind ?? "book") === kind).length;
  const parts: [number, string, string][] = [
    [of("book"), "book", "books"],
    [editions.length, "edition", "editions"],
    [of("film"), "film", "films"],
    [of("perfume"), "perfume", "perfumes"],
    [of("painting"), "painting", "paintings"],
  ];
  return parts.filter(([n]) => n > 0);
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
