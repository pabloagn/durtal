import { createHash, randomBytes } from "node:crypto";
import { immutableMatchingWriterInput } from "../match/link";
import type { LinkPlan } from "../match/link";
import type { AccessionPlan } from "../match/accession";
import type { DecisionPlan } from "../match/decisions";
import type { ClassificationPlan } from "../match/plan";
import type { SupportedDecision, ReviewBeforeRead } from "./store";
import type { WorkBeforeRead, WorkRequest } from "./work-store";
import type { ReviewUnlinkPlan } from "./unlink-contract";
import type { UnlinkRequest } from "./store";
import { loadMatchRows, storedTableDigest, type StoredRow } from "../match/load";
import { loadMatchDependencies } from "../match/dependencies";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { ReviewError } from "./errors";
import { reviewPayloadHash, canonicalReviewJson } from "./receipts";

export type ReviewPlan = LinkPlan | AccessionPlan | DecisionPlan | ClassificationPlan;
export interface FrozenReviewPreview {
  plan: ReviewPlan;
  request: SupportedDecision;
  before: ReviewBeforeRead;
}
export interface FrozenAccessionReviewPreview {
  plan: AccessionPlan;
  requests: readonly Extract<SupportedDecision, { action: "accession" }>[];
  beforeReads: readonly ReviewBeforeRead[];
}
export interface FrozenWorkReviewPreview {
  request: WorkRequest; before: WorkBeforeRead; historyId: string; text: string;
}
export interface FrozenUnlinkReviewPreview {
  plan: ReviewUnlinkPlan; request: UnlinkRequest; before: ReviewBeforeRead;
}
type Envelope = FrozenReviewPreview | FrozenAccessionReviewPreview | FrozenWorkReviewPreview | FrozenUnlinkReviewPreview;
type Entry = {
  envelope: Envelope;
  kind: "single" | "accession_batch" | "work_status" | "unlink"; hash: string; channel: "ui" | "api";
  target: string; expires: number; bytes: number;
  /** The hash of the cached envelope, which leaves out the row sets below. */
  sealed: string;
  /** Per-table hashes of the library-wide row sets the plan was made on. */
  digests: RowDigests;
};
/** A plan freezes whole tables: the matching catalogue in `snapshot.rows` and,
 * for an unlink, every referencing table in `dependencies.rows`. On 6,000
 * eBooks that is over 30 MB, so the cache keeps a hash per table instead and
 * reads the rows again on confirm. Rows that hash the same are the rows the
 * preview was made on; the writer's transaction guards still compare them. */
type RowSet = "snapshot" | "dependencies";
type Rows = Readonly<Record<string, readonly StoredRow[]>>;
type RowDigests = Partial<Record<RowSet, Record<string, string>>>;
export type PreviewRowsLoader = (sets: readonly RowSet[]) => Promise<Partial<Record<RowSet, Rows>>>;
/** The current row sets, read in one repeatable-read snapshot. */
export function previewRowsLoader(planningUrl: string): PreviewRowsLoader {
  return (sets) => withReadOnlyPlanningConnection(planningUrl, async (conn) => ({
    ...(sets.includes("snapshot") ? { snapshot: await loadMatchRows(conn) } : {}),
    ...(sets.includes("dependencies") ? { dependencies: (await loadMatchDependencies(conn)).rows } : {}),
  }), { isolationLevel: "repeatable read" });
}
const ROW_SETS: readonly RowSet[] = ["snapshot", "dependencies"];
type PlanRows = Partial<Record<RowSet, { rows?: Rows }>>;
const planOf = (envelope: Envelope) => (envelope as { plan?: PlanRows }).plan;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
/** One hash per table: the database's own, for rows read with it, else a hash
 * of the canonical rows. `known` keeps each table's canonical text, so the
 * whole envelope's hash reuses it rather than walking 30 MB again. */
const tableDigests = (rows: Rows, known?: Map<object, string>) =>
  Object.fromEntries(Object.keys(rows).sort().map((table) => {
    const stored = storedTableDigest(rows[table]);
    if (stored && !known) return [table, `db:${stored}`];
    const text = canonicalReviewJson(rows[table]);
    known?.set(rows[table], text);
    return [table, stored ? `db:${stored}` : sha256(text)];
  }));
function compact(envelope: Envelope, known: Map<object, string>): { envelope: Envelope; digests: RowDigests } {
  const plan = planOf(envelope);
  const digests: RowDigests = {};
  if (!plan) return { envelope, digests };
  const lean: Record<string, unknown> = { ...plan };
  for (const set of ROW_SETS) {
    const rows = plan[set]?.rows;
    if (!rows) continue;
    digests[set] = tableDigests(rows, known);
    lean[set] = { ...plan[set], rows: {} };
  }
  return { envelope: { ...envelope, plan: lean } as unknown as Envelope, digests };
}
/** Puts the current rows back, refusing a preview whose library changed since. */
async function hydrate(entry: Entry, load: PreviewRowsLoader): Promise<Envelope> {
  const sets = ROW_SETS.filter((set) => entry.digests[set]);
  if (!sets.length) return entry.envelope;
  const current = await load(sets);
  const plan: Record<string, unknown> = { ...planOf(entry.envelope) };
  for (const set of sets) {
    const rows = current[set];
    if (!rows || canonicalReviewJson(tableDigests(rows)) !== canonicalReviewJson(entry.digests[set]))
      throw new ReviewError("stale_review", "The library changed after this preview. Prepare a new review.");
    plan[set] = { ...(plan[set] as object), rows };
  }
  return immutableMatchingWriterInput({ ...entry.envelope, plan } as unknown as Envelope);
}
const MAX_ENTRIES = 128, MAX_BYTES = 32 * 1024 * 1024, TTL_MS = 10 * 60 * 1000;
/** Server-local capability cache. Expiry/restart is a refusal, never implicit replanning. */
export class ReviewPreviewCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly now: () => number = Date.now) {}
  private drop(token: string) {
    const entry = this.entries.get(token);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(token); }
  }
  private prune() {
    for (const [token, entry] of this.entries)
      if (entry.expires <= this.now()) this.drop(token);
  }
  private store(input: Envelope, kind: Entry["kind"], channel: "ui" | "api", target: string) {
    this.prune();
    const full = immutableMatchingWriterInput(input), known = new Map<object, string>();
    const { envelope, digests } = compact(full, known);
    const hash = sha256(canonicalReviewJson(full, known));
    const bytes = Buffer.byteLength(canonicalReviewJson({ envelope, digests }), "utf8");
    if (bytes > MAX_BYTES)
      throw new ReviewError("preview_too_large", "This preview is too large to keep. Prepare it for fewer eBooks.");
    while (this.entries.size >= MAX_ENTRIES || this.bytes + bytes > MAX_BYTES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    const token = randomBytes(32).toString("hex"), sealed = reviewPayloadHash({ envelope, digests });
    this.entries.set(token, { envelope, kind, hash, sealed, digests, channel, target, expires: this.now() + TTL_MS, bytes });
    this.bytes += bytes;
    return token;
  }
  issue(input: FrozenReviewPreview, channel: "ui" | "api", target: string) {
    return this.store(input, "single", channel, target);
  }
  issueAccession(input: FrozenAccessionReviewPreview, channel: "ui" | "api", target: string) {
    return this.store(input, "accession_batch", channel, target);
  }
  issueWork(input: FrozenWorkReviewPreview, channel: "ui" | "api", target: string) {
    return this.store(input, "work_status", channel, target);
  }
  issueUnlink(input: FrozenUnlinkReviewPreview, channel: "ui" | "api", target: string) {
    return this.store(input, "unlink", channel, target);
  }
  private bound(token: string, kind: Entry["kind"], channel: "ui" | "api", target: string) {
    this.prune();
    const entry = this.entries.get(token);
    if (!entry || entry.kind !== kind || entry.channel !== channel || entry.target !== target)
      throw new ReviewError("preview_expired", "Prepare and confirm a new review preview.");
    if (reviewPayloadHash({ envelope: entry.envelope, digests: entry.digests }) !== entry.sealed)
      throw new ReviewError("operation_collision", "The confirmed preview changed.");
    return entry;
  }
  async require(token: string, request: SupportedDecision, channel: "ui" | "api", target: string, load: PreviewRowsLoader) {
    const entry = this.bound(token, "single", channel, target);
    if (canonicalReviewJson((entry.envelope as FrozenReviewPreview).request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed request differs from its preview.");
    return { ...entry, envelope: await hydrate(entry, load) as FrozenReviewPreview };
  }
  async requireAccession(token: string, requests: readonly SupportedDecision[], channel: "ui" | "api", target: string, load: PreviewRowsLoader) {
    const entry = this.bound(token, "accession_batch", channel, target);
    if (canonicalReviewJson((entry.envelope as FrozenAccessionReviewPreview).requests) !== canonicalReviewJson(requests))
      throw new ReviewError("operation_collision", "The confirmed selection differs from its preview.");
    return { ...entry, envelope: await hydrate(entry, load) as FrozenAccessionReviewPreview };
  }
  requireWork(token: string, request: WorkRequest, channel: "ui" | "api", target: string) {
    const entry = this.bound(token, "work_status", channel, target);
    const envelope = entry.envelope as FrozenWorkReviewPreview;
    if (canonicalReviewJson(envelope.request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed book status differs from its preview.");
    return { ...entry, envelope };
  }
  async requireUnlink(token: string, request: UnlinkRequest, channel: "ui" | "api", target: string, load: PreviewRowsLoader) {
    const entry = this.bound(token, "unlink", channel, target);
    if (canonicalReviewJson((entry.envelope as FrozenUnlinkReviewPreview).request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed unlink differs from its preview.");
    return { ...entry, envelope: await hydrate(entry, load) as FrozenUnlinkReviewPreview };
  }
}
export const reviewPreviewCache = new ReviewPreviewCache();
