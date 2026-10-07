import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { serverEnv } from "@/lib/env";
import { ebooksPrefix } from "../keys";
import { isDeliverable, type CatalogueFile } from "./files";

/*
 * CloudFront signed URLs (SLN-491), made with Node's own crypto: RSA-SHA1
 * over the policy, in CloudFront's URL-safe base64, exactly as AWS's
 * cloudfront-signer makes them (a test checks the two agree). A URL is
 * valid until the end of the next 6-hour window, so the same file gets the
 * same URL for 6 hours (one entry in every cache) and a URL handed out is
 * always good for at least 6 hours.
 */

const WINDOW_SECONDS = 6 * 60 * 60;

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface SignedDerivedBase {
  /** <cdn>/<prefix>derived/: append "<sha256>/<name>?" and the query */
  base: string;
  /** Policy, Signature and Key-Pair-Id, ready to append after "?" */
  query: string;
  expiresAt: Date;
}

/** A file the catalogue says must not be served: quarantined, missing, replaced or under DRM */
export class UndeliverableFileError extends Error {
  constructor(file: Pick<CatalogueFile, "id" | "status" | "drm">) {
    super(`The file ${file.id} cannot be delivered (${file.drm ? `DRM: ${file.drm}` : file.status})`);
    this.name = "UndeliverableFileError";
  }
}

/** The end of the window after the one `now` is in, in epoch seconds */
export function signatureExpiry(now = Date.now()): number {
  const seconds = Math.floor(now / 1000);
  return Math.ceil(seconds / WINDOW_SECONDS) * WINDOW_SECONDS + WINDOW_SECONDS;
}

interface Cdn {
  url: string;
  keyPairId: string;
  key: KeyObject;
}

let cachedKey: { source: string; key: KeyObject } | null = null;

/** The CloudFront settings; refuses unless EBOOK_DELIVERY=cloudfront (serverEnv checks all three are set) */
function cdn(): Cdn {
  const env = serverEnv();
  if (env.EBOOK_DELIVERY !== "cloudfront" || !env.EBOOK_CDN_URL || !env.EBOOK_CDN_KEY_PAIR_ID || !env.EBOOK_CDN_PRIVATE_KEY)
    throw new Error("CloudFront delivery is not configured (EBOOK_DELIVERY=cloudfront and the EBOOK_CDN_* variables)");
  if (cachedKey?.source !== env.EBOOK_CDN_PRIVATE_KEY)
    cachedKey = {
      source: env.EBOOK_CDN_PRIVATE_KEY,
      key: createPrivateKey(Buffer.from(env.EBOOK_CDN_PRIVATE_KEY, "base64").toString("utf8")),
    };
  return { url: env.EBOOK_CDN_URL, keyPairId: env.EBOOK_CDN_KEY_PAIR_ID, key: cachedKey.key };
}

/** CloudFront's URL-safe base64 (+ becomes -, = becomes _, / becomes ~): safe in a query as it is */
function cloudFrontBase64(bytes: Buffer) {
  return bytes.toString("base64").replace(/\+/g, "-").replace(/=/g, "_").replace(/\//g, "~");
}

function policy(resource: string, expires: number) {
  return JSON.stringify({ Statement: [{ Resource: resource, Condition: { DateLessThan: { "AWS:EpochTime": expires } } }] });
}

function signature(text: string, key: KeyObject) {
  return cloudFrontBase64(createSign("RSA-SHA1").update(text).sign(key));
}

/** A canned-policy URL for one stored file */
export function signedFileUrl(file: CatalogueFile, now = Date.now()): SignedUrl {
  if (!isDeliverable(file)) throw new UndeliverableFileError(file);
  const { url, keyPairId, key } = cdn();
  const expires = signatureExpiry(now);
  const resource = `${url}/${file.s3Key}`;
  const query = `Expires=${expires}&Key-Pair-Id=${keyPairId}&Signature=${signature(policy(resource, expires), key)}`;
  return { url: `${resource}?${query}`, expiresAt: new Date(expires * 1000) };
}

/**
 * One custom-policy signature for every derived object (covers and
 * manifests): a page of 48 covers costs one RSA signature, not 48.
 */
export function signedDerivedUrlBase(now = Date.now()): SignedDerivedBase {
  const { url, keyPairId, key } = cdn();
  const expires = signatureExpiry(now);
  const base = `${url}/${ebooksPrefix()}derived/`;
  const text = policy(`${base}*`, expires);
  const query = `Policy=${cloudFrontBase64(Buffer.from(text, "utf8"))}&Key-Pair-Id=${keyPairId}&Signature=${signature(text, key)}`;
  return { base, query, expiresAt: new Date(expires * 1000) };
}
