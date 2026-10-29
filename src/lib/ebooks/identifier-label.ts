/** Display names for common e-book identifier schemes; retain unfamiliar names readably. */
const LABELS: Record<string, string> = {
  isbn: "ISBN", isbn10: "ISBN-10", "isbn-10": "ISBN-10", isbn13: "ISBN-13", "isbn-13": "ISBN-13",
  asin: "ASIN", "mobi-asin": "Kindle ASIN", doi: "DOI", uuid: "UUID", uri: "URI", url: "URL",
  oclc: "OCLC", lccn: "LCCN", issn: "ISSN", calibre: "Calibre", google: "Google Books",
  goodreads: "Goodreads", openlibrary: "Open Library",
};

export function identifierLabel(scheme: string): string {
  return LABELS[scheme.toLowerCase()] ?? scheme.replace(/[_-]+/g, " ").replace(/^./u, (letter) => letter.toUpperCase());
}
