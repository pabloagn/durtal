import type { PackManifest } from "./pack-files";
import {
  samePackRecord,
  type LookupPackStore,
  type PackRecord,
} from "./pack-store";

export interface PackPublicationFiles {
  names(): Promise<string[]>;
  manifest(id: string, signal?: AbortSignal): Promise<PackManifest>;
  remove(id: string): Promise<void>;
}

const packId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Called under the exclusive cross-tab pack lock. An OPFS folder alone never publishes a pack. */
export async function reconcileLookupPacks(
  files: PackPublicationFiles,
  store: LookupPackStore,
  signal?: AbortSignal,
) {
  const records = await store.list(signal),
    byId = new Map(records.map((record) => [record.id, record]));
  const remaining = new Set(byId.keys());
  for (const id of await files.names()) {
    signal?.throwIfAborted();
    if (!packId.test(id)) continue;
    remaining.delete(id);
    let complete = false;
    try {
      const manifest = await files.manifest(id, signal),
        record = byId.get(id);
      complete =
        !!record &&
        manifest.record.id === id &&
        samePackRecord(manifest.record, record);
    } catch {
      signal?.throwIfAborted();
    }
    if (!complete) {
      // Drop the catalog record first: failed deletion leaves an unpublished orphan to retry next time.
      if (byId.has(id)) await store.remove(id, signal);
      await files.remove(id);
    }
  }
  for (const id of remaining) {
    signal?.throwIfAborted();
    await store.remove(id, signal);
  }
  return store.list(signal);
}

/** The ready marker is durable before this call. IDB commit is the publication boundary. */
export async function publishLookupPack(
  record: PackRecord,
  files: PackPublicationFiles,
  store: LookupPackStore,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const manifest = await files.manifest(record.id, signal);
  if (!samePackRecord(manifest.record, record))
    throw new Error("The dictionary publication does not match its files");
  try {
    await store.put(record, signal);
  } catch (error) {
    // Best effort cleanup; reconciliation handles a crash or an independent storage failure here.
    await store.remove(record.id).catch(() => {});
    await files.remove(record.id).catch(() => {});
    throw error;
  }
}
