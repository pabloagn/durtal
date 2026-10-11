import { describe, expect, it } from "vitest";
import { LOOKUP_HISTORY_LIMIT, recordLookupHistory, lookupHistorySchema,
  type LookupHistoryStore, type LookupHistoryRecord, type LookupHistoryEntry } from "@/lib/reader/lookup/history";
/** Contract fixture only. Native IDB transaction/eviction acceptance remains separate. */
function memoryStore(): LookupHistoryStore {
  const rows: LookupHistoryEntry[] = []; let sequence = 0;
  return {
    count: async () => rows.length,
    list: async (limit, offset = 0) => [...rows].sort((a,b) => b.at.localeCompare(a.at) || b.id-a.id).slice(offset, offset+limit),
    add: async input => {
      const row = { ...lookupHistorySchema.parse(input), id: ++sequence }; rows.push(row);
      if (rows.length > LOOKUP_HISTORY_LIMIT) {
        rows.sort((a,b) => a.at.localeCompare(b.at) || a.id-b.id); rows.shift();
      }
      return row.id;
    },
    updateLanguage: async (id, language) => { const row = rows.find(row => row.id === id); if (row) row.language = language; },
    clear: async () => { rows.length = 0; }, close() {},
  };
}
const record = (word = "lux", at = "2026-10-11T12:00:00.000Z"): LookupHistoryRecord => ({
  word, at, sentence: "Lux lucet.", ebookId: "467ab36f-bbd0-4807-8e37-abdf0f6b9577", ebookTitle: "Synthetic book", language: "la",
});
describe("lookup history boundary and store contract", () => {
  it("records only word lookups and language changes update that original record", async () => {
    const store = memoryStore(), id = await recordLookupHistory(store, record());
    expect(await recordLookupHistory(store, record("one two three four five six"))).toBeNull();
    await store.updateLanguage(id!, "en");
    expect(await store.count()).toBe(1);
    expect(await store.list(20)).toMatchObject([{ word: "lux", language: "en", sentence: "Lux lucet." }]);
  });
  it("returns newest first, supports bounded pagination, caps 5,000 and clears", async () => {
    const store = memoryStore();
    for (let index = 0; index <= 5000; index++)
      await store.add(record("word" + index, new Date(Date.UTC(2026, 9, 11, 0, 0, index)).toISOString()));
    expect(await store.count()).toBe(5000);
    expect((await store.list(1))[0].word).toBe("word5000");
    expect((await store.list(1, 4999))[0].word).toBe("word1");
    await store.clear(); expect(await store.count()).toBe(0);
  });
  it("refuses oversized/corrupt browser records without calling the store", async () => {
    const store = memoryStore();
    await expect(recordLookupHistory(store, { ...record(), sentence: "x".repeat(301) })).rejects.toThrow();
    await expect(recordLookupHistory(store, { ...record(), ebookId: "../reader" })).rejects.toThrow();
    expect(await store.count()).toBe(0);
  });
});
