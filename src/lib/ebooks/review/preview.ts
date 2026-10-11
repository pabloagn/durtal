import { randomBytes } from "node:crypto";
import { immutableMatchingWriterInput } from "../match/link";
import type { LinkPlan } from "../match/link";
import type { AccessionPlan } from "../match/accession";
import type { DecisionPlan } from "../match/decisions";
import type { ClassificationPlan } from "../match/plan";
import type { SupportedDecision, ReviewBeforeRead } from "./store";
import type { WorkBeforeRead, WorkRequest } from "./work-store";
import type { ReviewUnlinkPlan } from "./unlink-contract";
import type { UnlinkRequest } from "./store";
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
type Entry = {
  envelope: FrozenReviewPreview | FrozenAccessionReviewPreview | FrozenWorkReviewPreview | FrozenUnlinkReviewPreview;
  kind: "single" | "accession_batch" | "work_status" | "unlink"; hash: string; channel: "ui" | "api";
  target: string; expires: number; bytes: number;
};
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
  private store(input: Entry["envelope"], kind: Entry["kind"], channel: "ui" | "api", target: string) {
    this.prune();
    const envelope = immutableMatchingWriterInput(input);
    const bytes = Buffer.byteLength(canonicalReviewJson(envelope), "utf8");
    if (bytes > MAX_BYTES)
      throw new ReviewError("preview_expired", "This preview exceeds the private cache limit.");
    while (this.entries.size >= MAX_ENTRIES || this.bytes + bytes > MAX_BYTES) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.drop(oldest);
    }
    const token = randomBytes(32).toString("hex"), hash = reviewPayloadHash(envelope);
    this.entries.set(token, { envelope, kind, hash, channel, target, expires: this.now() + TTL_MS, bytes });
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
    if (reviewPayloadHash(entry.envelope) !== entry.hash)
      throw new ReviewError("operation_collision", "The confirmed preview changed.");
    return entry;
  }
  require(token: string, request: SupportedDecision, channel: "ui" | "api", target: string) {
    const entry = this.bound(token, "single", channel, target);
    const envelope = entry.envelope as FrozenReviewPreview;
    if (canonicalReviewJson(envelope.request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed request differs from its preview.");
    return { ...entry, envelope };
  }
  requireAccession(token: string, requests: readonly SupportedDecision[], channel: "ui" | "api", target: string) {
    const entry = this.bound(token, "accession_batch", channel, target);
    const envelope = entry.envelope as FrozenAccessionReviewPreview;
    if (canonicalReviewJson(envelope.requests) !== canonicalReviewJson(requests))
      throw new ReviewError("operation_collision", "The confirmed selection differs from its preview.");
    return { ...entry, envelope };
  }
  requireWork(token: string, request: WorkRequest, channel: "ui" | "api", target: string) {
    const entry = this.bound(token, "work_status", channel, target);
    const envelope = entry.envelope as FrozenWorkReviewPreview;
    if (canonicalReviewJson(envelope.request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed book status differs from its preview.");
    return { ...entry, envelope };
  }
  requireUnlink(token: string, request: UnlinkRequest, channel: "ui" | "api", target: string) {
    const entry = this.bound(token, "unlink", channel, target);
    const envelope = entry.envelope as FrozenUnlinkReviewPreview;
    if (canonicalReviewJson(envelope.request) !== canonicalReviewJson(request))
      throw new ReviewError("operation_collision", "The confirmed unlink differs from its preview.");
    return { ...entry, envelope };
  }
}
export const reviewPreviewCache = new ReviewPreviewCache();
