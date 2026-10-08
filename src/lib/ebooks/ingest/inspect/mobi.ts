import type { EbookFormat } from "../../formats";
import type { ByteSource } from "../source";
import { emptyInspection, type FileAuthor, type FileMetadata, type Inspection } from "./types";

/*
 * MOBI, AZW and AZW3 (SLN-494): the PalmDB record list, the MOBI header and
 * its EXTH records, read by record; never the whole file. Text from PalmDOC
 * compressed or uncompressed records; HUFF/CDIC books give no text. A book
 * whose header names an encryption is Kindle DRM: listed, never decrypted.
 */

const u16 = (b: Uint8Array, at: number) => ((b[at] << 8) | b[at + 1]) >>> 0;
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

const COMPRESSION = { none: 1, palmdoc: 2, huffcdic: 17480 } as const;

/** Windows language ids (the MOBI header's locale) of the languages books mostly come in */
const LOCALES: Record<number, string> = {
  1: "ar", 2: "bg", 3: "ca", 4: "zh", 5: "cs", 6: "da", 7: "de", 8: "el", 9: "en", 10: "es", 11: "fi", 12: "fr",
  13: "he", 14: "hu", 15: "is", 16: "it", 17: "ja", 18: "ko", 19: "nl", 20: "no", 21: "pl", 22: "pt", 24: "ro",
  25: "ru", 26: "hr", 27: "sk", 29: "sv", 31: "tr", 34: "uk", 37: "et", 38: "lv", 39: "lt", 41: "fa", 42: "vi",
  45: "eu", 54: "af", 57: "hi", 62: "ms", 65: "sw", 86: "gl",
};

export interface PalmDb {
  type: string;
  creator: string;
  name: string;
  /** Each record's start; the last record ends at the file's end */
  offsets: number[];
}

export async function readPalmDb(source: ByteSource): Promise<PalmDb> {
  const head = await source.read(0, 78);
  if (head.length < 78) throw new Error("The file is too short for a PalmDB header");
  const count = u16(head, 76);
  const list = await source.read(78, count * 8);
  if (list.length < count * 8) throw new Error("The PalmDB record list is cut short");
  const offsets = Array.from({ length: count }, (_, i) => u32(list, i * 8));
  return {
    name: ascii(head, 0, 32).replace(/\0[\s\S]*$/, ""),
    type: ascii(head, 60, 4),
    creator: ascii(head, 64, 4),
    offsets,
  };
}

export async function readRecord(source: ByteSource, db: PalmDb, index: number): Promise<Uint8Array> {
  const start = db.offsets[index];
  const end = index + 1 < db.offsets.length ? db.offsets[index + 1] : source.size;
  if (start === undefined || end < start || end > source.size) throw new Error(`Record ${index} is out of the file`);
  return source.read(start, end - start);
}

/** Record 0 for the sniffer: up to 64 KiB of it */
export async function readRecord0(source: ByteSource): Promise<Uint8Array | null> {
  try {
    const db = await readPalmDb(source);
    if (db.offsets.length === 0) return null;
    const end = db.offsets.length > 1 ? db.offsets[1] : source.size;
    return source.read(db.offsets[0], Math.min(65536, end - db.offsets[0]));
  } catch {
    return null;
  }
}

/** PalmDOC's LZ77 (the MOBI format's compression 2) */
export function palmDocDecompress(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; ) {
    const c = input[i++];
    if (c === 0 || (c >= 0x09 && c <= 0x7f)) out.push(c);
    else if (c <= 0x08) for (let n = 0; n < c && i < input.length; n++) out.push(input[i++]);
    else if (c >= 0xc0) out.push(0x20, c ^ 0x80);
    else {
      if (i >= input.length) break;
      const pair = (c << 8) | input[i++];
      const distance = (pair >> 3) & 0x07ff;
      const length = (pair & 0x07) + 3;
      if (distance === 0 || distance > out.length) break;
      for (let n = 0; n < length; n++) out.push(out[out.length - distance]);
    }
  }
  return Uint8Array.from(out);
}

/** The size of a text record's trailing entries, which are not text */
function trailingSize(record: Uint8Array, flags: number): number {
  let end = record.length;
  // Bit 1's entry is the last in the record, bit 2's comes before it, and so on
  for (let bit = 1; bit <= 15; bit++) {
    if (!(flags & (1 << bit))) continue;
    // A backward-encoded size (it counts its own bytes): 7 bits a byte, the first read with its top bit set
    let size = 0;
    let shift = 0;
    for (let at = end - 1, n = 0; at >= 0 && n < 4; at--, n++) {
      const byte = record[at];
      size |= (byte & 0x7f) << shift;
      shift += 7;
      if (byte & 0x80) break;
    }
    end -= Math.min(size, end);
  }
  if (flags & 1 && end > 0) end -= (record[end - 1] & 0x03) + 1;
  return record.length - Math.max(0, end);
}

interface ExthRecord {
  type: number;
  data: Uint8Array;
}

function exthRecords(record0: Uint8Array, headerLength: number): ExthRecord[] {
  const at = 16 + headerLength;
  if (ascii(record0, at, 4) !== "EXTH") return [];
  const count = u32(record0, at + 8);
  const records: ExthRecord[] = [];
  for (let p = at + 12, i = 0; i < count && p + 8 <= record0.length; i++) {
    const type = u32(record0, p);
    const length = u32(record0, p + 4);
    if (length < 8 || p + length > record0.length) break;
    records.push({ type, data: record0.subarray(p + 8, p + length) });
    p += length;
  }
  return records;
}

export interface MobiHeader {
  compression: number;
  textRecords: number;
  encryption: number;
  version: number;
  encoding: number;
  title: string;
  firstImage: number | null;
  locale: string | null;
  extraFlags: number;
  exth: ExthRecord[];
}

export function parseMobiHeader(record0: Uint8Array): MobiHeader {
  if (ascii(record0, 16, 4) !== "MOBI") throw new Error("No MOBI header in record 0");
  const headerLength = u32(record0, 20);
  const encoding = u32(record0, 28);
  const version = u32(record0, 36);
  const nameOffset = u32(record0, 84);
  const nameLength = u32(record0, 88);
  const decoder = new TextDecoder(encoding === 65001 ? "utf-8" : "windows-1252");
  const firstImage = u32(record0, 108);
  const exthFlags = u32(record0, 128);
  return {
    compression: u16(record0, 0),
    textRecords: u16(record0, 8),
    encryption: u16(record0, 12),
    version,
    encoding,
    title: nameLength > 0 && nameOffset + nameLength <= record0.length ? decoder.decode(record0.subarray(nameOffset, nameOffset + nameLength)) : "",
    firstImage: firstImage === 0xffffffff ? null : firstImage,
    locale: LOCALES[u32(record0, 92) & 0xff] ?? null,
    // Like every offset here, from the start of record 0
    extraFlags: headerLength >= 0xe4 && 0xf4 <= record0.length ? u16(record0, 0xf2) : 0,
    exth: exthFlags & 0x40 ? exthRecords(record0, headerLength) : [],
  };
}

function metadataOf(header: MobiHeader, palmName: string): FileMetadata {
  const decoder = new TextDecoder(header.encoding === 65001 ? "utf-8" : "windows-1252");
  const text = (type: number) => header.exth.filter((r) => r.type === type).map((r) => decoder.decode(r.data).replace(/\0+$/, "").trim()).filter(Boolean);
  const first = (type: number) => text(type)[0] ?? null;
  const authors: FileAuthor[] = text(100).flatMap((value) => value.split(/\s*[&;]\s*/)).filter(Boolean).map((name) => ({ name, role: "aut" }));
  const identifiers = [
    ...text(104).map((value) => ({ scheme: "isbn", value })),
    ...[...text(113), ...text(504)].map((value) => ({ scheme: "asin", value })),
  ];
  return {
    title: first(503) ?? (header.title || palmName || null),
    authors,
    publisher: first(101),
    description: first(103),
    subjects: text(105),
    date: first(106),
    language: first(524) ?? header.locale,
    identifiers: identifiers.filter((id, i) => identifiers.findIndex((o) => o.scheme === id.scheme && o.value === id.value) === i),
  };
}

/** A MOBI, AZW or AZW3 file */
export async function inspectMobi(source: ByteSource, format: EbookFormat): Promise<Inspection> {
  let db: PalmDb;
  let header: MobiHeader;
  try {
    db = await readPalmDb(source);
    if (db.offsets.length < 2) return emptyInspection(format, { problem: "Damaged MOBI: no records" });
    header = parseMobiHeader(await readRecord(source, db, 0));
  } catch (error) {
    return emptyInspection(format, { problem: `Damaged MOBI: ${(error as Error).message}` });
  }
  const metadata = metadataOf(header, db.name);
  if (header.encryption !== 0) return emptyInspection(format, { metadata, drm: "kindle" });

  const coverOffset = header.exth.find((r) => r.type === 201);
  const coverIndex = header.firstImage !== null && coverOffset && coverOffset.data.length >= 4 ? header.firstImage + u32(coverOffset.data, 0) : null;
  const cover =
    coverIndex !== null && coverIndex < db.offsets.length
      ? { kind: "bytes" as const, load: () => readRecord(source, db, coverIndex) }
      : null;

  let text: Inspection["text"];
  if (header.compression === COMPRESSION.huffcdic) text = { kind: "none", reason: "MOBI with HUFF/CDIC compression: its text is not read" };
  else if (header.compression !== COMPRESSION.none && header.compression !== COMPRESSION.palmdoc) text = { kind: "none", reason: `Unknown MOBI compression ${header.compression}` };
  else {
    const decoder = new TextDecoder(header.encoding === 65001 ? "utf-8" : "windows-1252");
    const parts: Uint8Array[] = [];
    try {
      for (let i = 1; i <= header.textRecords && i < db.offsets.length; i++) {
        const record = await readRecord(source, db, i);
        const body = record.subarray(0, record.length - trailingSize(record, header.extraFlags));
        parts.push(header.compression === COMPRESSION.palmdoc ? palmDocDecompress(body) : body);
      }
    } catch (error) {
      return emptyInspection(format, { metadata, problem: `Damaged MOBI: ${(error as Error).message}` });
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const all = new Uint8Array(total);
    parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
    text = { kind: "html", parts: [{ html: decoder.decode(all), matter: "body" }] };
  }
  return emptyInspection(format, {
    metadata,
    cover,
    text,
    details: { mobiVersion: header.version, kf8: format === "azw3" },
  });
}
