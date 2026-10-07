import { open } from "node:fs/promises";

/*
 * Random access to a file's bytes (SLN-494): a file on disk for the command,
 * bytes in memory for tests, and later an S3 staging object for the browser
 * upload (sub-issue 17). Inspectors read only the ranges they need: a zip by
 * its central directory, a MOBI by its records, a PDF in chunks.
 */

export interface ByteSource {
  /** The file name, for the extension tie-breaks and reports */
  readonly name: string;
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
}

/** A file on disk, read by range */
export async function openFileSource(file: string, name = file.split("/").pop() ?? file): Promise<ByteSource> {
  const handle = await open(file, "r");
  const { size } = await handle.stat();
  return {
    name,
    size,
    async read(offset, length) {
      const want = Math.max(0, Math.min(length, size - offset));
      const buffer = new Uint8Array(want);
      let done = 0;
      while (done < want) {
        const { bytesRead } = await handle.read(buffer, done, want - done, offset + done);
        if (bytesRead === 0) break;
        done += bytesRead;
      }
      return done === want ? buffer : buffer.subarray(0, done);
    },
    close: () => handle.close(),
  };
}

/** Bytes already in memory (tests, small uploads) */
export function bytesSource(bytes: Uint8Array, name: string): ByteSource {
  return {
    name,
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.length, offset + length)),
    close: async () => {},
  };
}
