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
