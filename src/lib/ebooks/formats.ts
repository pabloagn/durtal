/**
 * E-book file formats (SLN-490). Every format can be stored; the reader opens
 * the readable ones. A text's files are offered in FORMAT_PREFERENCE order.
 */

export const EBOOK_FORMATS = [
  "epub",
  "kepub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "kfx",
  "fb2",
  "fbz",
  "cbz",
  "cbr",
  "djvu",
  "txt",
  "rtf",
  "docx",
  "lit",
  "chm",
  "other",
] as const;
export type EbookFormat = (typeof EBOOK_FORMATS)[number];

/** The formats the reader opens; the rest are stored and downloadable only */
export const READABLE_FORMATS = ["epub", "kepub", "pdf", "mobi", "azw", "azw3", "fb2", "fbz", "cbz"] as const satisfies readonly EbookFormat[];

/** The order in which a text's files are offered to the reader */
export const FORMAT_PREFERENCE = ["epub", "kepub", "azw3", "mobi", "azw", "fb2", "fbz", "pdf", "cbz"] as const satisfies readonly EbookFormat[];

const CONTENT_TYPES: Record<EbookFormat, string> = {
  epub: "application/epub+zip",
  kepub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw: "application/vnd.amazon.ebook",
  azw3: "application/vnd.amazon.mobi8-ebook",
  kfx: "application/vnd.amazon.ebook",
  fb2: "application/x-fictionbook+xml",
  fbz: "application/x-zip-compressed-fb2",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  djvu: "image/vnd.djvu",
  txt: "text/plain; charset=utf-8",
  rtf: "application/rtf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  lit: "application/x-ms-reader",
  chm: "application/vnd.ms-htmlhelp",
  other: "application/octet-stream",
};

const LABELS: Record<EbookFormat, string> = {
  epub: "EPUB",
  kepub: "Kobo EPUB",
  pdf: "PDF",
  mobi: "MOBI",
  azw: "AZW",
  azw3: "AZW3",
  kfx: "KFX",
  fb2: "FB2",
  fbz: "FBZ",
  cbz: "CBZ",
  cbr: "CBR",
  djvu: "DjVu",
  txt: "Text",
  rtf: "RTF",
  docx: "Word",
  lit: "LIT",
  chm: "CHM",
  other: "Other",
};

export function isEbookFormat(value: unknown): value is EbookFormat {
  return typeof value === "string" && (EBOOK_FORMATS as readonly string[]).includes(value);
}

export function isReadableFormat(format: string): boolean {
  return (READABLE_FORMATS as readonly string[]).includes(format);
}

/** The Content-Type a file of this format is served with */
export function contentTypeFor(format: string): string {
  return isEbookFormat(format) ? CONTENT_TYPES[format] : CONTENT_TYPES.other;
}

/** "EPUB", "Kobo EPUB", "PDF" */
export function formatLabel(format: string): string {
  return isEbookFormat(format) ? LABELS[format] : format.toUpperCase();
}

/** A format's place in FORMAT_PREFERENCE; formats the reader cannot open come last */
export function formatRank(format: string): number {
  const at = (FORMAT_PREFERENCE as readonly string[]).indexOf(format);
  return at === -1 ? FORMAT_PREFERENCE.length : at;
}
