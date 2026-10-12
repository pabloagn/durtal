import { z } from "zod";
import { PACK_IMPORT_LIMITS } from "./pack-limits";

export const packRecordSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(500),
    language: z.string().regex(/^[a-z]{2,3}$/),
    wordCount: z.number().int().min(0).max(5_000_000),
    sizeBytes: z
      .number()
      .int()
      .min(0)
      .max(9 * 1024 ** 3),
    hasSyn: z.boolean(),
    types: z
      .string()
      .regex(/^[A-Za-z]{1,32}$/)
      .nullable(),
    addedAt: z.iso.datetime(),
  })
  .strict();
export type PackRecord = z.infer<typeof packRecordSchema>;
export function samePackRecord(left: PackRecord, right: PackRecord): boolean {
  return (Object.keys(packRecordSchema.shape) as (keyof PackRecord)[]).every(
    (key) => left[key] === right[key],
  );
}

export interface LookupPackStore {
  list(signal?: AbortSignal): Promise<PackRecord[]>;
  put(record: PackRecord, signal?: AbortSignal): Promise<void>;
  remove(id: string, signal?: AbortSignal): Promise<void>;
  close(): void;
}

/** Shared only by lookup packs/history. It never opens durtal-offline. */
export function browserPackStore(): LookupPackStore {
  let connection: Promise<IDBDatabase> | null = null;
  const open = () =>
    (connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("durtal-lookup", 1);
      let abandoned = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("packs"))
          db.createObjectStore("packs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("history"))
          db.createObjectStore("history", { autoIncrement: true }).createIndex(
            "at",
            "at",
          );
      };
      request.onerror = () => {
        connection = null;
        reject(request.error);
      };
      request.onblocked = () => {
        abandoned = true;
        connection = null;
        reject(new Error("Close another Durtal tab to update lookup storage"));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
    }));
  async function run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const db = await open();
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("packs", mode);
      let result: T;
      const abort = () => {
        try {
          transaction.abort();
        } catch {}
      };
      signal?.addEventListener("abort", abort, { once: true });
      const done = () => signal?.removeEventListener("abort", abort);
      transaction.oncomplete = () => {
        done();
        resolve(result);
      };
      transaction.onabort = () => {
        done();
        reject(
          signal?.aborted
            ? signal.reason
            : (transaction.error ??
                new Error("Lookup storage could not save this change")),
        );
      };
      transaction.onerror = () => {};
      try {
        const request = action(transaction.objectStore("packs"));
        request.onsuccess = () => {
          result = request.result;
        };
      } catch (error) {
        abort();
        done();
        reject(error);
      }
    });
  }
  return {
    async list(signal) {
      const rows = await run(
        "readonly",
        (store) => store.getAll(undefined, PACK_IMPORT_LIMITS.maximumPacks + 1),
        signal,
      );
      if (rows.length > PACK_IMPORT_LIMITS.maximumPacks)
        throw new Error("There are too many dictionaries on this device");
      return rows
        .map((row) => packRecordSchema.parse(row))
        .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    },
    async put(record, signal) {
      await run(
        "readwrite",
        (store) => store.put(packRecordSchema.parse(record)),
        signal,
      );
    },
    async remove(id, signal) {
      z.uuid().parse(id);
      await run("readwrite", (store) => store.delete(id), signal);
    },
    close() {
      const current = connection;
      connection = null;
      void current?.then((db) => db.close()).catch(() => {});
    },
  };
}
