import type { GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Object } from "./covers";

/**
 * A stored file's bytes, from S3 or a preview's folder: the one read for
 * every route and job that needs a whole file (SLN-300). A missing body is
 * a clear error, not a crash on `Body!`.
 */
export async function readS3Object(key: string): Promise<Buffer> {
  return bodyBytes((await getS3Object(key)).body, key);
}

/** The bytes of a body the caller fetched itself (a conditional read) */
export async function bodyBytes(body: GetObjectCommandOutput["Body"], key: string): Promise<Buffer> {
  if (!body) throw new Error(`The stored file is empty: ${key}`);
  return Buffer.from(await body.transformToByteArray());
}
