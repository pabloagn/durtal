import { z } from "zod";
import { packRecordSchema } from "./pack-store";
import { STARDICT_LIMITS, type StarDictByteSource } from "./stardict";
import { consumePackFile, type PackInputFile } from "./archive";

// lib.dom describes the window API. These are the real worker-only OPFS methods
// from lib.webworker, kept structural to avoid loading both conflicting global libraries.
interface SyncAccess {
  truncate(size: number): void;
  write(bytes: Uint8Array, options: { at: number }): number;
  flush(): void;
  close(): void;
}
type WorkerFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccess>;
};
type IterableDirectory = FileSystemDirectoryHandle & {
  values(): AsyncIterableIterator<FileSystemHandle>;
};

const fileSizes = z
  .object({
    "dict.ifo": z.number().int().min(1).max(STARDICT_LIMITS.headerBytes),
    "dict.idx": z.number().int().min(0).max(STARDICT_LIMITS.indexBytes),
    dictionary: z
      .number()
      .int()
      .min(0)
      .max(Number(STARDICT_LIMITS.dictionaryBytes)),
    "dict.syn": z
      .number()
      .int()
      .min(0)
      .max(STARDICT_LIMITS.indexBytes)
      .nullable(),
    "offsets.bin": z.number().int().min(4).max(STARDICT_LIMITS.validationBytes),
    "syn-offsets.bin": z
      .number()
      .int()
      .min(4)
      .max(STARDICT_LIMITS.validationBytes)
      .nullable(),
  })
  .strict();
export const packManifestSchema = z
  .object({
    v: z.literal(1),
    record: packRecordSchema,
    dictzip: z.boolean(),
    dictionaryBytes: z
      .string()
      .regex(/^\d{1,11}$/)
      .refine((value) => BigInt(value) <= STARDICT_LIMITS.dictionaryBytes),
    files: fileSizes,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.record.hasSyn !== (value.files["dict.syn"] !== null) ||
      value.record.hasSyn !== (value.files["syn-offsets.bin"] !== null) ||
      value.files["offsets.bin"] !== (value.record.wordCount + 1) * 4 ||
      value.record.sizeBytes !==
        Object.values(value.files).reduce<number>(
          (total, size) => total + (size ?? 0),
          0,
        )
    )
      context.addIssue({
        code: "custom",
        message: "The dictionary manifest is inconsistent",
      });
  });
export type PackManifest = z.infer<typeof packManifestSchema>;

export async function packRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isSecureContext || !navigator.storage?.getDirectory)
    throw new Error(
      "Offline dictionaries need Durtal's secure (https) address",
    );
  return (await navigator.storage.getDirectory()).getDirectoryHandle(
    "lookup-packs",
    { create: true },
  );
}

export async function directoryNames(
  directory: FileSystemDirectoryHandle,
): Promise<string[]> {
  const names: string[] = [];
  for await (const handle of (directory as IterableDirectory).values()) {
    if (names.length >= 128)
      throw new Error("There are too many unfinished dictionary folders");
    if (handle.kind === "directory") names.push(handle.name);
  }
  return names;
}

export async function packFile(
  directory: FileSystemDirectoryHandle,
  name: string,
): Promise<File> {
  return (await directory.getFileHandle(name)).getFile();
}

export function fileSource(file: File): StarDictByteSource {
  return {
    size: file.size,
    async read(offset, length, signal) {
      signal?.throwIfAborted();
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > file.size
      )
        throw new Error("The dictionary read is outside its file");
      const bytes = new Uint8Array(
        await file.slice(offset, offset + length).arrayBuffer(),
      );
      signal?.throwIfAborted();
      return bytes;
    },
  };
}

export function fileInput(file: File): PackInputFile {
  return {
    name: file.name,
    size: file.size,
    writeTo: (destination, signal) =>
      file.stream().pipeTo(destination, { signal }),
  };
}

/** The sync handle closes on success, quota failure, CRC error and abort. Only staged files use it. */
export async function writePackFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  file: PackInputFile,
  gzip: boolean,
  maximum: number,
  signal: AbortSignal,
): Promise<number> {
  signal.throwIfAborted();
  const handle = (await directory.getFileHandle(name, {
    create: true,
  })) as WorkerFileHandle;
  if (typeof handle.createSyncAccessHandle !== "function")
    throw new Error("This browser cannot store dictionary files");
  const access = await handle.createSyncAccessHandle();
  let at = 0;
  try {
    access.truncate(0);
    await consumePackFile(file, gzip, maximum, signal, (bytes) => {
      for (let start = 0; start < bytes.length; ) {
        signal.throwIfAborted();
        const written = access.write(
          bytes.subarray(
            start,
            Math.min(start + STARDICT_LIMITS.readBytes, bytes.length),
          ),
          { at },
        );
        if (
          written <= 0 ||
          written > Math.min(STARDICT_LIMITS.readBytes, bytes.length - start)
        )
          throw new Error("The dictionary file could not be written");
        at += written;
        start += written;
      }
    });
    signal.throwIfAborted();
    access.truncate(at);
    access.flush();
    return at;
  } finally {
    access.close();
  }
}

export async function writePackBytes(
  directory: FileSystemDirectoryHandle,
  name: string,
  bytes: Uint8Array,
  signal: AbortSignal,
) {
  await writePackFile(
    directory,
    name,
    {
      name,
      size: bytes.length,
      writeTo: (destination, inputSignal) =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }).pipeTo(destination, { signal: inputSignal }),
    },
    false,
    bytes.length,
    signal,
  );
}

/** Explicit little-endian file layout; no copy of the whole offsets array is made. */
export async function writePackOffsets(
  directory: FileSystemDirectoryHandle,
  name: string,
  offsets: Uint32Array,
  signal: AbortSignal,
) {
  const buffer = new Uint8Array(STARDICT_LIMITS.readBytes),
    view = new DataView(buffer.buffer);
  let at = 0;
  await writePackFile(
    directory,
    name,
    {
      name,
      size: offsets.byteLength,
      writeTo: (destination, inputSignal) =>
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (at >= offsets.length) {
              controller.close();
              return;
            }
            const count = Math.min(buffer.length / 4, offsets.length - at);
            for (let i = 0; i < count; i++)
              view.setUint32(i * 4, offsets[at + i], true);
            at += count;
            // The stream may queue the next window while the current window is being written.
            controller.enqueue(buffer.slice(0, count * 4));
          },
        }).pipeTo(destination, { signal: inputSignal }),
    },
    false,
    offsets.byteLength,
    signal,
  );
}

export async function readPackManifest(
  directory: FileSystemDirectoryHandle,
  signal?: AbortSignal,
): Promise<PackManifest> {
  signal?.throwIfAborted();
  const file = await packFile(directory, "ready.json");
  if (file.size > 16 * 1024)
    throw new Error("The dictionary manifest is too large");
  const manifest = packManifestSchema.parse(JSON.parse(await file.text()));
  signal?.throwIfAborted();
  for (const [name, size] of Object.entries(manifest.files)) {
    signal?.throwIfAborted();
    if (size === null) continue;
    const actualName =
      name === "dictionary"
        ? manifest.dictzip
          ? "dict.dict.dz"
          : "dict.dict"
        : name;
    if ((await packFile(directory, actualName)).size !== size)
      throw new Error("A dictionary file is missing or incomplete");
  }
  return manifest;
}
