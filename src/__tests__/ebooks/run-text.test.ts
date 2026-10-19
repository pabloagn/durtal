import { describe, expect, it } from "vitest";
import { countsLine, formatBytes, formatDuration, reconciliationLine, runStateLabel, uploadWaitingLine } from "@/lib/ebooks/run-text";

const exception = (blocking: boolean, kind = "ignored") => ({ side: "disk" as const, kind, path: `/inbox/${kind}`, reason: kind, blocking });

describe("run text (SLN-494)", () => {
  it("counts only the exceptions that keep a reconciliation from being exact", () => {
    const exceptions = [exception(false), exception(false, "drm"), exception(false, "quarantined"), exception(true, "changed_since_plan")];
    expect(reconciliationLine({ onDisk: 6212, inNeon: 6140, inS3: 6140, exceptions })).toBe("On disk 6,212 · in Neon 6,140 · in S3 6,140 · exceptions 1");
    expect(runStateLabel({ state: "failed", reconciliation: { exact: false, exceptions } })).toEqual({ label: "1 exception", tone: "red" });
    expect(runStateLabel({ state: "finished", reconciliation: { exact: true, exceptions: [exception(false)] } })).toEqual({ label: "Reconciled", tone: "sage" });
  });

  it("names a run's state before it has a reconciliation", () => {
    expect(runStateLabel({ state: "running", reconciliation: null }).label).toBe("Running");
    expect(runStateLabel({ state: "interrupted", reconciliation: null }).label).toBe("Interrupted");
    expect(runStateLabel({ state: "failed", reconciliation: null }).label).toBe("Failed");
    expect(runStateLabel({ state: "finished", reconciliation: null }).label).toBe("Finished");
  });

  it("writes sizes, durations and the counts that are not zero", () => {
    expect([formatBytes(0), formatBytes(400), formatBytes(482_000), formatBytes(812e6), formatBytes(5.3e9)]).toEqual(["0 KB", "1 KB", "482 KB", "812 MB", "5.3 GB"]);
    expect([formatDuration(40), formatDuration(14 * 60), formatDuration(125 * 60)]).toEqual(["40 s", "14 min", "2 h 05 min"]);
    expect(countsLine({ new_ebook: 214, new_format: 1, failed: 0, pending: 0 })).toBe("214 new eBooks · 1 format added");
    expect(countsLine({})).toBe("Nothing to do");
  });

  // SLN-1467: a settled upload read "Nothing to do", and one waiting on a failed file said nothing of it
  it("counts an upload's files by how they ended", () => {
    expect(countsLine({ added: 3, canceled: 1, expired: 0, failed: 0, pending: 0 })).toBe("3 added · 1 canceled");
    expect(countsLine({ added: 1, expired: 2, failed: 1, pending: 1 })).toBe("1 added · 2 expired · 1 failed · 1 waiting");
  });
  it("says what a running upload waits on once only failed files are open", () => {
    expect(uploadWaitingLine({ added: 2, failed: 1, pending: 0 })).toBe("Waiting on 1 failed file: retry or cancel it.");
    expect(uploadWaitingLine({ failed: 1200 })).toBe("Waiting on 1,200 failed files: retry or cancel them.");
    expect(uploadWaitingLine({ failed: 1, pending: 1 })).toBeNull();
    expect(uploadWaitingLine({ added: 1, pending: 0 })).toBeNull();
  });
});
