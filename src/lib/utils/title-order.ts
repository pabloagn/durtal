const titleCollator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/** One title order for browsing: ignore case/accents and compare volumes numerically. */
export function compareTitles(a: string, b: string): number {
  return titleCollator.compare(a.trim(), b.trim());
}

/** IDs keep equivalent titles in a deterministic order across page boundaries. */
export function compareWorks(
  a: { id: string; title: string },
  b: { id: string; title: string },
  order: "asc" | "desc" = "asc",
): number {
  const titleOrder = compareTitles(a.title, b.title);
  return (
    (order === "desc" ? -titleOrder : titleOrder) || a.id.localeCompare(b.id)
  );
}
