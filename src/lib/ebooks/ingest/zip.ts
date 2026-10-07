import { configure, Reader, TextWriter, Uint8ArrayWriter, ZipReader, type Entry } from "@zip.js/zip.js";
import type { ByteSource } from "./source";

/*
 * Zips by their central directory (SLN-494): EPUB, KEPUB, CBZ, FBZ and DOCX.
 * zip.js reads only the ranges it needs from a ByteSource, so a 300 MB comic
 * is listed without reading its pages. The end-of-central-directory record
 * gives the reader's manifest its `cdOffset`.
 */

configure({ useWebWorkers: false });

/** An entry larger than this is never inflated into memory (a zip bomb, or not a part of a book) */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

class SourceReader extends Reader<ByteSource> {
  private readonly source: ByteSource;
  constructor(source: ByteSource) {
    super(source);
    this.source = source;
  }
  async init() {
    this.size = this.source.size;
  }
  async readUint8Array(index: number, length: number) {
    return this.source.read(index, length);
  }
}

export interface CentralDirectory {
  cdOffset: number;
  cdSize: number;
  entries: number;
}

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
/** The end record is 22 bytes, after a comment of at most 65,535 */
const EOCD_SEARCH = 22 + 65535;

/** Where the central directory is, from the end-of-central-directory record (ZIP64 too) */
export async function readCentralDirectory(source: ByteSource): Promise<CentralDirectory | null> {
  const start = Math.max(0, source.size - EOCD_SEARCH);
  const tail = await source.read(start, source.size - start);
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (view.getUint32(at, true) !== EOCD) continue;
    let entries = view.getUint16(at + 10, true);
    let cdSize = view.getUint32(at + 12, true);
    let cdOffset = view.getUint32(at + 16, true);
    if ((entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && at >= 20 && view.getUint32(at - 20, true) === ZIP64_LOCATOR) {
      const recordAt = Number(view.getBigUint64(at - 20 + 8, true));
      const record = await source.read(recordAt, 56);
      const r = new DataView(record.buffer, record.byteOffset, record.byteLength);
      if (record.length < 56 || r.getUint32(0, true) !== ZIP64_EOCD) return null;
      entries = Number(r.getBigUint64(32, true));
      cdSize = Number(r.getBigUint64(40, true));
      cdOffset = Number(r.getBigUint64(48, true));
    }
    if (cdOffset + cdSize > source.size) return null;
    return { cdOffset, cdSize, entries };
  }
  return null;
}

export interface OpenZip {
  /** File entries by name (folders left out) */
  entries: Map<string, Entry>;
  names: string[];
  directory: CentralDirectory | null;
  text(name: string): Promise<string>;
  bytes(name: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** A zip's directory; throws "Damaged zip: ..." when it cannot be read */
export async function openZip(source: ByteSource): Promise<OpenZip> {
  const reader = new ZipReader(new SourceReader(source));
  let list: Entry[];
  try {
    list = await reader.getEntries();
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new Error(/central directory/i.test(message) ? "Damaged zip: central directory missing" : `Damaged zip: ${message}`);
  }
  const entries = new Map(list.filter((e) => !e.directory).map((e) => [e.filename, e]));
  const entry = (name: string) => {
    const found = entries.get(name) ?? [...entries.values()].find((e) => e.filename.toLowerCase() === name.toLowerCase());
    if (!found) throw new Error(`${name} is missing`);
    if (found.uncompressedSize > MAX_ENTRY_BYTES) throw new Error(`${name} is larger than ${MAX_ENTRY_BYTES / 1024 / 1024} MB`);
    if (found.encrypted) throw new Error(`${name} is encrypted`);
    return found;
  };
  return {
    entries,
    names: [...entries.keys()],
    directory: await readCentralDirectory(source),
    text: async (name) => entry(name).getData!(new TextWriter()),
    bytes: async (name) => entry(name).getData!(new Uint8ArrayWriter()),
    close: () => reader.close(),
  };
}

/** A path inside the zip, from an href relative to a document in it */
export function resolveHref(base: string, href: string): string {
  const raw = href.split("#")[0].split("?")[0];
  let clean = raw;
  try {
    clean = decodeURIComponent(raw);
  } catch {
    // A stray % stays as written
  }
  if (!clean) return base;
  const parts = clean.startsWith("/") ? [] : base.split("/").slice(0, -1);
  for (const part of clean.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
