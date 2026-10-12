import { checkedInteger, checkedSourceSize, checkedSum, UPLOAD_LIMITS } from "./limits";

export interface PartReceipt {
  number: number;
  bytes: number;
  sha256: string;
}

export interface PartMap {
  generation: number;
  sourceBytes: number;
  receipts: readonly PartReceipt[];
}

export function partCount(sourceBytes: number): number {
  return Math.ceil(checkedSourceSize(sourceBytes) / UPLOAD_LIMITS.partBytes);
}

export function expectedPartBytes(sourceBytes: number, number: number): number {
  checkedInteger(number, "part number", 1, partCount(sourceBytes));
  return Math.min(UPLOAD_LIMITS.partBytes, sourceBytes - (number - 1) * UPLOAD_LIMITS.partBytes);
}

function validateReceipt(sourceBytes: number, receipt: PartReceipt): void {
  if (receipt.bytes !== expectedPartBytes(sourceBytes, receipt.number)) throw new Error("Part length differs");
  if (!/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error("Invalid part checksum");
}

function validateMap(map: PartMap): void {
  checkedInteger(map.generation, "part generation");
  const count = partCount(map.sourceBytes);
  if (map.receipts.length > count) throw new Error("Too many part receipts");
  const seen = new Set<number>();
  for (const receipt of map.receipts) {
    validateReceipt(map.sourceBytes, receipt);
    if (seen.has(receipt.number)) throw new Error("Duplicate part receipt");
    seen.add(receipt.number);
  }
}

/** Runtime stores a receipt only after the streamed part is durable and hashed. */
export function acknowledgePart(map: PartMap, generation: number, receipt: PartReceipt): PartMap {
  validateMap(map);
  checkedInteger(generation, "part generation");
  if (generation !== map.generation) throw new Error("Stale part generation");
  validateReceipt(map.sourceBytes, receipt);
  const existing = map.receipts.find((part) => part.number === receipt.number);
  if (existing) {
    if (existing.sha256 !== receipt.sha256) throw new Error("Part bytes changed");
    return map;
  }
  return { ...map, receipts: [...map.receipts, { ...receipt }].sort((a, b) => a.number - b.number) };
}

export function acknowledgedBytes(map: PartMap): number {
  validateMap(map);
  return checkedSum(map.receipts.map((part) => part.bytes), "acknowledged bytes");
}

export function missingParts(map: PartMap): number[] {
  validateMap(map);
  const seen = new Set(map.receipts.map((part) => part.number));
  return Array.from({ length: partCount(map.sourceBytes) }, (_, index) => index + 1).filter((number) => !seen.has(number));
}

/** Compare every retained part with reselected file bytes, not filename/mtime. */
export function resumeParts(map: PartMap, generation: number, reselected: readonly PartReceipt[]): number[] {
  validateMap(map);
  checkedInteger(generation, "part generation");
  if (generation !== map.generation) throw new Error("Stale resume generation");
  const evidence: PartMap = { ...map, receipts: reselected };
  validateMap(evidence);
  if (reselected.length !== map.receipts.length) throw new Error("Hash every retained part before resuming");
  const byNumber = new Map(reselected.map((part) => [part.number, part]));
  for (const saved of map.receipts) {
    if (byNumber.get(saved.number)?.sha256 !== saved.sha256) throw new Error("Reselected file bytes differ");
  }
  return missingParts(map);
}

export function requireCompleteParts(map: PartMap, generation: number): void {
  checkedInteger(generation, "part generation");
  if (generation !== map.generation) throw new Error("Stale completion generation");
  if (missingParts(map).length) throw new Error("Upload incomplete");
}
