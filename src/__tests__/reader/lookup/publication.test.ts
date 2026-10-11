import { describe, expect, it, vi } from "vitest";
import {
  publishLookupPack,
  reconcileLookupPacks,
  type PackPublicationFiles,
} from "@/lib/reader/lookup/pack-publication";
import {
  packManifestSchema,
  type PackManifest,
} from "@/lib/reader/lookup/pack-files";
import type {
  LookupPackStore,
  PackRecord,
} from "@/lib/reader/lookup/pack-store";

const id = "00000000-0000-4000-8000-000000000001";
const record: PackRecord = {
  id,
  name: "Synthetic",
  language: "la",
  wordCount: 0,
  sizeBytes: 14,
  hasSyn: false,
  types: "m",
  addedAt: "2026-10-09T20:00:00.000Z",
};
const manifest: PackManifest = {
  v: 1,
  record,
  dictzip: false,
  dictionaryBytes: "0",
  files: {
    "dict.ifo": 10,
    "dict.idx": 0,
    dictionary: 0,
    "dict.syn": null,
    "offsets.bin": 4,
    "syn-offsets.bin": null,
  },
};
function storage(
  initialRecords: PackRecord[] = [],
  folders = new Map<string, PackManifest | null>(),
) {
  const records = new Map(initialRecords.map((row) => [row.id, row]));
  const store: LookupPackStore = {
    list: vi.fn(async (signal) => {
      signal?.throwIfAborted();
      return [...records.values()];
    }),
    put: vi.fn(async (row, signal) => {
      signal?.throwIfAborted();
      records.set(row.id, row);
    }),
    remove: vi.fn(async (key, signal) => {
      signal?.throwIfAborted();
      records.delete(key);
    }),
    close: vi.fn(),
  };
  const files: PackPublicationFiles = {
    names: vi.fn(async () => [...folders.keys()]),
    manifest: vi.fn(async (key, signal) => {
      signal?.throwIfAborted();
      const ready = folders.get(key);
      if (!ready) throw new Error("Not ready");
      return ready;
    }),
    remove: vi.fn(async (key) => {
      folders.delete(key);
    }),
  };
  return { store, files, records, folders };
}

describe("pack publication reconciliation", () => {
  it("publishes only after the durable ready marker can be verified", async () => {
    const state = storage([], new Map([[id, manifest]]));
    await publishLookupPack(
      record,
      state.files,
      state.store,
      new AbortController().signal,
    );
    expect(state.store.put).toHaveBeenCalledWith(
      record,
      expect.any(AbortSignal),
    );
    expect(state.records.get(id)).toEqual(record);
    expect(state.files.remove).not.toHaveBeenCalled();
    const unfinished = storage([], new Map([[id, null]]));
    await expect(
      publishLookupPack(
        record,
        unfinished.files,
        unfinished.store,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/Not ready/);
    expect(unfinished.store.put).not.toHaveBeenCalled();
  });
  it("removes staged/ready orphans, incomplete published packs, and records whose folder was evicted", async () => {
    for (const [rows, folders] of [
      [[], new Map([[id, null]])],
      [[], new Map([[id, manifest]])],
      [[record], new Map([[id, null]])],
      [[record], new Map()],
      [[{ ...record, name: "stale" }], new Map([[id, manifest]])],
    ] as [PackRecord[], Map<string, PackManifest | null>][]) {
      const state = storage(rows, folders);
      expect(await reconcileLookupPacks(state.files, state.store)).toEqual([]);
      expect(state.folders.size).toBe(0);
      expect(state.records.size).toBe(0);
    }
    const valid = storage([record], new Map([[id, manifest]]));
    expect(await reconcileLookupPacks(valid.files, valid.store)).toEqual([
      record,
    ]);
    expect(valid.files.remove).not.toHaveBeenCalled();
    const reordered = storage(
      [
        {
          addedAt: record.addedAt,
          types: record.types,
          hasSyn: record.hasSyn,
          sizeBytes: record.sizeBytes,
          wordCount: record.wordCount,
          language: record.language,
          name: record.name,
          id: record.id,
        },
      ],
      new Map([[id, manifest]]),
    );
    expect(
      await reconcileLookupPacks(reordered.files, reordered.store),
    ).toEqual([record]);
  });
  it("cleans up both stores after a publication failure and leaves recoverable orphans if cleanup fails", async () => {
    const state = storage([], new Map([[id, manifest]]));
    state.store.put = async (row) => {
      state.records.set(row.id, row);
      throw new Error("commit failed");
    };
    await expect(
      publishLookupPack(
        record,
        state.files,
        state.store,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/commit failed/);
    expect(state.records.size).toBe(0);
    expect(state.folders.size).toBe(0);
    const retry = storage([], new Map([[id, manifest]]));
    retry.store.put = async () => {
      throw new Error("commit failed");
    };
    const remove = retry.files.remove;
    retry.files.remove = async () => {
      throw new Error("storage unavailable");
    };
    await expect(
      publishLookupPack(
        record,
        retry.files,
        retry.store,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/commit failed/);
    retry.files.remove = remove;
    expect(await reconcileLookupPacks(retry.files, retry.store)).toEqual([]);
    expect(retry.folders.size).toBe(0);
  });
  it("does not publish or delete anything after cancellation", async () => {
    const state = storage([record], new Map([[id, manifest]])),
      parent = new AbortController();
    parent.abort(new DOMException("closed", "AbortError"));
    await expect(
      publishLookupPack(record, state.files, state.store, parent.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      reconcileLookupPacks(state.files, state.store, parent.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(state.store.put).not.toHaveBeenCalled();
    expect(state.store.remove).not.toHaveBeenCalled();
    expect(state.files.remove).not.toHaveBeenCalled();
  });
  it("refuses inconsistent file/record allocation manifests", () => {
    expect(packManifestSchema.parse(manifest)).toEqual(manifest);
    for (const changed of [
      { ...manifest, record: { ...record, hasSyn: true } },
      { ...manifest, record: { ...record, wordCount: 1 } },
      { ...manifest, record: { ...record, sizeBytes: 15 } },
      { ...manifest, dictionaryBytes: "99999999999" },
    ])
      expect(packManifestSchema.safeParse(changed).success).toBe(false);
  });
});
