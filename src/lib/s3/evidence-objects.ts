import { existsSync } from "node:fs";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { s3, S3_BUCKET } from "./client";
import { uploadToS3 } from "./covers";
import { readS3Object } from "./read-object";
import { previewObjectPath, previewS3Dir } from "./preview-dir";

/**
 * The bucket as the evidence store uses it (SLN-468). Objects are named by
 * their content's hash, so an existing key already holds the same bytes.
 * Tests pass their own implementation; nothing here touches a real bucket.
 */
export interface EvidenceObjects {
  /** Write the bytes unless the key exists; true when it wrote */
  putIfMissing(key: string, body: Buffer, contentType: string): Promise<boolean>;
  /** The bytes, or null when the object is gone */
  get(key: string): Promise<Buffer | null>;
}

const missing = (error: unknown) => {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.name === "NotFound" || e.$metadata?.httpStatusCode === 404;
};

async function exists(key: string): Promise<boolean> {
  const dir = previewS3Dir();
  if (dir) return existsSync(previewObjectPath(dir, key));
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

export const bucketEvidenceObjects: EvidenceObjects = {
  async putIfMissing(key, body, contentType) {
    if (await exists(key)) return false;
    await uploadToS3(key, body, contentType);
    return true;
  },
  async get(key) {
    try {
      return await readS3Object(key);
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
};
