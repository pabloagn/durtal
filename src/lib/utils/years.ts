/** The first four-digit year in a source date ("1927-05-01", "May 1927"). */
export function parseYear(dateStr?: string): number | undefined {
  if (!dateStr) return undefined;
  const match = dateStr.match(/(\d{4})/);
  return match ? parseInt(match[1], 10) : undefined;
}

/** A year as the catalogue shows it: "1927", "428 BC". Years before Christ are negative. */
export function displayYear(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}
