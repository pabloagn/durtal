/**
 * How many books a series has, against its known total: "3 books of 7". A
 * series holding more books than its total (a novella numbered 2.5, or a
 * total typed wrong) leaves the total out, so no count reads "5 of 4"
 * (SLN-915).
 */
export function seriesBooksLabel(count: number, totalVolumes: number | null | undefined) {
  const books = `${count.toLocaleString("en-US")} ${count === 1 ? "book" : "books"}`;
  return totalVolumes && totalVolumes >= count ? `${books} of ${totalVolumes.toLocaleString("en-US")}` : books;
}

/** What "owned" and "read" count against: the total, or the books held when there are more */
export function seriesOutOf(count: number, totalVolumes: number | null | undefined) {
  return Math.max(totalVolumes ?? 0, count);
}
