/** Shared upload limits. These are policy, not claims about runtime enforcement. */
export const KiB = 1024;
export const MiB = 1024 * KiB;
export const GiB = 1024 * MiB;

export const UPLOAD_LIMITS = Object.freeze({
  filesPerBatch: 50,
  sourceBytes: 4 * GiB,
  partBytes: 8 * MiB,
  partsPerFile: 512,
  allocationUnitBytes: 64 * KiB,
  spoolQuotaBytes: 32 * GiB,
  freeReserveBytes: 8 * GiB,
  globalAllowanceBytes: 80 * MiB,
  derivedBytes: 256 * MiB,
  scratchBytes: 256 * MiB,
  itemMetadataBytes: 16 * MiB,
  clientPartConcurrency: 4,
  serverPartConcurrency: 8,
  retentionMs: 48 * 60 * 60 * 1000,
  workerLeaseMs: 60 * 1000,
  centralDirectoryBytes: 8 * MiB,
  archiveEntries: 10_000,
  entryDecodedBytes: 64 * MiB,
  cumulativeDecodedBytes: 256 * MiB,
  retainedTextCodeUnits: 32 * MiB,
  imagePixels: 16_777_216,
  imageDimension: 16_384,
  nativeImageBytes: 128 * MiB,
  coverWidth: 800,
  coverHeight: 4096,
  reportBytes: 8 * MiB,
  v8HeapBytes: 256 * MiB,
  processTreeMemoryBytes: 768 * MiB,
  inspectionMs: 120 * 1000,
  pdfTextMs: 60 * 1000,
  jobMs: 1800 * 1000,
  terminationGraceMs: 5 * 1000,
  cleanupMs: 30 * 1000,
});

/** Refuse unsafe arithmetic rather than letting a limit round or wrap. */
export function checkedInteger(value: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}

export function checkedSum(values: readonly number[], name: string): number {
  return values.reduce((sum, value) => checkedInteger(sum + checkedInteger(value, name), name), 0);
}

export function checkedSourceSize(size: number): number {
  return checkedInteger(size, "source size", 1, UPLOAD_LIMITS.sourceBytes);
}
