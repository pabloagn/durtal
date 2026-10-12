import { readerUuid } from "@/lib/reader/uuid";
import { normalizeLanguage } from "@/lib/utils/language";
import { consumePackFile, openPackInput } from "./archive";
import { PACK_IMPORT_LIMITS } from "./pack-limits";
import {
  directoryNames,
  fileSource,
  packFile,
  packRoot,
  readPackManifest,
  writePackBytes,
  writePackFile,
  writePackOffsets,
  type PackManifest,
} from "./pack-files";
import {
  publishLookupPack,
  reconcileLookupPacks,
  type PackPublicationFiles,
} from "./pack-publication";
import {
  browserPackStore,
  samePackRecord,
  type PackRecord,
} from "./pack-store";
import { operationSignal } from "./resources";
import {
  readDictzipHeader,
  verifyDictzip,
  inflateDictzipChunk,
} from "./dictzip";
import {
  STARDICT_LIMITS,
  buildStarDictOffsets,
  dictzipEntryChunks,
  parseStarDictEntry,
  parseStarDictIndexEntry,
  parseStarDictInfo,
  searchStarDictIndex,
  searchStarDictSynonyms,
  starDictValidationAllocation,
  validateDictionaryRange,
  validateStarDictOffsets,
  type DictzipHeader,
  type StarDictInfo,
} from "./stardict";

interface OpenPack {
  manifest: PackManifest;
  info: StarDictInfo;
  index: File;
  dictionary: File;
  synonyms: File | null;
  offsets: Uint32Array;
  synOffsets: Uint32Array | null;
  header: DictzipHeader | null;
  bytes: number;
}
export interface PackLookupEntry {
  packId: string;
  headword: string;
  parts: { type: string; text: string }[];
}

/** Dedicated-worker implementation; importing this module does not acquire storage or start work. */
export class LookupPackRuntime {
  private readonly store = browserPackStore();
  private opened = new Map<string, OpenPack>();
  private openedBytes = 0;

  async inspect(files: readonly File[], signal: AbortSignal) {
    const input = await openPackInput(files, signal);
    try {
      const pieces: Uint8Array[] = [];
      const size = await consumePackFile(
        input.info,
        false,
        STARDICT_LIMITS.headerBytes,
        signal,
        (chunk) => pieces.push(chunk.slice()),
      );
      const raw = new Uint8Array(size);
      let at = 0;
      for (const piece of pieces) {
        raw.set(piece, at);
        at += piece.length;
      }
      const info = parseStarDictInfo(
        new TextDecoder("utf-8", { fatal: true }).decode(raw),
      );
      starDictValidationAllocation(info, input.synonyms?.size ?? null);
      return {
        name: info.name,
        language: normalizeLanguage(info.language) ?? null,
        wordCount: info.wordCount,
        dictzip: input.dictzip,
      };
    } finally {
      await input.close();
    }
  }

  private async lock<T>(
    mode: LockMode,
    signal: AbortSignal,
    run: () => Promise<T>,
  ) {
    if (!navigator.locks?.request)
      throw new Error("This browser cannot coordinate dictionary storage");
    return navigator.locks.request(
      "durtal-lookup-packs",
      { mode, signal },
      run,
    );
  }
  private files(root: FileSystemDirectoryHandle): PackPublicationFiles {
    return {
      names: () => directoryNames(root),
      manifest: async (id, signal) =>
        readPackManifest(await root.getDirectoryHandle(id), signal),
      remove: (id) => root.removeEntry(id, { recursive: true }),
    };
  }
  private forget(id: string) {
    const prior = this.opened.get(id);
    if (prior) {
      this.openedBytes -= prior.bytes;
      this.opened.delete(id);
    }
  }

  async list(signal: AbortSignal) {
    return this.lock("exclusive", signal, async () => {
      const records = await reconcileLookupPacks(
        this.files(await packRoot()),
        this.store,
        signal,
      );
      for (const id of this.opened.keys())
        if (!records.some((record) => record.id === id)) this.forget(id);
      return records;
    });
  }

  async install(
    files: readonly File[],
    language: string,
    parent: AbortSignal,
  ): Promise<PackRecord> {
    const normalized = normalizeLanguage(language);
    if (!normalized || normalized !== language)
      throw new Error("Choose the dictionary's language");
    const lifetime = operationSignal(
        parent,
        PACK_IMPORT_LIMITS.importTimeoutMs,
      ),
      signal = lifetime.signal;
    try {
      return await this.lock("exclusive", signal, async () => {
        this.opened.clear();
        this.openedBytes = 0;
        const root = await packRoot(),
          publication = this.files(root);
        const records = await reconcileLookupPacks(
          publication,
          this.store,
          signal,
        );
        if (records.length >= PACK_IMPORT_LIMITS.maximumPacks)
          throw new Error("Remove a dictionary before adding another");
        const input = await openPackInput(files, signal);
        let stagedId: string | null = null;
        let inputClosed = false;
        try {
          const pieces: Uint8Array[] = [];
          const infoBytes = await consumePackFile(
            input.info,
            false,
            STARDICT_LIMITS.headerBytes,
            signal,
            (bytes) => pieces.push(bytes.slice()),
          );
          const raw = new Uint8Array(infoBytes);
          let at = 0;
          for (const piece of pieces) {
            raw.set(piece, at);
            at += piece.length;
          }
          pieces.length = 0;
          const info = parseStarDictInfo(
            new TextDecoder("utf-8", { fatal: true }).decode(raw),
          );
          const allocation = starDictValidationAllocation(
            info,
            input.synonyms?.size ?? null,
          );
          const needed =
            infoBytes +
            info.indexBytes +
            input.dictionary.size +
            (input.synonyms?.size ?? 0) +
            allocation.offsetsBytes +
            16 * 1024;
          const estimate = await navigator.storage.estimate();
          signal.throwIfAborted();
          if (estimate.quota === undefined || estimate.usage === undefined)
            throw new Error(
              "This browser could not check dictionary storage space",
            );
          const available = Math.max(0, estimate.quota - estimate.usage),
            reserve = Math.ceil(needed * 1.1);
          if (available < reserve)
            throw new Error(
              `Not enough space on this device: ${Math.ceil(reserve / 1024 ** 2)} MB needed, ${Math.floor(available / 1024 ** 2)} MB available`,
            );
          const id = readerUuid();
          const folder = await root.getDirectoryHandle(id, { create: true });
          stagedId = id;
          await writePackBytes(folder, "dict.ifo", raw, signal);
          const indexBytes = await writePackFile(
            folder,
            "dict.idx",
            input.index,
            input.compressedIndex,
            info.indexBytes,
            signal,
          );
          if (indexBytes !== info.indexBytes)
            throw new Error(
              `This .idx does not match its .ifo: ${info.indexBytes} bytes expected, ${indexBytes} found`,
            );
          const dictionaryName = input.dictzip ? "dict.dict.dz" : "dict.dict";
          const dictionaryBytesOnDisk = await writePackFile(
            folder,
            dictionaryName,
            input.dictionary,
            false,
            input.dictionary.size,
            signal,
          );
          if (dictionaryBytesOnDisk !== input.dictionary.size)
            throw new Error(
              "The dictionary file size does not match its archive",
            );
          const synonymsBytes = input.synonyms
            ? await writePackFile(
                folder,
                "dict.syn",
                input.synonyms,
                false,
                input.synonyms.size,
                signal,
              )
            : null;
          if (input.synonyms && synonymsBytes !== input.synonyms.size)
            throw new Error("The synonym file size does not match its archive");
          const dictionary = await packFile(folder, dictionaryName);
          const header = input.dictzip
            ? await verifyDictzip(fileSource(dictionary), signal)
            : null;
          const dictionaryBytes =
            header?.uncompressedBytes ?? BigInt(dictionary.size);
          validateDictionaryRange(BigInt(0), 0, dictionaryBytes);
          // Each RA boundary and the complete gzip CRC/ISIZE have been checked before publication.
          const headerBytes = (header?.chunks.length ?? 0) * 128;
          const limits = {
            ...STARDICT_LIMITS,
            validationBytes:
              STARDICT_LIMITS.validationBytes - headerBytes - 1024 * 1024,
          };
          const { offsets, synOffsets } = await buildStarDictOffsets({
            info,
            index: fileSource(await packFile(folder, "dict.idx")),
            synonyms: input.synonyms
              ? fileSource(await packFile(folder, "dict.syn"))
              : undefined,
            dictionaryBytes,
            limits,
            signal,
          });
          await writePackOffsets(folder, "offsets.bin", offsets, signal);
          if (synOffsets)
            await writePackOffsets(
              folder,
              "syn-offsets.bin",
              synOffsets,
              signal,
            );
          const sizes = {
            "dict.ifo": infoBytes,
            "dict.idx": indexBytes,
            dictionary: dictionaryBytesOnDisk,
            "dict.syn": synonymsBytes,
            "offsets.bin": offsets.byteLength,
            "syn-offsets.bin": synOffsets?.byteLength ?? null,
          };
          const record: PackRecord = {
            id,
            name: info.name,
            language: normalized,
            wordCount: info.wordCount,
            sizeBytes: Object.values(sizes).reduce<number>(
              (sum, size) => sum + (size ?? 0),
              0,
            ),
            hasSyn: !!input.synonyms,
            types: info.types,
            addedAt: new Date().toISOString(),
          };
          const manifest: PackManifest = {
            v: 1,
            record,
            dictzip: input.dictzip,
            dictionaryBytes: String(dictionaryBytes),
            files: sizes,
          };
          await input.close();
          inputClosed = true;
          const marker = new TextEncoder().encode(JSON.stringify(manifest));
          await writePackBytes(folder, "ready.json", marker, signal);
          await publishLookupPack(record, publication, this.store, signal);
          stagedId = null;
          return record;
        } finally {
          try {
            if (!inputClosed) await input.close();
          } finally {
            if (stagedId) await publication.remove(stagedId).catch(() => {});
          }
        }
      });
    } finally {
      lifetime.dispose();
    }
  }

  async remove(id: string, signal: AbortSignal) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new Error("Invalid dictionary identifier");
    return this.lock("exclusive", signal, async () => {
      this.forget(id);
      await this.store.remove(id, signal);
      try {
        await (await packRoot()).removeEntry(id, { recursive: true });
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "NotFoundError")
          throw error;
      }
    });
  }

  private async header(
    file: File,
    signal: AbortSignal,
  ): Promise<DictzipHeader> {
    return (await readDictzipHeader(fileSource(file), signal)).header;
  }

  private async open(
    record: PackRecord,
    signal: AbortSignal,
  ): Promise<OpenPack> {
    const cached = this.opened.get(record.id);
    if (cached) {
      this.opened.delete(record.id);
      this.opened.set(record.id, cached);
      return cached;
    }
    const folder = await (await packRoot()).getDirectoryHandle(record.id),
      manifest = await readPackManifest(folder, signal);
    if (!samePackRecord(record, manifest.record))
      throw new Error("The dictionary record does not match its files");
    const info = parseStarDictInfo(
      await (await packFile(folder, "dict.ifo")).text(),
    );
    if (
      info.wordCount !== record.wordCount ||
      info.types !== record.types ||
      info.indexBytes !== manifest.files["dict.idx"] ||
      (info.synonymCount ?? 0) + 1 !==
        (manifest.files["syn-offsets.bin"] ?? 4) / 4
    )
      throw new Error("The dictionary metadata does not match its indexes");
    const dictionary = await packFile(
      folder,
      manifest.dictzip ? "dict.dict.dz" : "dict.dict",
    );
    // Reserve both RA arrays and object/number overhead before parsing a new table.
    const headerReserve = manifest.dictzip
      ? STARDICT_LIMITS.headerBytes * 66
      : STARDICT_LIMITS.headerBytes;
    while (this.openedBytes + headerReserve > PACK_IMPORT_LIMITS.openIndexBytes)
      this.forget(this.opened.keys().next().value!);
    const header = manifest.dictzip
      ? await this.header(dictionary, signal)
      : null;
    const bytes =
      manifest.files["offsets.bin"] +
      (manifest.files["syn-offsets.bin"] ?? 0) +
      (header?.chunks.length ?? 0) * 128 +
      1024 * 1024;
    if (bytes > PACK_IMPORT_LIMITS.openIndexBytes)
      throw new Error("The dictionary indexes exceed the session memory limit");
    while (this.openedBytes + bytes > PACK_IMPORT_LIMITS.openIndexBytes)
      this.forget(this.opened.keys().next().value!);
    // Arrays are stored explicitly little endian. Current browser platforms use little endian typed arrays.
    if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1)
      throw new Error("This device's dictionary byte order is unsupported");
    const offsets = new Uint32Array(
      await (await packFile(folder, "offsets.bin")).arrayBuffer(),
    );
    const synOffsets = record.hasSyn
      ? new Uint32Array(
          await (await packFile(folder, "syn-offsets.bin")).arrayBuffer(),
        )
      : null;
    signal.throwIfAborted();
    validateStarDictOffsets(offsets, info.indexBytes, info.wordCount);
    if (synOffsets)
      validateStarDictOffsets(
        synOffsets,
        manifest.files["dict.syn"]!,
        info.synonymCount!,
      );
    const pack: OpenPack = {
      manifest,
      info,
      index: await packFile(folder, "dict.idx"),
      dictionary,
      synonyms: record.hasSyn ? await packFile(folder, "dict.syn") : null,
      offsets,
      synOffsets,
      header,
      bytes,
    };
    if (
      (pack.header?.uncompressedBytes ?? BigInt(dictionary.size)) !==
      BigInt(manifest.dictionaryBytes)
    )
      throw new Error("The dictionary byte count does not match its manifest");
    this.opened.set(record.id, pack);
    this.openedBytes += bytes;
    return pack;
  }

  private async entryBytes(
    pack: OpenPack,
    offset: bigint,
    size: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    validateDictionaryRange(
      offset,
      size,
      BigInt(pack.manifest.dictionaryBytes),
    );
    if (!pack.header)
      return fileSource(pack.dictionary).read(Number(offset), size, signal);
    const output = new Uint8Array(size),
      source = fileSource(pack.dictionary);
    let filled = 0;
    for (const chunk of dictzipEntryChunks(pack.header, offset, size)) {
      signal.throwIfAborted();
      const start = chunk.index * pack.header.chunkLength;
      let inflated = 0;
      await inflateDictzipChunk(
        source,
        pack.header,
        chunk.index,
        signal,
        (bytes) => {
          const from = Math.max(0, Number(offset) - start - inflated),
            to = Math.min(
              bytes.length,
              Number(offset) + size - start - inflated,
            );
          if (to > from) {
            output.set(bytes.subarray(from, to), filled);
            filled += to - from;
          }
          inflated += bytes.length;
        },
      );
    }
    if (filled !== size) throw new Error("The dictzip entry is incomplete");
    return output;
  }

  async lookup(
    packIds: readonly string[],
    words: readonly string[],
    signal: AbortSignal,
  ): Promise<PackLookupEntry[]> {
    if (
      packIds.length > PACK_IMPORT_LIMITS.maximumPacks ||
      new Set(packIds).size !== packIds.length ||
      words.length < 1 ||
      words.length > 2 ||
      words.some((word) => !word || word.length > 4096)
    )
      throw new Error("Invalid dictionary lookup");
    return this.lock("shared", signal, async () => {
      const records = await this.store.list(signal),
        entries: PackLookupEntry[] = [];
      let resultBytes = 0;
      for (const record of records.filter((record) =>
        packIds.includes(record.id),
      )) {
        signal.throwIfAborted();
        const pack = await this.open(record, signal);
        for (const word of words) {
          const matches = await searchStarDictIndex(
            fileSource(pack.index),
            pack.offsets,
            word,
            pack.info.offsetBits,
            { signal },
          );
          if (pack.synonyms && pack.synOffsets) {
            const synonyms = await searchStarDictSynonyms(
              fileSource(pack.synonyms),
              pack.synOffsets,
              word,
              pack.info.wordCount,
              { signal },
            );
            for (const index of synonyms) {
              const start = pack.offsets[index],
                length = pack.offsets[index + 1] - start;
              const hit = parseStarDictIndexEntry(
                await fileSource(pack.index).read(start, length, signal),
                pack.info.offsetBits,
              );
              if (
                !matches.some(
                  (entry) =>
                    entry.offset === hit.offset &&
                    entry.size === hit.size &&
                    entry.headword === hit.headword,
                )
              )
                matches.push(hit);
            }
          }
          for (const match of matches) {
            if (entries.length >= 200)
              throw new Error(
                "Too many dictionary entries share this headword",
              );
            const parts = parseStarDictEntry(
              await this.entryBytes(pack, match.offset, match.size, signal),
              pack.info.types,
            );
            resultBytes +=
              new TextEncoder().encode(match.headword).length +
              parts.reduce(
                (sum, part) => sum + new TextEncoder().encode(part.text).length,
                0,
              );
            if (resultBytes > PACK_IMPORT_LIMITS.resultBytes)
              throw new Error("The dictionary results exceed their size limit");
            entries.push({
              packId: record.id,
              headword: match.headword,
              parts,
            });
          }
          if (matches.length) break;
        }
      }
      return entries;
    });
  }
  close() {
    this.opened.clear();
    this.openedBytes = 0;
    this.store.close();
  }
}
