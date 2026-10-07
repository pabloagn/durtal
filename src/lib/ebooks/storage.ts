import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { serverEnv } from "@/lib/env";
import { previewObjectPath, previewS3Dir } from "@/lib/s3/preview-dir";
import { ebooksPrefix, isSha256 } from "./keys";

/*
 * The e-book bucket (SLN-491): its own bucket (EBOOKS_BUCKET, default
 * durtal-ebooks) in EBOOKS_REGION, so versioning, lifecycle and delete
 * protection apply to e-books alone. Every read and write of it goes through
 * here. In a preview (DURTAL_PREVIEW_S3_DIR) objects are files under
 * DIR/<bucket>/<key>, and a range read reads only that slice of the file.
 */

export interface EbookStorage {
  bucket: string;
  prefix: string;
  region: string;
}

export function ebookStorage(): EbookStorage {
  const env = serverEnv();
  return { bucket: env.EBOOKS_BUCKET, prefix: env.EBOOKS_PREFIX, region: env.EBOOKS_REGION };
}

const globalForEbooks = globalThis as unknown as { ebookS3?: { region: string; client: S3Client } };

/** The client for the e-book bucket's region (the app's own client may be in another) */
export function ebookS3(): S3Client {
  const { region } = ebookStorage();
  const cached = globalForEbooks.ebookS3;
  if (cached?.region === region) return cached.client;
  const client = new S3Client({
    region,
    credentials: async () => ({
      accessKeyId: serverEnv().AWS_ACCESS_KEY_ID,
      secretAccessKey: serverEnv().AWS_SECRET_ACCESS_KEY,
    }),
  });
  globalForEbooks.ebookS3 = { region, client };
  return client;
}

/** files/, derived/ or staging/: what a key holds, after the prefix */
export function ebookObjectKind(key: string, prefix = ebooksPrefix()): "file" | "derived" | "staging" | null {
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (rest.startsWith("files/")) return "file";
  if (rest.startsWith("derived/")) return "derived";
  if (rest.startsWith("staging/")) return "staging";
  return null;
}

/** RFC 5987: the file name a browser saves the object as */
function contentDisposition(filename: string | undefined) {
  if (!filename) return "inline";
  const encoded = encodeURIComponent(filename.replace(/[\u0000-\u001f\u007f]/g, "")).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename*=UTF-8''${encoded}`;
}

/**
 * The headers every e-book object is written with: immutable caching, its
 * exact type, inline with its title as the file name, its SHA-256 as
 * metadata, SSE-S3, and Intelligent-Tiering for files (never an archive
 * tier: those restore asynchronously and would break instant open).
 * Exported for the multipart upload, which sets the same headers.
 */
export function ebookObjectHeaders(input: { key: string; contentType: string; sha256: string; filename?: string }) {
  return {
    CacheControl: "public, max-age=31536000, immutable",
    ContentType: input.contentType,
    ContentDisposition: contentDisposition(input.filename),
    Metadata: { sha256: input.sha256 },
    StorageClass: ebookObjectKind(input.key) === "file" ? ("INTELLIGENT_TIERING" as const) : ("STANDARD" as const),
    ServerSideEncryption: "AES256" as const,
  };
}

function previewFile(dir: string, key: string) {
  return previewObjectPath(dir, `${ebookStorage().bucket}/${key}`);
}

const hexToBase64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
const base64ToHex = (b64: string) => Buffer.from(b64, "base64").toString("hex");

const statusOf = (err: unknown) => (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
const isMissing = (err: unknown) => {
  const name = (err as { name?: string }).name;
  return statusOf(err) === 404 || name === "NoSuchKey" || name === "NotFound";
};

/**
 * Writes one object with its checksum, so S3 refuses bytes that differ from
 * it. A file (files/) is never overwritten: when its key exists the write is
 * skipped (`created: false`), since the key is the checksum of its bytes.
 * Single PUT, up to 5 GB; larger files use a multipart upload (sub-issue 5).
 */
export async function putEbookObject(input: {
  key: string;
  body: Uint8Array;
  contentType: string;
  /** The title the browser saves it under, with its extension */
  filename?: string;
}): Promise<{ created: boolean; sha256: string }> {
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  const kind = ebookObjectKind(input.key);
  if (!kind) throw new Error("Not a key of the e-book bucket");
  if (kind === "file" && !input.key.includes(`/${sha256}.`)) throw new Error("A file's key must be the checksum of its bytes");

  const dir = previewS3Dir();
  if (dir) {
    const file = previewFile(dir, input.key);
    if (kind === "file" && (await stat(file).catch(() => null))) return { created: false, sha256 };
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, input.body);
    return { created: true, sha256 };
  }
  try {
    await ebookS3().send(
      new PutObjectCommand({
        Bucket: ebookStorage().bucket,
        Key: input.key,
        Body: input.body,
        ContentLength: input.body.byteLength,
        ChecksumSHA256: hexToBase64(sha256),
        ...(kind === "file" ? { IfNoneMatch: "*" } : {}),
        ...ebookObjectHeaders({ key: input.key, contentType: input.contentType, sha256, filename: input.filename }),
      }),
    );
    return { created: true, sha256 };
  } catch (err) {
    // 412: the file is already stored under its checksum
    if (kind === "file" && statusOf(err) === 412) return { created: false, sha256 };
    throw err;
  }
}

export interface EbookObjectHead {
  size: number;
  /** The SHA-256 S3 holds for the whole object, as hex; null when it holds none or a composite one */
  sha256: string | null;
  /** full: one checksum of the whole object; composite: of a multipart upload's parts; none */
  checksumType: "full" | "composite" | "none";
  /** x-amz-meta-sha256, as written */
  metadataSha256: string | null;
  contentType: string | null;
  lastModified: Date | null;
}

/** The object's size and checksum, or null when there is no object */
export async function headEbookObject(key: string, options: { checksum?: boolean } = {}): Promise<EbookObjectHead | null> {
  const dir = previewS3Dir();
  if (dir) {
    const file = previewFile(dir, key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const sha256 = options.checksum ? await hashFile(file) : null;
    return {
      size: info.size,
      sha256,
      checksumType: sha256 ? "full" : "none",
      metadataSha256: sha256,
      contentType: null,
      lastModified: info.mtime,
    };
  }
  try {
    const head = await ebookS3().send(
      new HeadObjectCommand({
        Bucket: ebookStorage().bucket,
        Key: key,
        ...(options.checksum ? { ChecksumMode: "ENABLED" as const } : {}),
      }),
    );
    const checksum = head.ChecksumSHA256 ?? null;
    const composite = !!checksum && (checksum.includes("-") || head.ChecksumType === "COMPOSITE");
    const metadataSha256 = head.Metadata?.sha256 ?? null;
    return {
      size: head.ContentLength ?? 0,
      sha256: checksum && !composite ? base64ToHex(checksum) : null,
      checksumType: !checksum ? "none" : composite ? "composite" : "full",
      metadataSha256: isSha256(metadataSha256) ? metadataSha256 : null,
      contentType: head.ContentType ?? null,
      lastModified: head.LastModified ?? null,
    };
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface EbookObjectRange {
  body: ReadableStream<Uint8Array>;
  /** The bytes in this answer */
  length: number;
}

/**
 * Bytes start..end (inclusive; no end: to the last byte) of an object,
 * streamed, never buffered; null when there is no object. The caller checks
 * the range against the size it knows from the catalogue.
 */
export async function getEbookObjectRange(key: string, start: number, end?: number): Promise<EbookObjectRange | null> {
  if (!Number.isSafeInteger(start) || start < 0 || (end !== undefined && (!Number.isSafeInteger(end) || end < start)))
    throw new Error("Invalid byte range");
  const dir = previewS3Dir();
  if (dir) {
    const file = previewFile(dir, key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile() || start >= info.size) return null;
    const last = Math.min(end ?? info.size - 1, info.size - 1);
    const stream = createReadStream(file, { start, end: last });
    return { body: Readable.toWeb(stream) as ReadableStream<Uint8Array>, length: last - start + 1 };
  }
  try {
    const object = await ebookS3().send(
      new GetObjectCommand({ Bucket: ebookStorage().bucket, Key: key, Range: `bytes=${start}-${end ?? ""}` }),
    );
    if (!object.Body || object.ContentLength == null) return null;
    return { body: object.Body.transformToWebStream(), length: object.ContentLength };
  } catch (err) {
    // 416: the object is shorter than the catalogue says, which is a missing object too
    if (isMissing(err) || statusOf(err) === 416) return null;
    throw err;
  }
}

export interface EbookListedObject {
  key: string;
  size: number;
  lastModified: Date | null;
}

/** Every object under a prefix (the bucket's prefix included in `prefix`), listed in pages */
export async function listEbookObjects(prefix: string): Promise<EbookListedObject[]> {
  const dir = previewS3Dir();
  if (dir) return listPreview(path.join(path.resolve(dir), ebookStorage().bucket), prefix);
  const objects: EbookListedObject[] = [];
  let token: string | undefined;
  do {
    const page = await ebookS3().send(
      new ListObjectsV2Command({ Bucket: ebookStorage().bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? [])
      if (object.Key) objects.push({ key: object.Key, size: object.Size ?? 0, lastModified: object.LastModified ?? null });
    if (page.IsTruncated && !page.NextContinuationToken) throw new Error("The e-book bucket's listing was truncated without a continuation token");
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function listPreview(root: string, prefix: string): Promise<EbookListedObject[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const objects: EbookListedObject[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const key = path.relative(root, full).split(path.sep).join("/");
    if (!key.startsWith(prefix)) continue;
    const info = await stat(full);
    objects.push({ key, size: info.size, lastModified: info.mtime });
  }
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}
