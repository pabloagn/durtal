import { z } from "zod/v4";
import { contentTypeFor, READABLE_FORMATS } from "@/lib/ebooks/formats";
import { UUID_RE } from "@/lib/utils/uuid";

const identitySchema = z.strictObject({
  v: z.literal(1),
  ebookId: z.string().regex(UUID_RE),
  fileId: z.string().regex(UUID_RE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.enum(READABLE_FORMATS),
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  contentType: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\u0000-\u001f\u007f]+$/),
  canonicalUrl: z.string().url(),
});
export type DownloadIdentity = z.infer<typeof identitySchema>;
export interface DeliveryTrust {
  appOrigin: string;
  cdnBases: readonly string[];
}

/** URL queries are transient capabilities, never cache identity. */
export function canonicalDownloadUrl(
  input: string,
  trust: DeliveryTrust,
): string {
  const app = trustedApp(trust.appOrigin);
  const url = new URL(input, app.origin);
  if (url.username || url.password)
    throw new Error("URL credentials cannot be stored");
  if (
    url.origin !== app.origin &&
    !cdnBases(trust).some(
      (base) =>
        url.origin === base.origin && url.pathname.startsWith(base.pathname),
    )
  )
    throw new Error("Untrusted delivery origin or prefix");
  return url.origin + url.pathname;
}
function trustedApp(input: string): URL {
  const url = new URL(input);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("A secure app origin is required");
  return url;
}
function cdnBases(trust: DeliveryTrust): URL[] {
  return trust.cdnBases.map((input) => {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid trusted CDN base");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    return url;
  });
}
function identifiesFile(
  url: URL,
  identity: DownloadIdentity,
  trust: DeliveryTrust,
): boolean {
  const app = trustedApp(trust.appOrigin);
  if (url.origin === app.origin)
    return (
      url.pathname.startsWith("/api/ebooks/files/") &&
      url.pathname.slice("/api/ebooks/files/".length).toLowerCase() ===
        identity.fileId.toLowerCase()
    );
  const hh = identity.sha256.slice(0, 2);
  return cdnBases(trust).some((base) => {
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
      return false;
    const path = url.pathname.slice(base.pathname.length);
    return (
      path ===
        `gold/ebooks/${identity.format}/${hh}/${identity.sha256}/file.${identity.format}` ||
      path === `files/${hh}/${identity.sha256}.${identity.format}`
    );
  });
}
export function validateDownloadIdentity(
  input: unknown,
  trust: DeliveryTrust,
): DownloadIdentity {
  const identity = identitySchema.parse(input);
  if (identity.contentType !== contentTypeFor(identity.format))
    throw new Error("Content type differs from readable format");
  const url = new URL(identity.canonicalUrl);
  if (
    url.search ||
    url.hash ||
    canonicalDownloadUrl(identity.canonicalUrl, trust) !==
      identity.canonicalUrl ||
    !identifiesFile(url, identity, trust)
  )
    throw new Error("Cache URL does not identify the verified file");
  return Object.freeze(identity);
}
/** Missing files and unrelated APIs/CDN hosts pass through the eventual worker. */
export function matchDownloadedFile(
  requestUrl: string,
  identities: readonly DownloadIdentity[],
  trust: DeliveryTrust,
): DownloadIdentity | null {
  let url: URL;
  try {
    url = new URL(requestUrl, trustedApp(trust.appOrigin));
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  for (const identity of identities) {
    const checked = validateDownloadIdentity(identity, trust);
    if (identifiesFile(url, checked, trust)) return checked;
  }
  return null;
}
/** Verification is evidence about bytes, not Content-Length/ETag assertions. */
export function downloadVerification(
  expected: Pick<DownloadIdentity, "sha256" | "sizeBytes">,
  observed: { sha256: string; sizeBytes: number },
  aborted = false,
): "verified" | "cancelled" | "incomplete" | "integrity_mismatch" {
  if (aborted) return "cancelled";
  if (
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes < 1
  )
    throw new Error("Invalid expected byte identity");
  if (observed.sizeBytes !== expected.sizeBytes) return "incomplete";
  return observed.sha256 === expected.sha256
    ? "verified"
    : "integrity_mismatch";
}
export function downloadSpacePolicy(
  sizeBytes: number,
  estimate: { quota: number; usage: number } | null,
):
  | { kind: "unknown" }
  | {
      kind: "enough" | "insufficient";
      requiredBytes: number;
      availableBytes: number;
    } {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1)
    throw new Error("Invalid download size");
  const requiredBytes = Number(
    (BigInt(sizeBytes) * BigInt(11) + BigInt(9)) / BigInt(10) +
      BigInt(1024 * 1024),
  );
  if (!Number.isSafeInteger(requiredBytes))
    throw new Error("Download size exceeds storage arithmetic");
  if (
    !estimate ||
    !Number.isFinite(estimate.quota) ||
    !Number.isFinite(estimate.usage) ||
    estimate.quota < 0 ||
    estimate.usage < 0
  )
    return { kind: "unknown" };
  const availableBytes = Math.max(
    0,
    Math.floor(estimate.quota - estimate.usage),
  );
  return {
    kind: availableBytes >= requiredBytes ? "enough" : "insufficient",
    requiredBytes,
    availableBytes,
  };
}
