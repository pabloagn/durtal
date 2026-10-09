import { serverEnv } from "@/lib/env";
import { EBOOK_FORMATS, type EbookFormat } from "./formats";

/*
 * Legacy keys remain available under EBOOKS_PREFIX. Canonical medallion
 * keys below always start with the layer. Every key is built from a checked
 * 64-hex checksum, a known extension or name, or a uuid, never from text a
 * client sends. Legacy keys (empty prefix by default):
 *
 *   files/<sha256[0:2]>/<sha256>.<ext>   the original bytes, never overwritten
 *   derived/<sha256>/<name>              covers and the manifest of one file
 *   staging/<uploadId>/<name>            browser uploads (legacy compatibility)
 */

const SHA256_RE = /^[a-f0-9]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The file extension of each format; a file of an unknown format is stored as .bin */
const EXTENSIONS: Record<EbookFormat, string> = Object.fromEntries(
  EBOOK_FORMATS.map((format) => [format, format === "other" ? "bin" : format])) as Record<EbookFormat, string>;
const KNOWN_EXTENSIONS = new Set(Object.values(EXTENSIONS));

/** The cover widths every file's derived folder holds */
export const EBOOK_COVER_WIDTHS = [240, 400, 800] as const;
export type EbookCoverWidth = (typeof EBOOK_COVER_WIDTHS)[number];

export const EBOOK_DERIVED_NAMES = ["cover-240.webp", "cover-400.webp", "cover-800.webp", "manifest.json"] as const;
export type EbookDerivedName = (typeof EBOOK_DERIVED_NAMES)[number];

/** A staged upload's file name: letters, digits, dot, dash and underscore, no folders */
const STAGING_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export function isEbookCoverWidth(value: number): value is EbookCoverWidth {
  return (EBOOK_COVER_WIDTHS as readonly number[]).includes(value);
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_RE.test(value);
}

/** The extension a file of this format is stored under */
export function ebookExtension(format: EbookFormat): string {
  return EXTENSIONS[format];
}

/** EBOOKS_PREFIX: empty, or folder names ending in a slash */
export function ebooksPrefix(): string {
  return serverEnv().EBOOKS_PREFIX;
}

function checkedSha256(sha256: string) {
  if (!isSha256(sha256)) throw new Error("An e-book key needs a SHA-256 of 64 lowercase hex characters");
  return sha256;
}

/** files/<sha256[0:2]>/<sha256>.<ext>: the original bytes */
export function ebookFileKey(sha256: string, ext: string, prefix = ebooksPrefix()): string {
  checkedSha256(sha256);
  if (!KNOWN_EXTENSIONS.has(ext)) throw new Error(`Unknown e-book extension: ${ext.slice(0, 20)}`);
  return `${prefix}files/${sha256.slice(0, 2)}/${sha256}.${ext}`;
}

/** derived/<sha256>/<name>: a cover width or the manifest */
export function ebookDerivedKey(sha256: string, name: EbookDerivedName, prefix = ebooksPrefix()): string {
  checkedSha256(sha256);
  if (!(EBOOK_DERIVED_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown derived object: ${String(name).slice(0, 40)}`);
  return `${prefix}derived/${sha256}/${name}`;
}

/** staging/<uploadId>/<name>: one part of a browser upload */
export function ebookStagingKey(uploadId: string, name: string, prefix = ebooksPrefix()): string {
  if (!UUID_RE.test(uploadId)) throw new Error("A staging key needs an upload id that is a uuid");
  if (!STAGING_NAME_RE.test(name) || name.includes("..")) throw new Error("A staging key needs a plain file name");
  return `${prefix}staging/${uploadId}/${name}`;
}

/** The folder of a file's derived objects, from its checksum */
export function ebookDerivedFolder(sha256: string, prefix = ebooksPrefix()): string {
  return `${prefix}derived/${checkedSha256(sha256)}/`;
}

/**
 * The checksum a derived cover key names, when the key is exactly one this
 * module builds (any width); null otherwise. Lets a route serve another
 * width of a stored cover without trusting the stored key's text.
 */
export function coverKeySha256(key: string | null | undefined, prefix = ebooksPrefix()): string | null {
  if (!key?.startsWith(`${prefix}derived/`)) return null;
  const match = /^derived\/([a-f0-9]{64})\/cover-(240|400|800)\.webp$/.exec(key.slice(prefix.length));
  return match ? match[1] : null;
}

/** Layer-first eBook keys. Legacy helpers above remain for stored rows. */
function domainFolder(sha256: string, format: EbookFormat) {
  checkedSha256(sha256);
  if (!(EBOOK_FORMATS as readonly string[]).includes(format)) throw new Error("Unknown e-book format");
  return `ebooks/${format}/${sha256.slice(0, 2)}/${sha256}`;
}
export function ebookBronzeKey(sha256: string, format: EbookFormat): string {
  return `bronze/${domainFolder(sha256, format)}/source.${ebookExtension(format)}`;
}
export function ebookGoldFileKey(sha256: string, format: EbookFormat): string {
  return `gold/${domainFolder(sha256, format)}/file.${ebookExtension(format)}`;
}
export function ebookSilverKey(sha256: string, format: EbookFormat, reportHash: string): string {
  return `silver/${domainFolder(sha256, format)}/v2/${checkedSha256(reportHash)}.json`;
}
export function ebookGoldDerivedKey(sha256: string, format: EbookFormat, reportHash: string, name: string): string {
  if (!(EBOOK_DERIVED_NAMES as readonly string[]).includes(name)) throw new Error("Unknown derived object");
  return `gold/${domainFolder(sha256, format)}/derived/v2/${checkedSha256(reportHash)}/${name}`;
}
export interface StageKey {
  stage: "bronze" | "silver" | "gold";
  format: EbookFormat;
  sha256: string;
  kind: "file" | "report" | "derived";
  reportHash?: string;
  name?: string;
}
export function parseStageKey(key: string): StageKey | null {
  const match = /^(bronze|silver|gold)\/ebooks\/([a-z0-9]+)\/([a-f0-9]{2})\/([a-f0-9]{64})\/(.+)$/.exec(key);
  if (!match) return null;
  const [, stage, format, hh, sha256, tail] = match;
  if (!(EBOOK_FORMATS as readonly string[]).includes(format) || hh !== sha256.slice(0, 2)) return null;
  const base = {
    stage: stage as StageKey["stage"],
    format: format as EbookFormat,
    sha256,
  };
  if ((stage === "bronze" && tail === `source.${ebookExtension(base.format)}`) || (stage === "gold" && tail === `file.${ebookExtension(base.format)}`))
    return { ...base, kind: "file" };
  const report = /^v2\/([a-f0-9]{64})\.json$/.exec(tail);
  if (stage === "silver" && report) return { ...base, kind: "report", reportHash: report[1] };
  const derived = /^derived\/v2\/([a-f0-9]{64})\/(cover-(?:240|400|800)\.webp|manifest\.json)$/.exec(tail);
  if (stage === "gold" && derived)
    return {
      ...base,
      kind: "derived",
      reportHash: derived[1],
      name: derived[2],
    };
  return null;
}
export function isLegacyFileKey(key: string, sha256?: string, format?: string, prefix = ebooksPrefix()): boolean {
  if (!key.startsWith(prefix)) return false;
  const match = /^files\/([a-f0-9]{2})\/([a-f0-9]{64})\.([a-z0-9]+)$/.exec(key.slice(prefix.length));
  return (
    !!match &&
    match[1] === match[2].slice(0, 2) &&
    KNOWN_EXTENSIONS.has(match[3]) &&
    (!sha256 || sha256 === match[2]) &&
    (!format || ebookExtension(format as EbookFormat) === match[3])
  );
}
export function isDeliveryFileKey(key: string, sha256: string, format: string): boolean {
  const parsed = parseStageKey(key);
  return parsed ? parsed.stage === "gold" && parsed.kind === "file" && parsed.sha256 === sha256 && parsed.format === format : isLegacyFileKey(key, sha256, format);
}
export function derivedKeyForWidth(key: string, width: EbookCoverWidth): string | null {
  const stage = parseStageKey(key);
  if (stage?.stage === "gold" && stage.kind === "derived" && stage.name?.startsWith("cover-"))
    return ebookGoldDerivedKey(stage.sha256, stage.format, stage.reportHash!, `cover-${width}.webp`);
  const sha256 = coverKeySha256(key);
  return sha256 ? ebookDerivedKey(sha256, `cover-${width}.webp`) : null;
}
export function isManifestKey(key: string, sha256: string): boolean {
  const stage = parseStageKey(key);
  return stage ? stage.stage === "gold" && stage.kind === "derived" && stage.name === "manifest.json" && stage.sha256 === sha256 : key === ebookDerivedKey(sha256, "manifest.json");
}
