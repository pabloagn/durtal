import { describe, expect, it } from "vitest";
import { existingCopyChanges, existingCopyDraft, sameExistingCopyStamp } from "@/lib/ebooks/review-queue/existing-copy";
import { instancePayload } from "@/components/books/instance-form";
import { copyContext } from "./review-existing-copy-fixtures";
describe("existing copy metadata patch", () => {
  it("keeps changed null and false, omits unchanged metadata, and reports reserved edits separately", () => {
    const original = instancePayload(existingCopyDraft(copyContext()));
    const changed = { ...original, notes: null, isSigned: true, locationId: "elsewhere", subLocationId: "elsewhere-too", format: "epub", fileSizeBytes: 100, status: "lent_out" };
    expect(existingCopyChanges(original, changed)).toEqual({ patch: { notes: null, isSigned: true },
      reserved: ["locationId", "subLocationId", "format", "fileSizeBytes", "status"] });
    expect(existingCopyChanges({ ...original, isSigned: true }, original).patch).toEqual({ isSigned: false });
  });
  it("never reanchors a guard after one microsecond or fingerprint drift", () => {
    const shown = copyContext().stamp;
    expect(sameExistingCopyStamp(shown, shown)).toBe(true);
    expect(sameExistingCopyStamp({ ...shown, updatedAt: "2026-10-11T00:00:00.000002Z" }, shown)).toBe(false);
    expect(sameExistingCopyStamp({ ...shown, metadataFingerprint: "b".repeat(64) }, shown)).toBe(false);
    expect(sameExistingCopyStamp(null, shown)).toBe(false);
  });
});
