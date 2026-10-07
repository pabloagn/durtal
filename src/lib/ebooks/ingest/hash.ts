import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

/*
 * Checksums of files on disk (SLN-494): streamed in 1 MiB chunks, never the
 * whole file in memory, and cached by real path, size, modification time and
 * inode, so a second plan re-hashes only the files that changed.
 */

const CHUNK = 1024 * 1024;

/** The SHA-256 of a file, as 64 lowercase hex characters */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file, { highWaterMark: CHUNK })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export interface FileFingerprint {
  /** The real path (symlinks resolved) */
  path: string;
  size: number;
  mtimeMs: number;
  ino: number;
}

interface CacheLine extends FileFingerprint {
  sha256: string;
}

const fingerprintKey = (f: FileFingerprint) => `${f.path}\0${f.size}\0${f.mtimeMs}\0${f.ino}`;

/** A file's fingerprint: what the cache and a plan's inputs are keyed by */
export async function fingerprint(file: string): Promise<FileFingerprint> {
  const real = await realpath(file);
  const info = await stat(real);
  return { path: real, size: info.size, mtimeMs: info.mtimeMs, ino: info.ino };
}

/**
 * Hashes remembered in `hashes.jsonl` in the cache folder, one JSON line per
 * file hashed; a later line wins. A line whose fingerprint no longer matches
 * the file is never used.
 */
export class HashCache {
  private readonly known = new Map<string, string>();
  private readonly file: string;

  constructor(cacheDir: string) {
    mkdirSync(cacheDir, { recursive: true });
    this.file = path.join(cacheDir, "hashes.jsonl");
    if (!existsSync(this.file)) return;
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as CacheLine;
        if (/^[0-9a-f]{64}$/.test(entry.sha256)) this.known.set(fingerprintKey(entry), entry.sha256);
      } catch {
        // A line cut by a crash: ignored, the file is hashed again
      }
    }
  }

  /** The file's checksum, from the cache when its fingerprint is unchanged */
  async hash(file: string): Promise<FileFingerprint & { sha256: string; cached: boolean }> {
    const print = await fingerprint(file);
    const known = this.known.get(fingerprintKey(print));
    if (known) return { ...print, sha256: known, cached: true };
    const sha256 = await sha256File(print.path);
    // The file may have changed while it was read: cache only what still matches
    const after = await fingerprint(file);
    if (fingerprintKey(after) === fingerprintKey(print)) {
      this.known.set(fingerprintKey(print), sha256);
      appendFileSync(this.file, JSON.stringify({ ...print, sha256 } satisfies CacheLine) + "\n");
    }
    return { ...print, sha256, cached: false };
  }
}
