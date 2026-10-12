import { z } from "zod";
import { lookupSelection } from "./candidates";
import { lookupDatabase } from "./database";
export const LOOKUP_HISTORY_LIMIT = 5000;
export const lookupHistorySchema = z.object({
  word: z.string().min(1).max(4096), sentence: z.string().max(300),
  ebookId: z.uuid(), ebookTitle: z.string().max(2000),
  language: z.string().regex(/^[a-z]{2,3}$/), at: z.iso.datetime(),
}).strict();
export type LookupHistoryRecord = z.infer<typeof lookupHistorySchema>;
export type LookupHistoryEntry = LookupHistoryRecord & { id: number };
export interface LookupHistoryStore {
  count(signal?: AbortSignal): Promise<number>;
  list(limit: number, offset?: number, signal?: AbortSignal): Promise<LookupHistoryEntry[]>;
  add(record: LookupHistoryRecord, signal?: AbortSignal): Promise<number>;
  updateLanguage(id: number, language: string, signal?: AbortSignal): Promise<void>;
  clear(signal?: AbortSignal): Promise<void>;
  close(): void;
}
export async function recordLookupHistory(store: LookupHistoryStore, input: LookupHistoryRecord,
  signal?: AbortSignal): Promise<number | null> {
  const record = lookupHistorySchema.parse(input);
  return lookupSelection(record.word, record.language).kind === "word" ? store.add(record, signal) : null;
}
export function browserLookupHistoryStore(): LookupHistoryStore {
  const database = lookupDatabase();
  return {
    count(signal) { return database.run<number>("readonly", (store, result) => {
      const request = store.count(); request.onsuccess = () => result(request.result);
    }, signal); },
    list(limit, offset = 0, signal) {
      z.number().int().min(1).max(5000).parse(limit); z.number().int().min(0).max(5000).parse(offset);
      return database.run<LookupHistoryEntry[]>("readonly", (store, result, guard) => {
        const entries: LookupHistoryEntry[] = [];
        const request = store.index("at").openCursor(null, "prev");
        let advanced = offset === 0;
        request.onsuccess = () => guard(() => {
          const cursor = request.result;
          if (!cursor) { result(entries); return; }
          if (!advanced) { advanced = true; cursor.advance(offset); return; }
          const id = z.number().int().positive().parse(cursor.primaryKey);
          entries.push({ ...lookupHistorySchema.parse(cursor.value), id });
          if (entries.length < limit) cursor.continue(); else result(entries);
        });
      }, signal);
    },
    add(input, signal) {
      const record = lookupHistorySchema.parse(input);
      if (lookupSelection(record.word, record.language).kind !== "word")
        return Promise.reject(new Error("Passages are not saved in lookup history"));
      return database.run<number>("readwrite", (store, result, guard) => {
        const request = store.add(record);
        request.onsuccess = () => guard(() => {
          result(z.number().int().positive().parse(request.result));
          const count = store.count();
          count.onsuccess = () => guard(() => {
            let remaining = count.result - LOOKUP_HISTORY_LIMIT;
            if (remaining <= 0) return;
            const oldest = store.index("at").openCursor();
            oldest.onsuccess = () => guard(() => {
              const cursor = oldest.result;
              if (!cursor || remaining <= 0) return;
              cursor.delete(); if (--remaining > 0) cursor.continue();
            });
          });
        });
      }, signal);
    },
    updateLanguage(id, language, signal) {
      z.number().int().positive().parse(id); lookupHistorySchema.shape.language.parse(language);
      return database.run<void>("readwrite", (store, result, guard) => {
        const request = store.get(id);
        request.onsuccess = () => guard(() => {
          if (request.result !== undefined)
            store.put({ ...lookupHistorySchema.parse(request.result), language }, id);
          result(undefined);
        });
      }, signal);
    },
    clear(signal) { return database.run<void>("readwrite", (store, result) => {
      const request = store.clear(); request.onsuccess = () => result(undefined);
    }, signal); },
    close: () => database.close(),
  };
}
