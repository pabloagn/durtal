/** A year as the catalogue shows it: "1927", "428 BC". Years before Christ are negative. */
export function displayYear(year: number): string {
  return year < 0 ? `${-year} BC` : String(year);
}
