import type { IngestReconciliation } from "@/lib/db/schema/ebook-ingest";

/*
 * The words of ingestion runs (SLN-494), shared by the command's reports
 * and the /ebooks/runs pages: sizes, durations, counts and states.
 */

const n = (value: number) => value.toLocaleString("en-US");

/** 5.3 GB, 812 MB, 40 KB */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1e3))} KB`;
}

/** 2 h 05 min, 14 min, 40 s */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** The exceptions that keep a reconciliation from being exact; ignored, DRM, quarantined and duplicate files are accounted for */
const blockingCount = (r: Pick<IngestReconciliation, "exceptions">) => r.exceptions.filter((e) => e.blocking).length;

/** "On disk 6,212 · in Neon 6,140 · in S3 6,140 · exceptions 72": the exceptions that keep it from being exact */
export function reconciliationLine(r: Pick<IngestReconciliation, "onDisk" | "inNeon" | "inS3" | "exceptions">): string {
  return `On disk ${n(r.onDisk)} · in Neon ${n(r.inNeon)} · in S3 ${n(r.inS3)} · exceptions ${n(blockingCount(r))}`;
}

export const RUN_KIND_LABEL: Record<string, string> = { apply: "Apply", upload: "Upload", verify: "Verification" };

const COUNT_WORDS: [key: string, one: string, many: string][] = [
  ["new_ebook", "new eBook", "new eBooks"],
  ["new_format", "format added", "formats added"],
  ["replaced_file", "changed file", "changed files"],
  ["already_stored", "already stored", "already stored"],
  ["duplicate_in_run", "duplicate", "duplicates"],
  ["quarantined", "quarantined", "quarantined"],
  ["ignored", "ignored", "ignored"],
  ["changed_since_plan", "changed since the plan", "changed since the plan"],
  ["failed", "failed", "failed"],
  ["pending", "waiting", "waiting"],
  // A verification's counts
  ["verified", "verified", "verified"],
  ["missing", "missing", "missing"],
  ["differ", "differs", "differ"],
  ["noKey", "with no object", "with no object"],
  ["unreferenced", "object no row names", "objects no row names"],
];

/** "214 new eBooks · 18 formats added · 3 failed": every count that is not zero */
export function countsLine(counts: Record<string, number>): string {
  const parts = COUNT_WORDS.filter(([key]) => (counts[key] ?? 0) > 0).map(([key, one, many]) => `${n(counts[key])} ${counts[key] === 1 ? one : many}`);
  return parts.length ? parts.join(" · ") : "Nothing to do";
}

export type RunTone = "sage" | "gold" | "red" | "blue";

/** The state a run's row shows: an exact reconciliation is "Reconciled", an inexact one its exceptions */
export function runStateLabel(run: { state: string; reconciliation: Pick<IngestReconciliation, "exact" | "exceptions"> | null }): { label: string; tone: RunTone } {
  if (run.state === "running") return { label: "Running", tone: "blue" };
  if (run.state === "interrupted") return { label: "Interrupted", tone: "gold" };
  if (run.reconciliation) {
    if (run.reconciliation.exact) return { label: "Reconciled", tone: "sage" };
    const count = blockingCount(run.reconciliation);
    return { label: `${n(count)} ${count === 1 ? "exception" : "exceptions"}`, tone: "red" };
  }
  return run.state === "failed" ? { label: "Failed", tone: "red" } : { label: "Finished", tone: "sage" };
}
