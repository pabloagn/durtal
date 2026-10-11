export const PACK_IMPORT_LIMITS = {
  archiveBytes: 512 * 1024 * 1024,
  archiveEntries: 64,
  centralDirectoryBytes: 256 * 1024,
  compressionRatio: 1000,
  maximumPacks: 32,
  importTimeoutMs: 120000,
  openIndexBytes: 32 * 1024 * 1024,
  resultBytes: 1024 * 1024,
} as const;
