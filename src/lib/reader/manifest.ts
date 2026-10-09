import { isManifestKey, isSha256 } from "@/lib/ebooks/keys";
import { getEbookObjectRange } from "@/lib/ebooks/storage";

/**
 * The zip central directory's offset from a file's manifest (written by
 * eBooks sub-issue 5), so the page's first range is exactly the directory.
 * A manifest never changes for a checksum, so each is read once per server
 * process; a slow or missing one is skipped (the page then asks for the
 * last 64 KiB, which holds the directory of most books).
 */

const MAX_MANIFEST_BYTES = 512 * 1024;
const WAIT_MS = 250;
const CACHE_SIZE = 500;

const cache = new Map<string, number | null>();

async function readCdOffset(key: string): Promise<number | null> {
  const object = await getEbookObjectRange(key, 0, MAX_MANIFEST_BYTES - 1);
  if (!object) return null;
  const text = await new Response(object.body).text();
  const manifest = JSON.parse(text) as { zip?: { cdOffset?: unknown } };
  const offset = manifest.zip?.cdOffset;
  return typeof offset === "number" && Number.isSafeInteger(offset) && offset >= 0 ? offset : null;
}

export async function zipCdOffset(file: { sha256: string; manifestKey: string | null }): Promise<number | null> {
  if (!file.manifestKey || !isSha256(file.sha256)) return null;
  // Only the key keys.ts builds for this checksum
  const key = file.manifestKey;
  if (!isManifestKey(key, file.sha256)) return null;
  if (cache.has(key)) return cache.get(key) ?? null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = readCdOffset(key).catch(() => null);
  const offset = await Promise.race([
    read,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  // A slow read still fills the cache for the next open
  if (offset === undefined) {
    void read.then((value) => remember(key, value));
    return null;
  }
  remember(key, offset);
  return offset;
}

function remember(key: string, value: number | null) {
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}
