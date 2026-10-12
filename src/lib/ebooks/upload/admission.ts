import { checkedInteger, checkedSourceSize, checkedSum, UPLOAD_LIMITS } from "./limits";
import { releaseEligibility, sameFence, validateFence, type CleanupEvidence, type OperationFence } from "./lifecycle";

export function reservationBytes(sourceBytes: number): number {
  checkedSourceSize(sourceBytes);
  const block = UPLOAD_LIMITS.allocationUnitBytes;
  const rounded = (n: number) => Math.ceil(n / block) * block;
  // Full parts are block aligned; the final part is rounded separately.
  const wholeParts = Math.floor(sourceBytes / UPLOAD_LIMITS.partBytes);
  const tail = sourceBytes % UPLOAD_LIMITS.partBytes;
  const transport = wholeParts * UPLOAD_LIMITS.partBytes + rounded(tail);
  return checkedSum([
    transport, rounded(sourceBytes), UPLOAD_LIMITS.derivedBytes,
    UPLOAD_LIMITS.scratchBytes, UPLOAD_LIMITS.itemMetadataBytes,
  ], "reservation bytes");
}

export interface ItemReservation {
  fence: OperationFence;
  sourceBytes: number;
  bytes: number;
  released: boolean;
}

export interface ReservationLedger {
  revision: number;
  allocationGeneration: number;
  ownerToken: string;
  ownerFence: number;
  reservedBytes: number;
  items: readonly ItemReservation[];
}

export interface SpoolMeasurement {
  ledgerRevision: number;
  allocationGeneration: number;
  ownerToken: string;
  ownerFence: number;
  measuredAt: number;
  ownWritersQuiescent: boolean;
  allocationUnitBytes: number;
  allocatedBytes: number;
  availableBytes: number;
  unaccountedBytes: number;
}

export function validateLedger(ledger: ReservationLedger): void {
  checkedInteger(ledger.revision, "ledger revision");
  checkedInteger(ledger.allocationGeneration, "allocation generation");
  checkedInteger(ledger.ownerFence, "owner fence");
  if (!ledger.ownerToken || ledger.items.length > 1024) throw new Error("Invalid reservation ledger");
  const ids = new Set<string>();
  for (const item of ledger.items) {
    validateFence(item.fence);
    checkedSourceSize(item.sourceBytes);
    if (!item.fence.operationId || ids.has(item.fence.operationId)) throw new Error("Duplicate or missing reservation id");
    ids.add(item.fence.operationId);
    const expected = item.released ? 0 : reservationBytes(item.sourceBytes);
    if (item.bytes !== expected) throw new Error("Reservation envelope differs");
  }
  const sum = checkedSum([UPLOAD_LIMITS.globalAllowanceBytes, ...ledger.items.map((item) => item.bytes)], "ledger bytes");
  if (ledger.reservedBytes !== sum || sum > UPLOAD_LIMITS.spoolQuotaBytes) throw new Error("Reservation ledger differs");
}

export type AdmissionResult =
  | { kind: "admitted" | "already_reserved"; ledger: ReservationLedger; reservation: ItemReservation }
  | { kind: "wait"; reason: "stale_measurement" | "writers_active" | "quota" | "disk_pressure"; ledger: ReservationLedger };

/**
 * Calculate a transaction's proposed reservation. No files, locks or DB writes.
 * The caller must CAS this revision under its allocation barrier before bytes.
 * External filesystem writes can invalidate free space after this decision;
 * runtime writers must keep checking and quiesce on ENOSPC/EDQUOT.
 */
export function reserveAdmission(
  ledger: ReservationLedger,
  measurement: SpoolMeasurement,
  request: { fence: OperationFence; sourceBytes: number; now: number },
): AdmissionResult {
  validateLedger(ledger);
  validateFence(request.fence);
  const bytes = reservationBytes(request.sourceBytes);
  checkedInteger(request.now, "current time");
  if (request.fence.ownerToken !== ledger.ownerToken || request.fence.ownerFence !== ledger.ownerFence)
    throw new Error("Stale reservation owner");
  const existing = ledger.items.find((item) => item.fence.operationId === request.fence.operationId);
  if (existing) {
    if (existing.sourceBytes !== request.sourceBytes || !sameFence(existing.fence, request.fence)) throw new Error("Reservation request changed");
    if (existing.released) throw new Error("Reservation already released: recover the operation receipt");
    return { kind: "already_reserved", ledger, reservation: existing };
  }
  if (ledger.items.length === 1024) throw new Error("Compact released reservation entries before admission");
  checkedInteger(measurement.measuredAt, "measurement time");
  checkedInteger(measurement.allocationUnitBytes, "allocation unit", 1, UPLOAD_LIMITS.allocationUnitBytes);
  checkedInteger(measurement.allocatedBytes, "allocated bytes");
  checkedInteger(measurement.availableBytes, "available bytes");
  checkedInteger(measurement.unaccountedBytes, "unaccounted bytes", 0, measurement.allocatedBytes);
  if (measurement.allocatedBytes > checkedSum([ledger.reservedBytes, measurement.unaccountedBytes], "existing spool envelope"))
    throw new Error("Own allocation exceeded its reservation: quiesce and reconcile");
  const wait = (reason: Extract<AdmissionResult, { kind: "wait" }>["reason"]): AdmissionResult => ({ kind: "wait", reason, ledger });
  if (measurement.ledgerRevision !== ledger.revision || measurement.allocationGeneration !== ledger.allocationGeneration
    || measurement.ownerToken !== ledger.ownerToken || measurement.ownerFence !== ledger.ownerFence
    || measurement.measuredAt > request.now || request.now - measurement.measuredAt > 1000) return wait("stale_measurement");
  if (!measurement.ownWritersQuiescent) return wait("writers_active");
  const ownedAfter = checkedSum([ledger.reservedBytes, bytes], "reserved bytes");
  const allAfter = checkedSum([ownedAfter, measurement.unaccountedBytes], "spool envelope");
  if (allAfter > UPLOAD_LIMITS.spoolQuotaBytes) return wait("quota");
  if (measurement.availableBytes < UPLOAD_LIMITS.freeReserveBytes
    || Math.max(0, allAfter - measurement.allocatedBytes) > measurement.availableBytes - UPLOAD_LIMITS.freeReserveBytes)
    return wait("disk_pressure");
  const reservation: ItemReservation = { fence: { ...request.fence }, sourceBytes: request.sourceBytes, bytes, released: false };
  return {
    kind: "admitted", reservation,
    ledger: { ...ledger, revision: checkedInteger(ledger.revision + 1, "ledger revision"), reservedBytes: ownedAfter, items: [...ledger.items, reservation] },
  };
}

/** Continuous pre-allocation check; unrelated filesystem writers can still race it. */
export function allocationDecision(
  ledger: ReservationLedger,
  fence: OperationFence,
  input: {
    category: "transport" | "assembled" | "derived" | "scratch" | "metadata";
    chargedCategoryBytes: number;
    nextAllocatedBytes: number;
    pendingAllocatedBytes: number;
    availableBytes: number;
  },
): "allocate" | "disk_pressure" | "budget_exceeded" {
  validateLedger(ledger);
  const item = ledger.items.find((entry) => entry.fence.operationId === fence.operationId);
  if (!item || item.released || fence.ownerToken !== ledger.ownerToken || fence.ownerFence !== ledger.ownerFence
    || !sameFence(item.fence, fence)) throw new Error("No current allocation grant");
  const sourceEnvelope = Math.ceil(item.sourceBytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes;
  const ceilings = { transport: sourceEnvelope, assembled: sourceEnvelope,
    derived: UPLOAD_LIMITS.derivedBytes, scratch: UPLOAD_LIMITS.scratchBytes, metadata: UPLOAD_LIMITS.itemMetadataBytes };
  if (!Object.hasOwn(ceilings, input.category)) throw new Error("Unknown allocation category");
  const ceiling = ceilings[input.category];
  const categoryAfter = checkedSum([input.chargedCategoryBytes, input.nextAllocatedBytes], "allocation category bytes");
  if (categoryAfter > ceiling) return "budget_exceeded";
  const growth = checkedSum([input.pendingAllocatedBytes, input.nextAllocatedBytes], "pending allocation bytes");
  checkedInteger(input.availableBytes, "available bytes");
  return input.availableBytes < UPLOAD_LIMITS.freeReserveBytes
    || growth > input.availableBytes - UPLOAD_LIMITS.freeReserveBytes ? "disk_pressure" : "allocate";
}

/** A retry/expired lease cannot release space; proved cleanup can release once. */
export function releaseReservation(ledger: ReservationLedger, evidence: CleanupEvidence): ReservationLedger {
  validateLedger(ledger);
  const index = ledger.items.findIndex((item) => item.fence.operationId === evidence.fence.operationId);
  if (index < 0) throw new Error("Unknown reservation");
  const item = ledger.items[index];
  if (evidence.fence.ownerToken !== ledger.ownerToken || evidence.fence.ownerFence !== ledger.ownerFence
    || !releaseEligibility(item.fence, evidence).reservation) throw new Error("Reservation cleanup is not proved");
  if (item.released) return ledger;
  const items = ledger.items.map((entry, at) => at === index ? { ...entry, bytes: 0, released: true } : entry);
  return { ...ledger, items, revision: checkedInteger(ledger.revision + 1, "ledger revision"), reservedBytes: ledger.reservedBytes - item.bytes };
}
