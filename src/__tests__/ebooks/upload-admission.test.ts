import { describe, expect, it } from "vitest";
import { allocationDecision, releaseReservation, reservationBytes, reserveAdmission, validateLedger, type ReservationLedger, type SpoolMeasurement } from "@/lib/ebooks/upload/admission";
import { GiB, MiB, UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";
import type { CleanupEvidence, OperationFence } from "@/lib/ebooks/upload/lifecycle";

const fence = (operationId = "one"): OperationFence => ({ operationId, ownerToken: "owner", ownerFence: 7, generation: 2 });
const empty = (): ReservationLedger => ({ revision: 0, allocationGeneration: 0, ownerToken: "owner", ownerFence: 7, reservedBytes: UPLOAD_LIMITS.globalAllowanceBytes, items: [] });
const measurement = (ledger: ReservationLedger, overrides: Partial<SpoolMeasurement> = {}): SpoolMeasurement => ({
  ledgerRevision: ledger.revision, allocationGeneration: ledger.allocationGeneration,
  ownerToken: ledger.ownerToken, ownerFence: ledger.ownerFence,
  measuredAt: 100, ownWritersQuiescent: true, allocationUnitBytes: 4096,
  allocatedBytes: 0, availableBytes: 40 * GiB, unaccountedBytes: 0, ...overrides,
});
const reserve = (ledger: ReservationLedger, size = 4 * GiB, operationId = "one", sample = measurement(ledger)) =>
  reserveAdmission(ledger, sample, { fence: fence(operationId), sourceBytes: size, now: 100 });
function admitted(ledger = empty(), size = 4 * GiB, operationId = "one") {
  const result = reserve(ledger, size, operationId);
  if (result.kind !== "admitted") throw new Error("Expected admission");
  return result.ledger;
}
const clean = (): CleanupEvidence => ({ fence: fence(), inspector: "exit_confirmed", activeWriters: 0,
  streamsClosed: true, pendingIoSettled: true, scratchRemoved: true,
  allocatedFilesVerified: true, proofPersisted: true, transportRemoved: true, derivedCacheRemoved: true });

describe("upload reservation envelope", () => {
  it("reserves both originals plus bounded cache, scratch and metadata", () => {
    expect(reservationBytes(4 * GiB)).toBe(8 * GiB + 528 * MiB);
    expect(reservationBytes(1)).toBe(2 * 64 * 1024 + 528 * MiB);
    expect(reservationBytes(UPLOAD_LIMITS.partBytes + 1)).toBe(2 * (UPLOAD_LIMITS.partBytes + 64 * 1024) + 528 * MiB);
  });
  it.each([0, -1, 4 * GiB + 1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])("refuses unsafe source size %s before admission", (size) => {
    expect(() => reserve(empty(), size)).toThrow("source size");
  });
  it("admits three maximum files, queues the fourth, and never mutates its input", () => {
    const original = empty();
    let ledger = original;
    for (let i = 1; i <= 3; i++) ledger = admitted(ledger, 4 * GiB, String(i));
    expect(reserve(ledger, 4 * GiB, "four")).toMatchObject({ kind: "wait", reason: "quota" });
    expect(original).toEqual(empty());
    expect(ledger.reservedBytes).toBe(UPLOAD_LIMITS.globalAllowanceBytes + 3 * reservationBytes(4 * GiB));
  });
  it("charges unknown files and checks free-space reserve before approving bytes", () => {
    const ledger = empty();
    const required = ledger.reservedBytes + reservationBytes(4 * GiB);
    expect(reserve(ledger, 4 * GiB, "one", measurement(ledger, { availableBytes: required + 8 * GiB }))).toMatchObject({ kind: "admitted" });
    expect(reserve(ledger, 4 * GiB, "one", measurement(ledger, { availableBytes: required + 8 * GiB - 1 }))).toMatchObject({ kind: "wait", reason: "disk_pressure" });
    expect(reserve(ledger, 4 * GiB, "one", measurement(ledger, { allocatedBytes: 24 * GiB, unaccountedBytes: 24 * GiB }))).toMatchObject({ kind: "wait", reason: "quota" });
  });
  it("retains processing headroom for every accepted partial at different allocation levels", () => {
    const ledger = admitted(admitted(empty(), 4 * GiB, "a"), 4 * GiB, "b");
    for (const allocatedBytes of [0, 4 * GiB, 8 * GiB, 12 * GiB, ledger.reservedBytes]) {
      const result = reserve(ledger, 4 * GiB, "c", measurement(ledger, { allocatedBytes, availableBytes: 40 * GiB - allocatedBytes }));
      expect(result.kind).toBe("admitted");
      if (result.kind !== "admitted") throw new Error("Unexpected refusal");
      expect(result.ledger.reservedBytes - allocatedBytes).toBeLessThanOrEqual(32 * GiB - allocatedBytes);
      expect(ledger.items.every((item) => item.bytes === reservationBytes(item.sourceBytes))).toBe(true);
    }
  });
  it("replays the existing reservation after a lost response without charging again", () => {
    const ledger = admitted();
    const result = reserve(ledger);
    expect(result.kind).toBe("already_reserved");
    expect(result.ledger).toBe(ledger);
    expect(() => reserve(ledger, 1)).toThrow("request changed");
  });
  it.each([
    { ledgerRevision: 99 }, { allocationGeneration: 99 }, { ownerToken: "other" },
    { ownerFence: 99 }, { measuredAt: 101 }, { measuredAt: 0 },
  ])("rejects a stale or mismatched measurement %j", (override) => {
    const ledger = empty();
    const now = override.measuredAt === 0 ? 1101 : 100;
    expect(reserveAdmission(ledger, measurement(ledger, override), { fence: fence(), sourceBytes: 1, now }))
      .toMatchObject({ kind: "wait", reason: "stale_measurement" });
  });
  it("refuses admission while its own writers allocate", () => {
    const ledger = empty();
    expect(reserve(ledger, 1, "one", measurement(ledger, { ownWritersQuiescent: false })))
      .toMatchObject({ kind: "wait", reason: "writers_active" });
  });
  it("fails closed on inconsistent ledgers and unaccounted own over-allocation", () => {
    expect(() => validateLedger({ ...empty(), reservedBytes: 0 })).toThrow("ledger differs");
    const ledger = admitted();
    expect(() => validateLedger({ ...ledger, items: [...ledger.items, ledger.items[0]] })).toThrow("reservation id");
    expect(() => reserve(empty(), 1, "one", measurement(empty(), { allocatedBytes: GiB }))).toThrow("allocation exceeded");
  });
});

describe("allocation and release", () => {
  const growth = { category: "scratch" as const, chargedCategoryBytes: 0, nextAllocatedBytes: MiB, pendingAllocatedBytes: 0, availableBytes: 9 * GiB };
  it("checks live disk pressure and pending allocations without surrendering the grant", () => {
    const ledger = admitted();
    expect(allocationDecision(ledger, fence(), growth)).toBe("allocate");
    expect(allocationDecision(ledger, fence(), { ...growth, availableBytes: 8 * GiB })).toBe("disk_pressure");
    expect(allocationDecision(ledger, fence(), { ...growth, availableBytes: 8 * GiB + MiB, pendingAllocatedBytes: 1 })).toBe("disk_pressure");
    expect(ledger.items[0].bytes).toBe(reservationBytes(4 * GiB));
  });
  it("enforces per-category bounds and cancellation fences before allocation", () => {
    const ledger = admitted();
    expect(allocationDecision(ledger, fence(), { ...growth, chargedCategoryBytes: UPLOAD_LIMITS.scratchBytes })).toBe("budget_exceeded");
    expect(() => allocationDecision(ledger, { ...fence(), generation: 3 }, growth)).toThrow("current allocation grant");
    for (const category of ["unknown", "__proto__", "toString"])
      expect(() => allocationDecision(ledger, fence(), { ...growth, category: category as "scratch" })).toThrow("Unknown allocation category");
  });
  it.each([
    { inspector: "running" as const }, { inspector: "unknown" as const }, { activeWriters: 1 },
    { streamsClosed: false }, { pendingIoSettled: false }, { scratchRemoved: false },
    { allocatedFilesVerified: false }, { proofPersisted: false },
    { transportRemoved: false }, { derivedCacheRemoved: false },
  ])("keeps all reservation bytes until cleanup is proved %j", (override) => {
    const ledger = admitted();
    expect(() => releaseReservation(ledger, { ...clean(), ...override })).toThrow("cleanup is not proved");
    expect(ledger.items[0].released).toBe(false);
  });
  it("releases once after verified cleanup and forbids re-admission under that identity", () => {
    const released = releaseReservation(admitted(), clean());
    expect(released.reservedBytes).toBe(UPLOAD_LIMITS.globalAllowanceBytes);
    expect(releaseReservation(released, clean())).toBe(released);
    expect(() => reserve(released)).toThrow("recover the operation receipt");
    expect(() => allocationDecision(released, fence(), growth)).toThrow("allocation grant");
  });
});
