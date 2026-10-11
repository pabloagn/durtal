import { describe, expect, it } from "vitest";
import { acknowledgePart, acknowledgedBytes, expectedPartBytes, missingParts, partCount, requireCompleteParts, resumeParts, type PartMap, type PartReceipt } from "@/lib/ebooks/upload/parts";
import { GiB, UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";

const checksum = "a".repeat(64);
const map = (): PartMap => ({ sourceBytes: 2 * UPLOAD_LIMITS.partBytes + 7, generation: 4, receipts: [] });
const part = (number: number): PartReceipt => ({ number, bytes: expectedPartBytes(map().sourceBytes, number), sha256: checksum });

describe("durable upload part map", () => {
  it("bounds a 4 GiB source at 512 parts and gives the exact short final part", () => {
    expect(partCount(4 * GiB)).toBe(512);
    expect(expectedPartBytes(map().sourceBytes, 3)).toBe(7);
    expect(() => expectedPartBytes(map().sourceBytes, 4)).toThrow("part number");
  });
  it("accepts out-of-order parts without counting retries twice", () => {
    const first = acknowledgePart(map(), 4, part(3));
    const second = acknowledgePart(first, 4, part(1));
    expect(second.receipts.map((p) => p.number)).toEqual([1, 3]);
    expect(acknowledgePart(second, 4, part(1))).toBe(second);
    expect(acknowledgedBytes(second)).toBe(UPLOAD_LIMITS.partBytes + 7);
    expect(missingParts(second)).toEqual([2]);
    expect(map().receipts).toEqual([]);
  });
  it("refuses different bytes for a committed part", () => {
    const saved = acknowledgePart(map(), 4, part(1));
    expect(() => acknowledgePart(saved, 4, { ...part(1), sha256: "b".repeat(64) })).toThrow("bytes changed");
  });
  it.each([0, -1, 4, 1.5, NaN])("refuses malformed part number %s", (number) => {
    expect(() => acknowledgePart(map(), 4, { ...part(1), number })).toThrow("part number");
  });
  it("refuses oversize, undersize, malformed checksum and duplicate receipts", () => {
    expect(() => acknowledgePart(map(), 4, { ...part(3), bytes: 8 })).toThrow("length differs");
    expect(() => acknowledgePart(map(), 4, { ...part(1), bytes: 1 })).toThrow("length differs");
    expect(() => acknowledgePart(map(), 4, { ...part(1), sha256: "A".repeat(64) })).toThrow("checksum");
    expect(() => missingParts({ ...map(), receipts: [part(1), part(1)] })).toThrow("Duplicate");
  });
  it("requires byte evidence for every retained part and sends only the missing ones", () => {
    const saved = { ...map(), receipts: [part(1), part(3)] };
    expect(resumeParts(saved, 4, [part(3), part(1)])).toEqual([2]);
    expect(() => resumeParts(saved, 4, [part(1)])).toThrow("every retained part");
    expect(() => resumeParts(saved, 4, [part(1), part(2)])).toThrow("file bytes differ");
    expect(() => resumeParts(saved, 4, [part(1), { ...part(3), sha256: "c".repeat(64) }])).toThrow("file bytes differ");
  });
  it("fences late acknowledgements, resume and completion after cancellation", () => {
    expect(() => acknowledgePart(map(), 3, part(1))).toThrow("Stale");
    expect(() => resumeParts(map(), 3, [])).toThrow("Stale");
    expect(() => requireCompleteParts(map(), 3)).toThrow("Stale");
  });
  it("cannot complete with missing parts, and accepts a full exact-size map", () => {
    expect(() => requireCompleteParts(map(), 4)).toThrow("incomplete");
    const complete = { ...map(), receipts: [part(1), part(2), part(3)] };
    requireCompleteParts(complete, 4);
    expect(acknowledgedBytes(complete)).toBe(complete.sourceBytes);
  });
});
