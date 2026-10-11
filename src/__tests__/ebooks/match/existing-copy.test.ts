import { describe, expect, it } from "vitest";
import { parseExistingCopyPatch, existingCopyStampSchema } from "@/lib/ebooks/match/manual-intents";
import { EXISTING_COPY_METADATA_COLUMNS, existingCopyMetadataFingerprint, existingCopyStampForRow,
  copyMetadataProvenance, copyMetadataRestoration } from "@/lib/ebooks/match/existing-copy";
const row = () => ({ ...Object.fromEntries(Object.values(EXISTING_COPY_METADATA_COLUMNS).map((key) => [key, null])),
  is_signed: true, is_first_printing: true, notes: "Original", acquisition_price: 12.34,
  updated_at: "2026-10-09T12:00:00.123456+00:00" });
describe("existing descriptive copy metadata", () => {
  it("keeps omissions, nullable clears and explicit flags without create defaults", () => {
    expect(parseExistingCopyPatch({ notes: null })).toEqual({ notes: null });
    expect(parseExistingCopyPatch({})).toEqual({});
    expect(parseExistingCopyPatch({ isSigned: false })).toEqual({ isSigned: false });
    expect(() => parseExistingCopyPatch({ isSigned: null })).toThrow();
  });
  it.each(["editionId", "locationId", "subLocationId", "format", "fileSizeBytes", "status", "id", "updatedAt", "createdAt", "unknown"])(
    "refuses protected %s", (key) => expect(() => parseExistingCopyPatch({ [key]: "override" })).toThrow());
  it("retains every UTC microsecond and detects raw metadata changes without timestamp changes", () => {
    const before = row(), stamp = existingCopyStampForRow(before);
    expect(stamp.updatedAt).toBe("2026-10-09T12:00:00.123456Z");
    expect(existingCopyStampForRow({ ...before, updated_at: "2026-10-09T14:00:00.123456+02:00" })).toEqual(stamp);
    expect(existingCopyStampForRow({ ...before, updated_at: "2026-10-09T12:00:00.123457Z" })).not.toEqual(stamp);
    expect(existingCopyMetadataFingerprint({ ...before, notes: "Concurrent edit" })).not.toBe(stamp.metadataFingerprint);
    expect(() => existingCopyMetadataFingerprint({ updated_at: before.updated_at })).toThrow();
    expect(() => existingCopyStampSchema.parse({ ...stamp, updatedAt: "2026-02-30T12:00:00.123456Z" })).toThrow();
  });
  it("restores only recorded columns, rejects forged stamps and refuses unclaimed field changes", () => {
    const before = row(), marker = copyMetadataProvenance(before, { notes: null, acquisitionPrice: "20.00" });
    const after = { ...before, notes: null, acquisition_price: 20, updated_at: "2026-10-09T12:00:01.123457Z" };
    expect(copyMetadataRestoration(before, after, marker)).toEqual({ notes: "Original", acquisitionPrice: "12.34" });
    expect(() => copyMetadataRestoration(before, { ...after, is_signed: false }, marker)).toThrow();
    expect(() => copyMetadataRestoration(before, after, { ...marker,
      beforeStamp: { ...marker.beforeStamp, metadataFingerprint: "a".repeat(64) } })).toThrow();
    expect(() => copyMetadataRestoration(before, after, { ...marker, fields: ["location_id"] as never })).toThrow();
  });
});
