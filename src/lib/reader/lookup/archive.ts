import { BlobReader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import { STARDICT_LIMITS } from "./stardict";
import { consumeLookupStream } from "./resources";
import { PACK_IMPORT_LIMITS } from "./pack-limits";
export { PACK_IMPORT_LIMITS } from "./pack-limits";

export interface PackInputFile {
  name: string;
  size: number;
  writeTo(
    destination: WritableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void>;
}
export interface PackInput {
  info: PackInputFile;
  index: PackInputFile;
  dictionary: PackInputFile;
  synonyms: PackInputFile | null;
  compressedIndex: boolean;
  dictzip: boolean;
  close(): Promise<void>;
}

/** Bound zip.js's central-directory allocation before allowing it to enumerate anything. */
export function checkPackZipDirectory(tail: Uint8Array, fileBytes: number) {
  if (
    !Number.isSafeInteger(fileBytes) ||
    fileBytes < 22 ||
    fileBytes > PACK_IMPORT_LIMITS.archiveBytes ||
    tail.length > 65557
  )
    throw new Error("This dictionary archive exceeds its size limit");
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let at = tail.length - 22; at >= 0; at--) {
    if (
      view.getUint32(at, true) !== 0x06054b50 ||
      at + 22 + view.getUint16(at + 20, true) !== tail.length
    )
      continue;
    const count = view.getUint16(at + 10, true),
      directoryBytes = view.getUint32(at + 12, true),
      offset = view.getUint32(at + 16, true);
    if (
      view.getUint16(at + 4, true) !== 0 ||
      view.getUint16(at + 6, true) !== 0 ||
      view.getUint16(at + 8, true) !== count ||
      count < 1 ||
      count > PACK_IMPORT_LIMITS.archiveEntries ||
      directoryBytes > PACK_IMPORT_LIMITS.centralDirectoryBytes ||
      offset + directoryBytes !== fileBytes - tail.length + at ||
      directoryBytes < count * 46
    )
      throw new Error(
        "This dictionary archive has unsupported or invalid directory bounds",
      );
    // ZIP64, split archives and prepended/appended data are deliberately unsupported.
    return { count, directoryBytes, offset };
  }
  throw new Error("This is not a supported dictionary zip archive");
}

function safeName(name: string) {
  if (
    !name ||
    name.length > 200 ||
    /[\\\u0000-\u001f]/.test(name) ||
    name.startsWith("/") ||
    name.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("The dictionary archive contains an unsafe filename");
}

function chooseFiles(
  files: PackInputFile[],
  close: () => Promise<void>,
): PackInput {
  const selected = files.filter((file) =>
    /\.(ifo|idx(?:\.gz)?|dict(?:\.dz)?|syn)$/i.test(file.name),
  );
  const groups = new Set(
    selected.map((file) =>
      file.name.replace(/\.(ifo|idx(?:\.gz)?|dict(?:\.dz)?|syn)$/i, ""),
    ),
  );
  if (groups.size !== 1)
    throw new Error("Select the files of one StarDict dictionary");
  const choose = (suffix: RegExp, needed: boolean) => {
    const matches = selected.filter((file) => suffix.test(file.name));
    if (matches.length > 1 || (needed && matches.length !== 1))
      throw new Error("Select one .ifo, one index and one dictionary file");
    return matches[0] ?? null;
  };
  const info = choose(/\.ifo$/i, true)!,
    index = choose(/\.idx(?:\.gz)?$/i, true)!,
    dictionary = choose(/\.dict(?:\.dz)?$/i, true)!,
    synonyms = choose(/\.syn$/i, false);
  for (const file of selected) {
    const maximum =
      file === info
        ? STARDICT_LIMITS.headerBytes
        : file === dictionary
          ? Number(STARDICT_LIMITS.dictionaryBytes)
          : STARDICT_LIMITS.indexBytes;
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > maximum
    )
      throw new Error("A dictionary file exceeds its size limit");
  }
  return {
    info,
    index,
    dictionary,
    synonyms,
    compressedIndex: /\.gz$/i.test(index.name),
    dictzip: /\.dz$/i.test(dictionary.name),
    close,
  };
}

export async function openPackInput(
  files: readonly File[],
  signal: AbortSignal,
): Promise<PackInput> {
  signal.throwIfAborted();
  if (files.length < 1 || files.length > 4)
    throw new Error("Select one dictionary zip, or its files together");
  files.forEach((file) => safeName(file.name));
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
    const file = files[0];
    const tail = new Uint8Array(await file.slice(-65557).arrayBuffer());
    signal.throwIfAborted();
    const directory = checkPackZipDirectory(tail, file.size);
    const reader = new ZipReader(new BlobReader(file), {
      useWebWorkers: false,
      useCompressionStream: true,
      strictness: "strict",
      checkSignature: true,
      checkOverlappingEntry: true,
    });
    try {
      const entries: PackInputFile[] = [];
      let count = 0,
        total = 0;
      for await (const entry of reader.getEntriesGenerator()) {
        signal.throwIfAborted();
        if (++count > directory.count)
          throw new Error("The dictionary archive entry count is invalid");
        safeName(entry.filename);
        if (
          entry.encrypted ||
          entry.zip64 ||
          entry.symlink ||
          ![0, 8].includes(entry.compressionMethod)
        )
          throw new Error(
            "Encrypted, linked or unsupported dictionary archives cannot be installed",
          );
        if (entry.directory) continue;
        if (
          !Number.isSafeInteger(entry.uncompressedSize) ||
          entry.uncompressedSize < 0 ||
          !Number.isSafeInteger(entry.compressedSize) ||
          entry.compressedSize < 0 ||
          entry.uncompressedSize >
            Math.max(entry.compressedSize, 1) *
              PACK_IMPORT_LIMITS.compressionRatio
        )
          throw new Error("The dictionary archive exceeds its inflation limit");
        total += entry.uncompressedSize;
        if (
          total >
          Number(STARDICT_LIMITS.dictionaryBytes) +
            STARDICT_LIMITS.indexBytes * 2 +
            STARDICT_LIMITS.headerBytes
        )
          throw new Error(
            "The dictionary archive exceeds its extracted size limit",
          );
        const item = entry as FileEntry;
        entries.push({
          name: entry.filename,
          size: entry.uncompressedSize,
          async writeTo(destination, inputSignal) {
            await item.getData(destination, {
              signal: inputSignal,
              checkSignature: true,
              checkOverlappingEntry: true,
              useWebWorkers: false,
              useCompressionStream: true,
            });
          },
        });
      }
      if (count !== directory.count)
        throw new Error("The dictionary archive entry count is invalid");
      return chooseFiles(entries, () => reader.close());
    } catch (error) {
      await reader.close();
      throw error;
    }
  }
  return chooseFiles(
    files.map((file) => ({
      name: file.name,
      size: file.size,
      writeTo: (destination, inputSignal) =>
        file.stream().pipeTo(destination, { signal: inputSignal }),
    })),
    async () => {},
  );
}

/** Inflate with native gzip integrity checks and backpressure; never materialize an index or dictionary. */
export async function consumePackFile(
  file: PackInputFile,
  gzip: boolean,
  maximum: number,
  signal: AbortSignal,
  consume: (chunk: Uint8Array) => void,
): Promise<number> {
  signal.throwIfAborted();
  const controller = new AbortController(),
    relay = () => controller.abort(signal.reason);
  signal.addEventListener("abort", relay, { once: true });
  const pipe = new TransformStream<Uint8Array, Uint8Array<ArrayBuffer>>({
    transform(bytes, controller) {
      if (!(bytes instanceof Uint8Array))
        throw new Error("Invalid dictionary byte stream");
      controller.enqueue(bytes.slice());
    },
  });
  let streamed = pipe.readable;
  try {
    if (gzip) {
      if (typeof DecompressionStream === "undefined")
        throw new Error("This browser cannot inflate dictionary files");
      streamed = streamed.pipeThrough(new DecompressionStream("gzip"));
    }
    const producer = file
      .writeTo(pipe.writable, controller.signal)
      .catch((error) => {
        controller.abort(error);
        throw error;
      });
    const consumer = consumeLookupStream(
      streamed,
      maximum,
      controller.signal,
      consume,
    ).catch((error) => {
      controller.abort(error);
      throw error;
    });
    const [written, read] = await Promise.allSettled([producer, consumer]);
    signal.throwIfAborted();
    if (written.status === "rejected") throw written.reason;
    if (read.status === "rejected") throw read.reason;
    return read.value;
  } finally {
    signal.removeEventListener("abort", relay);
    controller.abort();
  }
}
