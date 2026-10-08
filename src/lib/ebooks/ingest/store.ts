import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, open, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { previewS3Dir } from "@/lib/s3/preview-dir";
import { ebookObjectHeaders, ebookS3, ebookStorage, headEbookObject, previewFile, statusOf, type EbookObjectHead } from "../storage";

/*
 * Storing one object (SLN-494), idempotent and verified. The key is the
 * checksum of the bytes, so an object that is already there with the same
 * size and checksum is adopted, never uploaded again. Up to 256 MiB: one
 * conditional PUT with its SHA-256; above: a multipart upload in 16 MiB
 * parts with a SHA-256 for each, resumable from the parts already sent,
 * whose bytes must hash to the planned SHA-256 before it completes.
 * Then a HEAD: the stored size and checksum must equal the local ones.
 */

export const SINGLE_PUT_MAX = 256 * 1024 * 1024;
export const PART_SIZE = 16 * 1024 * 1024;
/** Waits before the 1st, 2nd and 3rd retry of an S3 call */
export const RETRY_DELAYS_MS = [1000, 4000, 16000];

export interface StoreInput {
  key: string;
  /** The bytes' SHA-256, as hex */
  sha256: string;
  size: number;
  contentType: string;
  /** The name a browser saves the object under */
  filename?: string;
  body: { file: string } | { bytes: Uint8Array };
}

export interface StoreOptions {
  /** Where an unfinished multipart upload's id is kept, so a restart sends only the missing parts */
  cacheDir: string;
  sleep?: (ms: number) => Promise<void>;
  /** Above this a file goes multipart (tests make it small) */
  singlePutMax?: number;
  partSize?: number;
}

export interface StoreResult {
  /** The object was already there and matched */
  adopted: boolean;
  multipart: boolean;
}

const RETRYABLE_NAMES = new Set(["SlowDown", "Throttling", "ThrottlingException", "RequestTimeout", "RequestTimeTooSkewed", "TimeoutError", "NetworkingError", "InternalError", "ServiceUnavailable"]);
const RETRYABLE_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "UND_ERR_SOCKET"]);

/** S3 5xx, throttling and network errors: worth trying again */
export function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined && (status >= 500 || status === 429)) return true;
  const { name, code } = error as { name?: string; code?: string };
  return (!!name && RETRYABLE_NAMES.has(name)) || (!!code && RETRYABLE_CODES.has(code));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `run`, tried again after 1, 4 and 16 seconds when S3 or the network failed */
export async function withRetries<T>(run: () => Promise<T>, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(error)) throw error;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

const hexToBase64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

/** One slice of the body */
async function readSlice(body: StoreInput["body"], start: number, length: number): Promise<Uint8Array> {
  if ("bytes" in body) return body.bytes.subarray(start, start + length);
  const handle = await open(body.file, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The checksum S3 gives a multipart object: the SHA-256 of its parts' SHA-256s, then "-<parts>" */
export async function compositeChecksum(body: StoreInput["body"], size: number, partSize = PART_SIZE): Promise<string> {
  const parts = Math.max(1, Math.ceil(size / partSize));
  const outer = createHash("sha256");
  for (let n = 0; n < parts; n++) outer.update(createHash("sha256").update(await readSlice(body, n * partSize, partSize)).digest());
  return `${outer.digest("base64")}-${parts}`;
}

/**
 * Whether a stored object is these bytes: its size, and its whole or composite
 * checksum. `sent` is the composite checksum of the parts this upload sent:
 * then only that matches, since the sha256 metadata was written by this same
 * upload from the plan and proves nothing about the bytes.
 */
async function matches(head: EbookObjectHead, input: StoreInput, partSize: number, sent: string | null = null): Promise<string | null> {
  if (head.size !== input.size) return `its size is ${head.size} bytes, not ${input.size}`;
  if (head.checksumType === "full") return head.sha256 === input.sha256 ? null : "its SHA-256 differs";
  if (sent) {
    if (head.checksumType !== "composite") return "it has no multipart checksum to compare";
    return head.checksum === sent ? null : "its multipart checksum is not the parts sent";
  }
  if (head.checksumType === "composite") {
    const expected = await compositeChecksum(input.body, input.size, partSize);
    if (head.checksum === expected) return null;
    // Another writer's parts of another size: the sha256 metadata written with it names the whole
    return head.metadataSha256 === input.sha256 ? null : "its multipart checksum differs";
  }
  return head.metadataSha256 === input.sha256 ? null : "it has no checksum to compare";
}

interface UploadState {
  key: string;
  uploadId: string;
  partSize: number;
}

function uploadStateFile(cacheDir: string, sha256: string) {
  const dir = path.join(cacheDir, "uploads");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${sha256}.json`);
}

/**
 * Sends the parts S3 does not have and completes the upload. Every part is
 * read, so the whole file is hashed on the way: bytes that are not the
 * planned SHA-256 (the file changed after the plan) abort the upload. Returns
 * the composite checksum of the parts sent, or null when another upload
 * stored the key first.
 */
async function multipartUpload(input: StoreInput, options: Required<Pick<StoreOptions, "cacheDir" | "partSize">> & { sleep?: StoreOptions["sleep"] }): Promise<string | null> {
  const s3 = ebookS3();
  const { bucket } = ebookStorage();
  const retry = <T>(run: () => Promise<T>) => withRetries(run, options.sleep);
  const stateFile = uploadStateFile(options.cacheDir, input.sha256);
  const partSize = options.partSize;
  const count = Math.ceil(input.size / partSize);

  // A saved upload of the same key and part size: list what S3 already has
  let state: UploadState | null = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as UploadState) : null;
  const sent = new Map<number, CompletedPart & { Size?: number }>();
  if (state && (state.key !== input.key || state.partSize !== partSize)) state = null;
  if (state) {
    try {
      let marker: string | undefined;
      do {
        const page = await retry(() => s3.send(new ListPartsCommand({ Bucket: bucket, Key: input.key, UploadId: state!.uploadId, PartNumberMarker: marker })));
        for (const part of page.Parts ?? [])
          if (part.PartNumber) sent.set(part.PartNumber, { PartNumber: part.PartNumber, ETag: part.ETag, ChecksumSHA256: part.ChecksumSHA256, Size: part.Size });
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
      } while (marker);
    } catch (error) {
      if (statusOf(error) !== 404 && (error as { name?: string }).name !== "NoSuchUpload") throw error;
      state = null;
      sent.clear();
    }
  }
  if (!state) {
    const headers = ebookObjectHeaders({ key: input.key, contentType: input.contentType, sha256: input.sha256, filename: input.filename });
    const created = await retry(() => s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: input.key, ChecksumAlgorithm: "SHA256", ...headers })));
    if (!created.UploadId) throw new Error("S3 gave no upload id");
    state = { key: input.key, uploadId: created.UploadId, partSize };
    writeFileSync(stateFile, JSON.stringify(state));
  }

  const parts: CompletedPart[] = [];
  const whole = createHash("sha256");
  const outer = createHash("sha256");
  for (let n = 1; n <= count; n++) {
    const bytes = await readSlice(input.body, (n - 1) * partSize, partSize);
    const digest = createHash("sha256").update(bytes).digest();
    const checksum = digest.toString("base64");
    whole.update(bytes);
    outer.update(digest);
    const already = sent.get(n);
    if (already && already.ChecksumSHA256 === checksum && (already.Size === undefined || already.Size === bytes.length)) {
      parts.push({ PartNumber: n, ETag: already.ETag, ChecksumSHA256: already.ChecksumSHA256 });
      continue;
    }
    const uploaded = await retry(() =>
      s3.send(new UploadPartCommand({ Bucket: bucket, Key: input.key, UploadId: state!.uploadId, PartNumber: n, Body: bytes, ContentLength: bytes.length, ChecksumSHA256: checksum })),
    );
    parts.push({ PartNumber: n, ETag: uploaded.ETag, ChecksumSHA256: uploaded.ChecksumSHA256 ?? checksum });
  }
  if (whole.digest("hex") !== input.sha256) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: input.key, UploadId: state.uploadId })).catch(() => {});
    rmSync(stateFile, { force: true });
    throw new Error(`The stored object ${input.key} differs from the file: the bytes sent are not the planned SHA-256 (the file changed since the plan)`);
  }
  try {
    await retry(() =>
      s3.send(new CompleteMultipartUploadCommand({ Bucket: bucket, Key: input.key, UploadId: state!.uploadId, MultipartUpload: { Parts: parts }, IfNoneMatch: "*" })),
    );
  } catch (error) {
    // 412: the key exists, so another upload stored the same bytes; this one is dropped and the object verified
    if (statusOf(error) !== 412) throw error;
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: input.key, UploadId: state.uploadId })).catch(() => {});
    rmSync(stateFile, { force: true });
    return null;
  }
  rmSync(stateFile, { force: true });
  return `${outer.digest("base64")}-${count}`;
}

/** Stores one object and verifies it; throws when it cannot be stored or the stored bytes differ */
export async function storeObject(input: StoreInput, options: StoreOptions): Promise<StoreResult> {
  const partSize = options.partSize ?? PART_SIZE;
  const singlePutMax = options.singlePutMax ?? SINGLE_PUT_MAX;
  const retry = <T>(run: () => Promise<T>) => withRetries(run, options.sleep);

  const dir = previewS3Dir();
  if (dir) {
    const target = previewFile(dir, input.key);
    const existing = await stat(target).catch(() => null);
    if (!existing) {
      await mkdir(path.dirname(target), { recursive: true });
      if ("file" in input.body) await copyFile(input.body.file, target);
      else await writeFile(target, input.body.bytes);
    }
    const head = await headEbookObject(input.key, { checksum: true });
    const problem = head ? await matches(head, input, partSize) : "it was not written";
    if (problem) throw new Error(`The stored object ${input.key} differs from the file: ${problem}`);
    return { adopted: !!existing, multipart: false };
  }

  const before = await retry(() => headEbookObject(input.key, { checksum: true }));
  if (before) {
    const problem = await matches(before, input, partSize);
    if (problem) throw new Error(`The stored object ${input.key} differs from the file: ${problem}`);
    return { adopted: true, multipart: false };
  }

  const multipart = input.size > singlePutMax;
  let sent: string | null = null;
  if (multipart) sent = await multipartUpload(input, { cacheDir: options.cacheDir, partSize, sleep: options.sleep });
  else {
    try {
      await retry(() =>
        ebookS3().send(
          new PutObjectCommand({
            Bucket: ebookStorage().bucket,
            Key: input.key,
            // A new stream for each attempt: a retried body starts from its first byte
            Body: "file" in input.body ? createReadStream(input.body.file) : input.body.bytes,
            ContentLength: input.size,
            ChecksumSHA256: hexToBase64(input.sha256),
            IfNoneMatch: "*",
            ...ebookObjectHeaders({ key: input.key, contentType: input.contentType, sha256: input.sha256, filename: input.filename }),
          }),
        ),
      );
    } catch (error) {
      // 412: the key exists, which by construction means the same bytes; verified below like any other
      if (statusOf(error) !== 412) throw error;
    }
  }

  const after = await retry(() => headEbookObject(input.key, { checksum: true }));
  const problem = after ? await matches(after, input, partSize, sent) : "S3 has no object after the upload";
  if (problem) throw new Error(`The stored object ${input.key} differs from the file: ${problem}`);
  return { adopted: false, multipart };
}
