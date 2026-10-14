/**
 * The edition a book's card shows: the earliest added, by id when two were
 * added at once (`getWorks` orders a work's editions so, and the card takes
 * the first). The book page's header shows its cover when the book has no
 * poster, so the page and the card agree.
 */
export function cardEdition<E extends { id: string; createdAt: Date }>(editions: E[]): E | undefined {
  return editions.reduce<E | undefined>(
    (first, e) =>
      !first ||
      e.createdAt < first.createdAt ||
      (e.createdAt.getTime() === first.createdAt.getTime() && e.id < first.id)
        ? e
        : first,
    undefined,
  );
}
