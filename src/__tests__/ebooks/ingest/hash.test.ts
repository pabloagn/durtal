import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HashCache, sha256File } from "@/lib/ebooks/ingest/hash";

/* SLN-494: streamed checksums, cached by path, size, time and inode */

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ingest-hash-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sha256File", () => {
  it("streams to the same hash as hashing the bytes at once", async () => {
    const file = path.join(dir, "big.bin");
    // Three chunks and a bit: the stream reads 1 MiB at a time
    const bytes = Buffer.alloc(3 * 1024 * 1024 + 4097, 0);
    for (let i = 0; i < bytes.length; i += 4096) bytes[i] = i % 251;
    writeFileSync(file, bytes);
    expect(await sha256File(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});

describe("HashCache", () => {
  it("hits on the same size and time, and misses after the file is touched", async () => {
    const file = path.join(dir, "book.epub");
    writeFileSync(file, "first bytes");
    const cacheDir = path.join(dir, "cache");
    const first = await new HashCache(cacheDir).hash(file);
    expect(first.cached).toBe(false);
    // A new cache reads the lines the first one wrote
    const again = await new HashCache(cacheDir).hash(file);
    expect(again).toMatchObject({ cached: true, sha256: first.sha256 });

    writeFileSync(file, "other bytes");
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later);
    const changed = await new HashCache(cacheDir).hash(file);
    expect(changed.cached).toBe(false);
    expect(changed.sha256).toBe(createHash("sha256").update("other bytes").digest("hex"));
    expect(readFileSync(path.join(cacheDir, "hashes.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});
