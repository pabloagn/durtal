import { configure, Reader, TextWriter, Uint8ArrayWriter, Writer, ZipReader, type Entry } from "@zip.js/zip.js";
import type { ByteSource } from "./source";
import { inspectionBudget, retainInspectionText } from "./budget";
import { UPLOAD_LIMITS } from "../upload/limits";

/*
 * Zips by their central directory (SLN-494): EPUB, KEPUB, CBZ, FBZ and DOCX.
 * zip.js reads only the ranges it needs from a ByteSource, so a 300 MB comic
 * is listed without reading its pages. The end-of-central-directory record
 * gives the reader's manifest its `cdOffset`.
 */

configure({ useWebWorkers: false });

/** An entry larger than this is never inflated into memory (a zip bomb, or not a part of a book) */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

class BoundedEntryWriter extends Writer<Uint8Array<ArrayBuffer>> {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private length = 0;
  constructor(private readonly entryId: string) { super(); }
  async init() { await super.init?.(0); } // never allocate from untrusted declared size
  async writeUint8Array(chunk: Uint8Array): Promise<void> {
    inspectionBudget()!.decodedChunk(this.entryId, chunk.byteLength);
    this.length += chunk.byteLength;
    this.chunks.push(chunk.slice());
  }
  async getData(): Promise<Uint8Array<ArrayBuffer>> {
    inspectionBudget()!.assertHealthy();
    const result = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) { result.set(chunk, at); at += chunk.byteLength; }
    this.chunks = [];
    return result;
  }
}

class SourceReader extends Reader<ByteSource> {
  directoryPhase = true;
  private readonly source: ByteSource;
  constructor(source: ByteSource, private readonly directory: CentralDirectory | null = null) {
    super(source);
    this.source = source;
  }
  async init() {
    this.size = this.source.size;
  }
  async readUint8Array(index: number, length: number) {
    const budget = inspectionBudget();
    if (budget && this.directoryPhase) {
      const end = index + length;
      const directory = this.directory!;
      const inDirectory = index >= directory.cdOffset && end <= directory.cdOffset + directory.cdSize;
      const inTail = index >= Math.max(0, this.source.size - EOCD_SEARCH) && end <= this.source.size;
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(length) || length < 0 || (!inDirectory && !inTail))
        budget.reject("Archive listing read exceeds its checked central directory");
    }
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
/** End record/comment plus the optional ZIP64 locator and fixed end record. */
const EOCD_SEARCH = 22 + 65535 + 20 + 56;

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

/** Count actual directory records before zip.js allocates filename/entry objects. */
async function checkDirectoryRecords(source: ByteSource, directory: CentralDirectory): Promise<void> {
  const budget = inspectionBudget()!;
  budget.decodedChunk(`zip-directory:${source.name}`, directory.cdSize);
  const bytes = await source.read(directory.cdOffset, directory.cdSize);
  if (bytes.length !== directory.cdSize) budget.reject("Archive central directory is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let count = 0;
  for (let at = 0; at < bytes.length;) {
    if (at + 6 <= bytes.length && view.getUint32(at, true) === 0x05054b50) {
      if (at + 6 + view.getUint16(at + 4, true) !== bytes.length) budget.reject("Archive directory signature is malformed");
      break;
    }
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) budget.reject("Archive directory record is malformed");
    if (++count > UPLOAD_LIMITS.archiveEntries) budget.reject("Archive actual entry count exceeds its inspection bound");
    const end = at + 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    if (end > bytes.length) budget.reject("Archive directory record is truncated");
    at = end;
  }
  if (count !== directory.entries) budget.reject("Archive actual entry count differs from its end record");
}

/** A zip's directory; throws "Damaged zip: ..." when it cannot be read */
export async function openZip(source: ByteSource): Promise<OpenZip> {
  const budget = inspectionBudget();
  const directory = await readCentralDirectory(source);
  if (budget) {
    if (!directory) throw new Error("Damaged zip: central directory missing");
    budget.archiveDirectory(directory.cdSize, directory.entries);
    retainInspectionText(directory.cdSize * 2); // filename/comment decoding before listing
    await checkDirectoryRecords(source, directory);
  }
  const input = new SourceReader(source, directory);
  const reader = new ZipReader(input);
  let list: Entry[];
  try {
    list = await reader.getEntries();
    if (budget) budget.archiveDirectory(directory!.cdSize, list.length);
    input.directoryPhase = false;
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
    directory,
    text: async (name) => {
      if (!budget) return entry(name).getData!(new TextWriter());
      const bytes = await entry(name).getData!(new BoundedEntryWriter(`zip:${source.name}:${name}`));
      retainInspectionText(bytes.length); // worst-case UTF-8 code units, before decoding
      return new TextDecoder("utf-8").decode(bytes);
    },
    bytes: async (name) => entry(name).getData!(budget ? new BoundedEntryWriter(`zip:${source.name}:${name}`) : new Uint8ArrayWriter()),
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
