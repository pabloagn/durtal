import { z } from "zod/v4";
import { EBOOK_FORMATS, contentTypeFor } from "../formats";
import { PREPARE_VERSION, type PreparedFile } from "../ingest/prepare";
import { hashBytes, validationFor } from "../medallion";
import { boundedJsonBytes } from "./bounded-json";
import { sameFence } from "./lifecycle";
import { UPLOAD_LIMITS } from "./limits";
import { validateInspectorIdentity, type InspectorIdentity } from "./runtime-contract";

const text = z.string().max(UPLOAD_LIMITS.reportBytes).nullable();
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const names = ["manifest.json", "cover-240.webp", "cover-400.webp", "cover-800.webp"] as const;
const preparedSchema = z.object({
  version: z.literal(PREPARE_VERSION), sha256: sha, size: z.number().int().positive().max(UPLOAD_LIMITS.sourceBytes),
  format: z.enum(EBOOK_FORMATS), contentType: z.string().max(128),
  validation: z.object({ integrity: z.enum(["verified", "unverified"]), drm: z.enum(["clear", "protected", "unverified"]),
    downloadable: z.boolean(), nativeReadable: z.boolean(), reason: text }).strict(),
  drm: z.enum(["adobe-adept", "kindle", "readium-lcp", "apple-fairplay", "pdf-password", "unknown"]).nullable(),
  problem: text, coverReason: text, opfUuid: text,
  metadata: z.object({ title: text.optional(), subtitle: text.optional(), language: text.optional(), publisher: text.optional(),
    date: text.optional(), description: text.optional(), series: text.optional(), seriesIndex: z.number().finite().nullable().optional(),
    authors: z.array(z.object({ name: z.string(), fileAs: text.optional(), role: text.optional() }).strict()).max(10_000).optional(),
    identifiers: z.array(z.object({ scheme: z.string(), value: z.string() }).strict()).max(10_000).optional(),
    subjects: z.array(z.string()).max(10_000).optional() }).strict(),
  details: z.record(z.string(), z.unknown()),
  text: z.object({ wordCount: count, charCount: count, frontBackWordCount: count, pageEstimate: z.number().finite().nonnegative().nullable(),
    language: text, toolVersion: z.number().int().positive(), reason: text }).strict(),
  derived: z.array(z.object({ name: z.enum(names), sha256: sha, size: z.number().int().positive().max(UPLOAD_LIMITS.reportBytes),
    contentType: z.enum(["application/json", "image/webp"]) }).strict()).min(1).max(4),
}).strict();
const reportSchema = z.object({ identity: z.unknown(), sourceSha256: sha, prepared: preparedSchema,
  derived: z.array(z.object({ name: z.enum(names), bytes: z.number().int().positive().max(UPLOAD_LIMITS.reportBytes),
    sha256: sha, base64: z.string().max(UPLOAD_LIMITS.reportBytes) }).strict()).min(1).max(4) }).strict();

/** Revalidate the bounded worker wire, including source/generation binding and
 * every decoded artifact, before handing it to the real stage-first publisher.
 */
export function decodePublishedInspection(output: string, expected: { identity: InspectorIdentity; bytes: number; sha256: string }) {
  if (Buffer.byteLength(output) > UPLOAD_LIMITS.reportBytes) throw new Error("Inspector result exceeds its bound");
  const raw: unknown = JSON.parse(output);
  boundedJsonBytes(raw, UPLOAD_LIMITS.reportBytes);
  const report = reportSchema.parse(raw);
  const identity = report.identity as InspectorIdentity;
  validateInspectorIdentity(identity);
  if (identity.volumeId !== expected.identity.volumeId || identity.bindingSha256 !== expected.identity.bindingSha256
    || !sameFence(identity.fence, expected.identity.fence) || report.sourceSha256 !== expected.sha256
    || report.prepared.sha256 !== expected.sha256 || report.prepared.size !== expected.bytes
    || report.prepared.contentType !== contentTypeFor(report.prepared.format)) throw new Error("Inspector result binding differs");
  const prepared = report.prepared as PreparedFile;
  const validation = validationFor(prepared.format, prepared.problem, prepared.drm, prepared.validation.integrity === "verified" || prepared.validation.drm === "clear");
  if (JSON.stringify(validation) !== JSON.stringify(prepared.validation)) throw new Error("Inspector validation is inconsistent");
  const artifacts = new Map<string, Uint8Array>();
  for (const artifact of report.derived) {
    const planned = prepared.derived.find((p) => p.name === artifact.name);
    if (artifacts.has(artifact.name) || !planned || planned.size !== artifact.bytes || planned.sha256 !== artifact.sha256
      || artifact.base64.length !== Math.ceil(artifact.bytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(artifact.base64))
      throw new Error("Inspector artifact binding differs");
    const bytes = Buffer.from(artifact.base64, "base64");
    if (bytes.length !== artifact.bytes || bytes.toString("base64") !== artifact.base64 || hashBytes(bytes) !== artifact.sha256)
      throw new Error("Inspector artifact checksum differs");
    if (planned.contentType !== (artifact.name === "manifest.json" ? "application/json" : "image/webp")) throw new Error("Inspector artifact media type differs");
    artifacts.set(artifact.name, bytes);
  }
  if (!artifacts.has("manifest.json") || artifacts.size !== prepared.derived.length
    || new Set(prepared.derived.map((p) => p.name)).size !== prepared.derived.length) throw new Error("Inspector artifacts are incomplete");
  return { prepared, artifacts };
}
