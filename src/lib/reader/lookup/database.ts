/** Lookup storage is independent of durtal-offline and never makes a server request. */
export function lookupDatabase() {
  let connection: Promise<IDBDatabase> | null = null;
  function open() {
    return connection ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("durtal-lookup", 1);
      let abandoned = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("packs")) db.createObjectStore("packs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("history"))
          db.createObjectStore("history", { autoIncrement: true }).createIndex("at", "at");
      };
      request.onerror = () => { connection = null; reject(request.error); };
      request.onblocked = () => {
        abandoned = true; connection = null;
        reject(new Error("Close another Durtal tab to update lookup storage"));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
    });
  }
  return {
    async run<T>(mode: IDBTransactionMode,
      action: (store: IDBObjectStore, result: (value: T) => void, guard: (callback: () => void) => void) => void,
      signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const db = await open(); signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("history", mode);
        let value: T, failure: unknown;
        const abort = () => { try { transaction.abort(); } catch {} };
        const guard = (callback: () => void) => { try { callback(); } catch (error) { failure = error; abort(); } };
        signal?.addEventListener("abort", abort, { once: true });
        const done = () => signal?.removeEventListener("abort", abort);
        transaction.oncomplete = () => { done(); resolve(value); };
        transaction.onabort = () => {
          done(); reject(signal?.aborted ? signal.reason : failure ?? transaction.error ??
            new Error("Lookup history could not save this change"));
        };
        transaction.onerror = () => {};
        guard(() => action(transaction.objectStore("history"), result => { value = result; }, guard));
      });
    },
    close() { const current = connection; connection = null; void current?.then(db => db.close()).catch(() => {}); },
  };
}
