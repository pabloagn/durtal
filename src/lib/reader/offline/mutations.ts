import { z } from "zod/v4";
import { UUID_RE } from "@/lib/utils/uuid";
import type { PositionSave } from "@/lib/reader/position-queue";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export const OFFLINE_RECORD_VERSION = 1;
export const OFFLINE_DATABASE_VERSION = 1;
export const OFFLINE_STORES = [
  "downloads",
  "positions",
  "annotations",
  "outbox",
  "rejected",
] as const;
export const OFFLINE_ANNOTATION_LIMIT = 100;
export const EXPECTED_DEVICE_HEADER = "X-Durtal-Expected-Device";

const uuid = z.string().regex(UUID_RE);
const timestamp = z.iso
  .datetime({ offset: true })
  .refine(
    (value) =>
      /(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !/\.\d{7}/.test(value),
    "Timestamp precision exceeds six digits",
  );
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(json),
    z.record(z.string(), json),
  ]),
);
const unit = z.number().min(0).max(1);
const locator = z.strictObject({
  v: z.literal(1),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  href: z.string().max(2048),
  sectionIndex: z.number().int().nonnegative(),
  progression: unit,
  totalProgression: unit,
  position: z.number().nonnegative().optional(),
  cfi: z.string().max(4096).optional(),
  pdf: z
    .strictObject({
      page: z.number().int().positive(),
      rects: z
        .array(z.tuple([z.number(), z.number(), z.number(), z.number()]))
        .max(200)
        .optional(),
    })
    .optional(),
  text: z
    .strictObject({
      before: z.string().max(512).optional(),
      highlight: z.string().max(2048).optional(),
      after: z.string().max(512).optional(),
    })
    .optional(),
  tocLabel: z.string().max(300).optional(),
  pageLabel: z.string().max(40).optional(),
});
const position = z.strictObject({
  fileId: uuid,
  locator,
  chapter: z.string().max(300).nullable(),
  clientUpdatedAt: timestamp,
});
const base = {
  v: z.literal(1),
  operationId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^\u0000-\u001f]+$/),
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ebookId: uuid,
  fileId: uuid,
  deviceId: uuid,
  createdAt: timestamp,
};
const annotationItem = z.record(z.string(), json);
const annotationBody = z.strictObject({
  upserts: z.array(annotationItem),
  deletes: z.array(annotationItem),
});
const schema = z.discriminatedUnion("kind", [
  z.strictObject({ ...base, kind: z.literal("position"), body: position }),
  z.strictObject({
    ...base,
    kind: z.literal("annotations"),
    body: annotationBody,
    batchable: z.boolean(),
  }),
]);
export type ReaderMutation = z.infer<typeof schema>;
export type PositionMutation = Extract<ReaderMutation, { kind: "position" }> & {
  body: PositionSave;
};
export type AnnotationMutation = Extract<
  ReaderMutation,
  { kind: "annotations" }
>;

/** No calendar rewriting or replay-time timestamps. Owners validate their wire bodies. */
export function validateMutation(
  input: unknown,
  options: {
    nowMs: number;
    annotations?: (body: AnnotationMutation["body"]) => boolean;
  },
): ReaderMutation {
  if (!Number.isFinite(options.nowMs))
    throw new Error("Invalid observation time");
  const parsed = schema.parse(input);
  if (Date.parse(parsed.createdAt) > options.nowMs + 300_000)
    throw new Error("Mutation time is in the future");
  if (parsed.kind === "position") {
    if (parsed.fileId.toLowerCase() !== parsed.body.fileId.toLowerCase())
      throw new Error("Position file identity differs");
    if (Date.parse(parsed.body.clientUpdatedAt) > options.nowMs + 300_000)
      throw new Error("Position time is in the future");
  } else {
    const items = annotationItems(parsed);
    if (!items.length || items.length > OFFLINE_ANNOTATION_LIMIT)
      throw new Error("At most 100 non-empty annotation changes");
    const ids = items.map((item) => item.id);
    if (
      ids.some((id) => typeof id !== "string" || !UUID_RE.test(id)) ||
      new Set(ids.map((id) => String(id).toLowerCase())).size !== ids.length
    )
      throw new Error("Invalid or repeated annotation identity");
    if (!options.annotations || !options.annotations(parsed.body))
      throw new Error("Annotation owner validation is required");
  }
  // Zod validates without being allowed to rewrite the immutable wire payload.
  const original = input as ReaderMutation;
  return freeze(JSON.parse(JSON.stringify(original)) as ReaderMutation);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function annotationItems(mutation: AnnotationMutation): JsonObject[] {
  return [...mutation.body.upserts, ...mutation.body.deletes];
}
export function mutationWireJson(mutation: ReaderMutation): string {
  return JSON.stringify(mutation.body);
}
export function mutationKey(mutation: ReaderMutation): string {
  return [mutation.ebookId, mutation.fileId, mutation.deviceId]
    .map((id) => id.toLowerCase())
    .join(":");
}
/** The guard used by both the preflight and the eventual route, before database access. */
export function deviceReplayPolicy(
  original: string,
  current: string | null,
): "ready" | "device_identity_missing" | "device_identity_changed" {
  if (!UUID_RE.test(original)) throw new Error("Invalid original device");
  if (!current || !UUID_RE.test(current)) return "device_identity_missing";
  return original.toLowerCase() === current.toLowerCase()
    ? "ready"
    : "device_identity_changed";
}
export function recordVersionPolicy(
  input: unknown,
): "supported" | "unsupported" | "invalid" {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Number.isSafeInteger((input as { v?: number }).v) ||
    (input as { v: number }).v < 1
  )
    return "invalid";
  return (input as { v: number }).v === OFFLINE_RECORD_VERSION
    ? "supported"
    : "unsupported";
}

/** Import planning does not delete or open either database. Decoder belongs to
 * the legacy queue's owner; unrecognized originals remain for reconciliation.
 */
export function planLegacyImport<T>(
  sources: readonly { key: string; value: T }[],
  existing: readonly ReaderMutation[],
  decode: (value: T) => ReaderMutation | null,
): {
  imports: { key: string; mutation: ReaderMutation }[];
  alreadyCommitted: string[];
  preserved: string[];
} {
  if (
    new Set(sources.map((source) => source.key)).size !== sources.length ||
    new Set(existing.map((mutation) => mutation.operationId)).size !==
      existing.length
  )
    throw new Error("Duplicate import identity");
  const committed = new Map(
    existing.map((mutation) => [mutation.operationId, mutation]),
  );
  const seen = new Set<string>();
  const imports: { key: string; mutation: ReaderMutation }[] = [],
    alreadyCommitted: string[] = [],
    preserved: string[] = [];
  for (const source of sources) {
    let mutation: ReaderMutation | null;
    try {
      mutation = decode(source.value);
    } catch {
      mutation = null;
    }
    if (
      !mutation ||
      !UUID_RE.test(mutation.deviceId) ||
      seen.has(mutation.operationId)
    ) {
      preserved.push(source.key);
      continue;
    }
    seen.add(mutation.operationId);
    const prior = committed.get(mutation.operationId);
    if (prior) {
      if (JSON.stringify(prior) === JSON.stringify(mutation))
        alreadyCommitted.push(source.key);
      else preserved.push(source.key);
    } else imports.push({ key: source.key, mutation });
  }
  return { imports, alreadyCommitted, preserved };
}
