import { z } from "zod";

/**
 * The payload of an evidence document in `source_records` (SLN-468): what an
 * outlet returned, by hashes, keys and short metadata. The page text itself
 * is never in the database (R10); it lives in the private S3 prefix and its
 * hash is `textSha256`, the hash a text excerpt in `claim_evidence` names.
 */

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const short = (max: number) => z.string().max(max).nullable();

export const EVIDENCE_KINDS = ["evidence_page", "evidence_text"] as const;

export const robotsRecordSchema = z.object({
  url: z.string().max(4000),
  status: z.number().int().nullable(),
  group: z.enum(["agent", "*", "none"]),
  rule: short(600),
  decision: z.literal("allowed"),
  crawlDelay: z.number().nullable(),
  fetchedAt: z.iso.datetime(),
});

const common = {
  outlet: z.string().min(1).max(100),
  textSha256: sha256,
  /** Code points of the stored text */
  textChars: z.number().int().nonnegative(),
  textBytes: z.number().int().nonnegative(),
  textKey: z.string().max(200),
  fingerprint: z.object({ method: z.string().max(100), values: z.array(z.number().int().nonnegative()).length(128) }),
  runId: z.uuid().nullable(),
  jobId: z.uuid().nullable(),
};

/** A page the fetcher retrieved */
export const evidencePagePayloadSchema = z.strictObject({
  kind: z.literal("evidence_page"),
  retrievedVia: z.literal("fetch"),
  ...common,
  requestedUrl: z.string().max(4000),
  finalUrl: z.string().max(4000),
  /** The page's own canonical link, as it states it */
  canonicalUrl: short(4000),
  httpStatus: z.number().int(),
  contentType: z.string().max(200),
  charset: z.string().max(100),
  rawSha256: sha256,
  rawBytes: z.number().int().nonnegative(),
  rawStoredBytes: z.number().int().nonnegative(),
  rawKey: z.string().max(200),
  title: short(1000),
  byline: short(1000),
  publishedOn: short(100),
  language: short(35),
  extractor: z.object({ name: z.string().max(100), version: z.string().max(100) }),
  fetcherVersion: z.string().max(100),
  robots: robotsRecordSchema,
});

/** A search snippet of a snippet-only outlet, stored without a fetch */
export const evidenceTextPayloadSchema = z.strictObject({
  kind: z.literal("evidence_text"),
  retrievedVia: z.string().regex(/^search:[a-z0-9]+([._-][a-z0-9]+)*$/),
  ...common,
  query: z.string().min(1).max(2000),
});

export const evidencePayloadSchema = z.discriminatedUnion("kind", [evidencePagePayloadSchema, evidenceTextPayloadSchema]);
export type EvidencePagePayload = z.infer<typeof evidencePagePayloadSchema>;
export type EvidenceTextPayload = z.infer<typeof evidenceTextPayloadSchema>;
