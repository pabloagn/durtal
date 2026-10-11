// Published package platform checks; no bespoke IDB implementation.
// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new DOMException("Transaction explicitly aborted", "AbortError"));
});
async function open(factory: InstanceType<typeof IDBFactory>, name: string) {
  const request = factory.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore("items", { keyPath: "id", autoIncrement: true })
    .createIndex("label", "label", { unique: true });
  return result(request);
}
export async function checkCommitIsolation() {
  const factory = new IDBFactory(), db = await open(factory, "commit");
  try {
    let committed = false;
    const input = { label: "original" }, tx = db.transaction("items", "readwrite"), done = complete(tx).then(() => { committed = true; });
    const added = result(tx.objectStore("items").add(input));
    input.label = "mutated caller";
    // This transaction is created while the writer is active. It cannot see an
    // eagerly published partial write or start from a stale creation snapshot.
    const reading = db.transaction("items", "readonly"), readDone = complete(reading);
    const record = await result(reading.objectStore("items").get(1));
    expect(committed).toBe(true); expect(await added).toBe(1);
    expect(record).toEqual({ id: 1, label: "original" });
    await done; await readDone;
    db.close();
    const reopened = await open(factory, "commit");
    try {
      const read = reopened.transaction("items", "readonly"), end = complete(read);
      expect(await result(read.objectStore("items").index("label").get("original"))).toEqual(record);
      await end;
    } finally { reopened.close(); }
  } finally { db.close(); await result(factory.deleteDatabase("commit")); }
}
export async function checkRollback() {
  const factory = new IDBFactory(), db = await open(factory, "rollback");
  try {
    const tx = db.transaction("items", "readwrite"), aborted = complete(tx).catch(error => error);
    const first = result(tx.objectStore("items").add({ label: "duplicate" }));
    const duplicate = result(tx.objectStore("items").add({ label: "duplicate" })).catch(error => error);
    expect(await first).toBe(1); expect((await duplicate).name).toBe("ConstraintError");
    expect((await aborted).name).toBe("ConstraintError");
    const read = db.transaction("items", "readonly"), readDone = complete(read);
    expect(await result(read.objectStore("items").getAll())).toEqual([]); await readDone;
    const writing = db.transaction("items", "readwrite"), writeDone = complete(writing);
    expect(await result(writing.objectStore("items").add({ label: "after abort" }))).toBe(1); await writeDone;
    const aborting = db.transaction("items", "readwrite"), abortDone = complete(aborting).catch(error => error);
    await result(aborting.objectStore("items").put({ id: 1, label: "uncommitted overwrite" }));
    aborting.abort(); expect((await abortDone).name).toBe("AbortError");
    const retained = db.transaction("items", "readonly"), retainedDone = complete(retained);
    expect(await result(retained.objectStore("items").get(1))).toEqual({ id: 1, label: "after abort" }); await retainedDone;
  } finally { db.close(); await result(factory.deleteDatabase("rollback")); }
}
export async function checkCloseDelete() {
  const factory = new IDBFactory(), db = await open(factory, "delete");
  const tx = db.transaction("items", "readwrite"), done = complete(tx);
  await result(tx.objectStore("items").add({ label: "retained" })); await done;
  db.close(); expect(() => db.transaction("items")).toThrow();
  const reopened = await open(factory, "delete");
  const request = factory.deleteDatabase("delete");
  const blocked = new Promise<void>(resolve => { request.onblocked = () => resolve(); });
  const removed = result(request);
  await blocked; reopened.close(); await removed;
  const fresh = await open(factory, "delete");
  try {
    const reading = fresh.transaction("items", "readonly"), end = complete(reading);
    expect(await result(reading.objectStore("items").getAll())).toEqual([]); await end;
  } finally { fresh.close(); await result(factory.deleteDatabase("delete")); }
}

describe("pinned IndexedDB platform contracts", () => {
  it("serializes commit visibility and retains exact originals after reopen", checkCommitIsolation);
  it("rolls back duplicate indexes and aborted writes without consuming keys", checkRollback);
  it("closes connections and blocks deletion until remaining owners close", checkCloseDelete);
});
