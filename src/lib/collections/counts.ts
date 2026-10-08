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

/** "12 editions" for a collection of book editions only, else "5 items" */
export function collectionCountLabel({
  editionCount,
  workCount = 0,
}: {
  editionCount: number;
  workCount?: number;
}) {
  if (!workCount) return `${editionCount} ${editionCount === 1 ? "edition" : "editions"}`;
  const total = editionCount + workCount;
  return `${total} ${total === 1 ? "item" : "items"}`;
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
