import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TEXT_TOOL_VERSION, extractBodyText } from "../text/extract";
import { contentTypeFor, type EbookFormat } from "../formats";
import { inspectFile } from "./inspect";
import { makeCovers } from "./cover";
import { makeManifest } from "./manifest";
import { readRecord0 } from "./inspect/mobi";
import { sniffFormat, SNIFF_HEAD_BYTES, type SniffResult } from "./sniff";
import type { ByteSource } from "./source";
import { openZip } from "./zip";
import type { DrmKind, FileMetadata } from "./inspect/types";

/*
 * One file made ready to store (SLN-494): what it is, what it says, its
 * covers and manifest written into the cache folder, and its text counts.
 * The result is cached by checksum, so a second plan of the same bytes
 * reads nothing but the cache, and the apply uploads exactly the derived
 * objects the plan made.
 */

/** Goes up whenever a prepared file would come out differently */
export const PREPARE_VERSION = 1;

export interface DerivedObject {
  /** cover-240.webp, cover-400.webp, cover-800.webp or manifest.json */
  name: string;
  sha256: string;
  size: number;
  contentType: string;
}

export interface TextCounts {
  wordCount: number | null;
  charCount: number | null;
  frontBackWordCount: number | null;
  pageEstimate: number | null;
  language: string | null;
  toolVersion: number;
  reason: string | null;
}

export interface PreparedFile {
  version: number;
  sha256: string;
  size: number;
  format: EbookFormat;
  contentType: string;
  drm: DrmKind | null;
  problem: string | null;
  metadata: FileMetadata;
  details: Record<string, unknown>;
  text: TextCounts;
  /** Why there is no cover, when there is none */
  coverReason: string | null;
  derived: DerivedObject[];
  /** The OPF's uuid of an EPUB (not a sidecar's) */
  opfUuid: string | null;
}

/** What a file is, from its first 4 KiB, its zip directory or its MOBI record 0 */
export async function sniffSource(source: ByteSource): Promise<SniffResult> {
  if (source.size === 0) return { kind: "not-ebook", reason: "Empty file" };
  const head = await source.read(0, SNIFF_HEAD_BYTES);
  const latin = String.fromCharCode(...head.subarray(0, 68));
  let zipEntries: string[] | null = null;
  if (latin.startsWith("PK\x03\x04")) {
    try {
      const zip = await openZip(source);
      zipEntries = zip.names;
      await zip.close();
    } catch {
      zipEntries = null;
    }
  }
  const mobiRecord0 = latin.slice(60, 68) === "BOOKMOBI" ? await readRecord0(source) : null;
  return sniffFormat(head, source.name, { zipEntries, mobiRecord0 });
}

/** cacheDir/derived/<sha256>/<name>: where the plan leaves a derived object for the apply */
export function derivedCachePath(cacheDir: string, sha256: string, name: string) {
  return path.join(cacheDir, "derived", sha256, name);
}

const inspectCachePath = (cacheDir: string, sha256: string) => path.join(cacheDir, "inspect", `${sha256}.json`);
const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A cached preparation, when its version and every derived file still match */
function cached(cacheDir: string, sha256: string): PreparedFile | null {
  const file = inspectCachePath(cacheDir, sha256);
  if (!existsSync(file)) return null;
  try {
    const prepared = JSON.parse(readFileSync(file, "utf8")) as PreparedFile;
    if (prepared.version !== PREPARE_VERSION || prepared.text.toolVersion !== TEXT_TOOL_VERSION) return null;
    for (const object of prepared.derived) {
      const at = derivedCachePath(cacheDir, sha256, object.name);
      if (!existsSync(at) || sha256Of(readFileSync(at)) !== object.sha256) return null;
    }
    return prepared;
  } catch {
    return null;
  }
}

/**
 * Inspects, extracts and makes the covers and manifest of one e-book file
 * whose checksum is known. DRM files are never opened beyond their
 * metadata; damaged files get a problem in plain words.
 */
export async function prepareFile(source: ByteSource, sha256: string, format: EbookFormat, cacheDir: string): Promise<PreparedFile> {
  const hit = cached(cacheDir, sha256);
  if (hit) return hit;

  const inspection = await inspectFile(source, format);
  const derived: DerivedObject[] = [];
  const write = (name: string, bytes: Uint8Array, contentType: string) => {
    const at = derivedCachePath(cacheDir, sha256, name);
    mkdirSync(path.dirname(at), { recursive: true });
    writeFileSync(at, bytes);
    derived.push({ name, sha256: sha256Of(bytes), size: bytes.length, contentType });
  };

  let coverReason: string | null = null;
  let text: TextCounts;
  try {
    const readable = !inspection.drm && !inspection.problem;
    if (readable) {
      const { covers, reason } = await makeCovers(inspection.cover);
      coverReason = reason;
      for (const [name, bytes] of Object.entries(covers ?? {})) write(name, bytes, "image/webp");
    } else coverReason = inspection.drm ? "DRM: the file is not opened" : "Damaged: the file is not opened";
    const body = readable && inspection.text ? extractBodyText(inspection.text, inspection.metadata.language) : null;
    text = body
      ? { wordCount: body.wordCount, charCount: body.charCount, frontBackWordCount: body.frontBackWordCount, pageEstimate: body.pageEstimate, language: body.language, toolVersion: body.toolVersion, reason: body.reason }
      : { wordCount: null, charCount: null, frontBackWordCount: null, pageEstimate: null, language: null, toolVersion: TEXT_TOOL_VERSION, reason: readable ? "No text read" : coverReason };
  } finally {
    await inspection.close?.();
  }
  const manifest = makeManifest({ sha256, format, size: source.size }, inspection.manifest);
  write("manifest.json", new TextEncoder().encode(JSON.stringify(manifest)), "application/json");

  const prepared: PreparedFile = {
    version: PREPARE_VERSION,
    sha256,
    size: source.size,
    format,
    contentType: contentTypeFor(format),
    drm: inspection.drm,
    problem: inspection.problem,
    metadata: inspection.metadata,
    details: inspection.details,
    text,
    coverReason,
    derived,
    opfUuid: (inspection as { opf?: { uuid: string | null } | null }).opf?.uuid ?? null,
  };
  mkdirSync(path.dirname(inspectCachePath(cacheDir, sha256)), { recursive: true });
  writeFileSync(inspectCachePath(cacheDir, sha256), JSON.stringify(prepared));
  return prepared;
}
