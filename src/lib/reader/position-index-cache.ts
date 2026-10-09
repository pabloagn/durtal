const LRU_KEY = "durtal-reader-index-lru";
export const indexKey = (hash: string) => "durtal-reader-index:" + hash;
export function readIndexCache(
  storage: Storage | null,
  hash: string,
): Record<string, number> {
  try {
    const raw = JSON.parse(storage?.getItem(indexKey(hash)) ?? "null");
    if (raw?.v !== 1 || !raw.fractions || typeof raw.fractions !== "object")
      return {};
    const fractions = Object.fromEntries(
      Object.entries(raw.fractions).filter(
        ([href, value]) =>
          href.length < 4096 &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value >= 0 &&
          value <= 1,
      ),
    ) as Record<string, number>;
    writeIndexCache(storage, hash, fractions);
    return fractions;
  } catch {
    return {};
  }
}
export function writeIndexCache(
  storage: Storage | null,
  hash: string,
  fractions: Record<string, number>,
) {
  if (!storage) return;
  try {
    const raw = JSON.parse(storage.getItem(LRU_KEY) ?? "[]");
    const lru = [
      hash,
      ...(Array.isArray(raw)
        ? raw.filter(
            (value): value is string =>
              typeof value === "string" &&
              /^[0-9a-f]{64}$/.test(value) &&
              value !== hash,
          )
        : []),
    ];
    storage.setItem(indexKey(hash), JSON.stringify({ v: 1, fractions }));
    for (const old of lru.slice(50)) storage.removeItem(indexKey(old));
    storage.setItem(LRU_KEY, JSON.stringify(lru.slice(0, 50)));
  } catch {
    /* Disabled storage never blocks opening or navigation. */
  }
}
