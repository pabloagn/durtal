import type { EbookFormat } from "../formats";

/*
 * What a file is, by its bytes (SLN-494). Magic bytes first; the name only
 * breaks ties (".kepub.epub", ".azw"). Pure: the caller reads the head, and
 * for a zip its entry names, for a PalmDB file its record 0.
 */

export type SniffResult = { kind: "ebook"; format: EbookFormat } | { kind: "not-ebook"; reason: string };

export interface SniffExtra {
  /** The entry names of a zip, when the head is one */
  zipEntries?: readonly string[] | null;
  /** Record 0 of a PalmDB (MOBI) file */
  mobiRecord0?: Uint8Array | null;
}

/** How much of a file sniffing reads; FictionBook's root must be in the first 4 KiB */
export const SNIFF_HEAD_BYTES = 4096;

const latin1 = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
const startsWith = (bytes: Uint8Array, magic: string, at = 0) =>
  bytes.length >= at + magic.length && latin1(bytes, at, magic.length) === magic;
const u16 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8)) >>> 0;
const u32be = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

const ebook = (format: EbookFormat): SniffResult => ({ kind: "ebook", format });
const notEbook = (what: string): SniffResult => ({ kind: "not-ebook", reason: `Not an e-book (${what})` });

const IMAGE_ENTRY = /\.(jpe?g|png|gif|webp|bmp|tiff?|avif)$/i;

/** The first local entry of a zip: a stored `mimetype` naming EPUB */
function storedEpubMimetype(head: Uint8Array): boolean {
  if (head.length < 30) return false;
  const method = u16(head, 8);
  const nameLength = u16(head, 26);
  const extraLength = u16(head, 28);
  if (method !== 0 || latin1(head, 30, nameLength) !== "mimetype") return false;
  return startsWith(head, "application/epub+zip", 30 + nameLength + extraLength);
}

function sniffZip(head: Uint8Array, name: string, entries: readonly string[] | null | undefined): SniffResult {
  const epub = name.toLowerCase().endsWith(".kepub.epub") || name.toLowerCase().endsWith(".kepub") ? "kepub" : "epub";
  if (storedEpubMimetype(head)) return ebook(epub);
  if (!entries) return notEbook("zip archive");
  const files = entries.filter((e) => !e.endsWith("/") && !e.startsWith("__MACOSX/") && !/(^|\/)\./.test(e));
  if (files.includes("META-INF/container.xml") && files.includes("mimetype")) return ebook(epub);
  if (files.includes("word/document.xml")) return ebook("docx");
  const fb2 = files.filter((e) => e.toLowerCase().endsWith(".fb2"));
  if (fb2.length === 1) return ebook("fbz");
  const pages = files.filter((e) => !/(^|\/)comicinfo\.xml$/i.test(e));
  if (pages.length > 0 && pages.every((e) => IMAGE_ENTRY.test(e))) return ebook("cbz");
  return notEbook("zip archive");
}

/**
 * KF8 in record 0: a MOBI header of version 8, or an EXTH 121 record (the
 * KF8 boundary of a joint MOBI and KF8 file).
 */
export function isKf8(record0: Uint8Array | null | undefined): boolean {
  if (!record0 || !startsWith(record0, "MOBI", 16)) return false;
  const headerLength = u32be(record0, 20);
  const version = u32be(record0, 36);
  if (version >= 8) return true;
  const exthFlags = record0.length >= 132 ? u32be(record0, 128) : 0;
  const exth = 16 + headerLength;
  if (!(exthFlags & 0x40) || !startsWith(record0, "EXTH", exth)) return false;
  const count = u32be(record0, exth + 8);
  for (let at = exth + 12, i = 0; i < count && at + 8 <= record0.length; i++) {
    const type = u32be(record0, at);
    const length = u32be(record0, at + 4);
    if (type === 121) return u32be(record0, at + 8) !== 0xffffffff;
    if (length < 8) break;
    at += length;
  }
  return false;
}

/** Valid UTF-8 (a character cut by the end of the head aside), with no NUL */
function isUtf8Text(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let end = head.length;
  // Drop a character the head cut in half: up to 3 trailing bytes
  for (let back = 1; back <= 3 && end - back >= 0; back++) {
    const byte = head[end - back];
    if ((byte & 0xc0) === 0x80) continue;
    const need = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (need > back) end -= back;
    break;
  }
  if (head.subarray(0, end).includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, end));
    return true;
  } catch {
    return false;
  }
}

/** The format of a file from its first bytes (at least 4 KiB when it has them) */
export function sniffFormat(head: Uint8Array, name: string, extra: SniffExtra = {}): SniffResult {
  const lower = name.toLowerCase();
  if (startsWith(head, "PK\x03\x04")) return sniffZip(head, name, extra.zipEntries);
  if (startsWith(head, "PK\x05\x06")) return notEbook("empty zip archive");
  // PDF: the header may follow a little junk (within 1 KiB, as readers allow)
  if (latin1(head, 0, Math.min(head.length, 1024)).includes("%PDF-")) return ebook("pdf");
  if (startsWith(head, "BOOKMOBI", 60)) {
    if (isKf8(extra.mobiRecord0)) return ebook("azw3");
    return ebook(lower.endsWith(".azw") ? "azw" : "mobi");
  }
  if (startsWith(head, "TPZ")) return ebook("azw");
  // A KFX container: "CONT" and its version (1 or 2); or a DRMION wrapper
  if ((startsWith(head, "CONT") && [1, 2].includes(u16(head, 4))) || startsWith(head, "\xEADRMION")) return ebook("kfx");
  if (startsWith(head, "AT&TFORM")) return ebook("djvu");
  if (startsWith(head, "Rar!")) return ebook("cbr");
  if (startsWith(head, "ITSF")) return ebook("chm");
  if (startsWith(head, "ITOLITLS")) return ebook("lit");
  if (startsWith(head, "{\\rtf")) return ebook("rtf");
  if (startsWith(head, "\xFF\xD8\xFF")) return notEbook("JPEG image");
  if (startsWith(head, "\x89PNG")) return notEbook("PNG image");
  if (startsWith(head, "GIF8")) return notEbook("GIF image");
  if (startsWith(head, "RIFF") && startsWith(head, "WEBP", 8)) return notEbook("WebP image");
  if (startsWith(head, "II*\0") || startsWith(head, "MM\0*")) return notEbook("TIFF image");
  if (startsWith(head, "7z\xBC\xAF\x27\x1C")) return notEbook("7z archive");
  if (startsWith(head, "\x1F\x8B")) return notEbook("gzip archive");
  const text = latin1(head, 0, Math.min(head.length, SNIFF_HEAD_BYTES));
  if (text.includes("<FictionBook")) return ebook("fb2");
  if (isUtf8Text(head)) return ebook("txt");
  return notEbook("binary file");
}
