import { constants, type Stats } from "node:fs";
import { lstat, open, opendir, realpath, statfs, unlink, rmdir, mkdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { checkedInteger, checkedSum, UPLOAD_LIMITS } from "./limits";
import { diskPressure, type OperationFence } from "./lifecycle";
import { requirePrivateAbsolutePath, requireUuid, requireSha256 } from "./runtime-contract";
import { expectedPartBytes, requireCompleteParts, type PartMap } from "./parts";
import { UploadIoGate } from "./io-gate";

const MAX_SPOOL_ENTRIES = 32_768;
const READ_CHUNK = 64 * 1024;
type FileStat = Stats;

export interface SpoolFile {
  relativePath: string;
  bytes: number;
  allocatedBytes: number;
  sha256: string;
}

export interface SpoolInventory {
  files: SpoolFile[];
  allocatedBytes: number;
  availableBytes: number;
  allocationUnitBytes: number;
  sha256: string;
}

/** Persistence must CAS a reserved grant before each write; no shadow journal. */
export interface SpoolAllocationAuthority {
  beginWriter(input: { fence: OperationFence; relativePath: string; bytes: number; availableBytes: number }): Promise<void>;
  /** CAS a cumulative path grant; identical response-loss retries cannot charge twice. */
  beforeWrite(input: { fence: OperationFence; relativePath: string; allocatedGrowthBytes: number; cumulativeAllocatedBytes: number; availableBytes: number }): Promise<void>;
  assertCurrent(fence: OperationFence): Promise<void>;
  /** The caller has already settled cancellation and closed its file handle. */
  endWriter(fence: OperationFence, relativePath: string): Promise<void>;
}

/** Only the supervisor owns/writes this tree. The app receives no filesystem path. */
export class PrivateUploadSpool {
  private constructor(readonly root: string, private readonly device: number, private readonly uid: number, private readonly gid: number) {}

  static async open(root: string): Promise<PrivateUploadSpool> {
    requirePrivateAbsolutePath(root);
    if (await realpath(root) !== root) throw new Error("Spool root contains a symlink");
    const stat = await lstat(root);
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined || !stat.isDirectory() || stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o777) !== 0o700)
      throw new Error("Spool root must be a private directory owned by the supervisor");
    return new PrivateUploadSpool(root, stat.dev, uid, gid);
  }

  private resolve(relative: string): string {
    if (!relative || relative.length > 512 || relative.split("/").some((part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,127}$/.test(part)))
      throw new Error("Invalid spool path");
    return path.join(this.root, relative);
  }

  private verify(stat: FileStat): void {
    if (stat.dev !== this.device || stat.uid !== this.uid || stat.gid !== this.gid || stat.isSymbolicLink()
      || (!stat.isFile() && !stat.isDirectory()) || (stat.mode & 0o777) !== (stat.isDirectory() ? 0o700 : 0o600)
      || (stat.isFile() && stat.nlink !== 1)) throw new Error("Spool contains an unsafe filesystem entry");
  }

  private async parents(relative: string): Promise<void> {
    this.verify(await lstat(this.root));
    let current = this.root;
    for (const part of relative.split("/").slice(0, -1)) {
      current = path.join(current, part);
      const stat = await lstat(current);
      this.verify(stat);
      if (!stat.isDirectory()) throw new Error("Spool parent is not a directory");
    }
  }

  async availableBytes(): Promise<number> {
    const stat = await statfs(this.root);
    checkedInteger(stat.bsize, "spool allocation unit", 1, UPLOAD_LIMITS.allocationUnitBytes);
    return checkedInteger(stat.bavail * stat.bsize, "spool free bytes");
  }

  /** Recover a lost acknowledgement only from an exact settled private file.
   * No allocation/refund, and no whole-file buffer even for assembled sources.
   */
  async verifyRetainedFile(relativePath: string, bytes: number, input: { fence: OperationFence; gate: UploadIoGate }): Promise<{ bytes: number; sha256: string }> {
    checkedInteger(bytes, "retained file bytes", 1, UPLOAD_LIMITS.sourceBytes);
    if (!relativePath.startsWith(`${input.fence.operationId}/`)) throw new Error("Retained file belongs to another operation");
    return input.gate.writer(input.fence, async (signal, stream) => {
      await this.parents(relativePath); const at = this.resolve(relativePath); const before = await lstat(at);
      this.verify(before);
      const envelope = Math.ceil(bytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes;
      if (!before.isFile() || before.size !== bytes || before.blocks * 512 > envelope) throw new Error("Retained file differs from its exact allocation envelope");
      const file = await open(at, constants.O_RDONLY | constants.O_NOFOLLOW); const closed = stream();
      try {
        const opened = await file.stat(); this.verify(opened);
        if (opened.ino !== before.ino || opened.size !== before.size || opened.blocks !== before.blocks
          || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) throw new Error("Retained file changed during open");
        const buffer = Buffer.alloc(READ_CHUNK); const hash = createHash("sha256");
        for (let offset = 0; offset < bytes;) {
          signal.throwIfAborted(); const result = await file.read(buffer, 0, Math.min(buffer.length, bytes - offset), offset);
          if (!result.bytesRead) throw new Error("Retained file truncated");
          hash.update(buffer.subarray(0, result.bytesRead)); offset += result.bytesRead;
        }
        const after = await file.stat(); this.verify(after);
        if (after.ino !== before.ino || after.size !== before.size || after.blocks !== before.blocks
          || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("Retained file changed during hashing");
        return { bytes, sha256: hash.digest("hex") };
      } finally { await file.close(); closed(); }
    });
  }

  /** An admitted item creates only fixed private directories, after a metadata grant. */
  async prepareDirectories(input: { fence: OperationFence; gate: UploadIoGate; authority: SpoolAllocationAuthority }): Promise<void> {
    requireUuid(input.fence.operationId);
    const relativePath = `${input.fence.operationId}/metadata/directories`;
    const directories = [input.fence.operationId, ...["parts", "assembled", "metadata", "derived", "scratch"].map((name) => `${input.fence.operationId}/${name}`)];
    await input.gate.writer(input.fence, async (signal) => {
      await this.parents(input.fence.operationId);
      await input.authority.assertCurrent(input.fence);
      let missing = false;
      for (const relative of directories) {
        try { const stat = await lstat(this.resolve(relative)); this.verify(stat); if (!stat.isDirectory()) throw new Error("Spool directory path is not a directory"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; missing = true; }
      }
      if (!missing) return;
      let granted = false; let charged = 0;
      try {
        const availableBytes = await this.availableBytes();
        if (diskPressure(undefined, availableBytes)) throw Object.assign(new Error("Upload disk reserve exhausted"), { code: "ENOSPC" });
        await input.authority.beginWriter({ fence: input.fence, relativePath, bytes: directories.length * UPLOAD_LIMITS.allocationUnitBytes, availableBytes });
        granted = true;
        for (const relative of directories) {
          signal.throwIfAborted(); await this.parents(relative);
          try { const existing = await lstat(this.resolve(relative)); this.verify(existing); if (!existing.isDirectory()) throw new Error("Spool directory path is not a directory"); continue; }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
          const availableBytes = await this.availableBytes();
          await input.authority.beforeWrite({ fence: input.fence, relativePath, allocatedGrowthBytes: UPLOAD_LIMITS.allocationUnitBytes,
            cumulativeAllocatedBytes: charged + UPLOAD_LIMITS.allocationUnitBytes, availableBytes });
          signal.throwIfAborted(); await mkdir(this.resolve(relative), { mode: 0o700 }); charged += UPLOAD_LIMITS.allocationUnitBytes;
          const actual = await lstat(this.resolve(relative)); this.verify(actual);
          if (actual.blocks * 512 > UPLOAD_LIMITS.allocationUnitBytes) throw new Error("Spool directory exceeds its allocation grant");
          await this.syncDirectory(path.dirname(this.resolve(relative))); await this.syncDirectory(this.resolve(relative));
        }
        await input.authority.assertCurrent(input.fence);
      } catch (error) { input.gate.quiesce(error); throw error; }
      finally {
        if (granted) try { await input.authority.endWriter(input.fence, relativePath); }
        catch (error) { input.gate.quiesce(error); throw error; }
      }
    });
  }

  /** Call under the allocation barrier after inspector exit and all streams settle. */
  async inventory(signal?: AbortSignal): Promise<SpoolInventory> {
    const files: SpoolFile[] = [];
    let entries = 0;
    let allocatedBytes = 0;
    const walk = async (relative: string): Promise<void> => {
      signal?.throwIfAborted();
      if (++entries > MAX_SPOOL_ENTRIES) throw new Error("Spool inventory entry limit exceeded");
      const at = relative ? this.resolve(relative) : this.root;
      const stat = await lstat(at);
      this.verify(stat);
      const allocated = checkedInteger(stat.blocks * 512, "allocated spool blocks");
      allocatedBytes = checkedSum([allocatedBytes, allocated], "spool allocation");
      if (allocatedBytes > UPLOAD_LIMITS.spoolQuotaBytes) throw new Error("Spool allocation exceeds quota");
      if (stat.isDirectory()) {
        const directory = await opendir(at);
        for await (const entry of directory) await walk(relative ? `${relative}/${entry.name}` : entry.name);
      } else {
        checkedInteger(stat.size, "spool file size", 0, UPLOAD_LIMITS.sourceBytes);
        const file = await open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const opened = await file.stat();
          this.verify(opened);
          if (opened.ino !== stat.ino || opened.size !== stat.size || opened.blocks !== stat.blocks
            || opened.mtimeMs !== stat.mtimeMs || opened.ctimeMs !== stat.ctimeMs) throw new Error("Spool changed during inventory");
          const hash = createHash("sha256");
          const buffer = Buffer.alloc(READ_CHUNK);
          let offset = 0;
          while (offset < stat.size) {
            signal?.throwIfAborted();
            const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
            if (!bytesRead) throw new Error("Spool file truncated during inventory");
            hash.update(buffer.subarray(0, bytesRead));
            offset += bytesRead;
          }
          const after = await file.stat();
          if (after.ino !== opened.ino || after.size !== opened.size || after.blocks !== opened.blocks || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs)
            throw new Error("Spool changed during inventory");
          files.push({ relativePath: relative, bytes: stat.size, allocatedBytes: allocated, sha256: hash.digest("hex") });
        } finally { await file.close(); }
      }
    };
    await walk("");
    files.sort((a, b) => a.relativePath < b.relativePath ? -1 : a.relativePath > b.relativePath ? 1 : 0);
    const fs = await statfs(this.root);
    checkedInteger(fs.bsize, "spool allocation unit", 1, UPLOAD_LIMITS.allocationUnitBytes);
    return { files, allocatedBytes, availableBytes: checkedInteger(fs.bavail * fs.bsize, "spool free bytes"), allocationUnitBytes: fs.bsize,
      sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
  }

  /** Exclusive create: retained parts/source/cache are never overwritten. */
  async writeExclusive(input: {
    fence: OperationFence; relativePath: string; bytes: number; stream: ReadableStream<Uint8Array>;
    gate: UploadIoGate; authority: SpoolAllocationAuthority; expectedSha256?: string;
  }): Promise<{ bytes: number; sha256: string }> {
    // Only the deterministic assembled-source destination admits a 4 GiB stream.
    const assembled = input.relativePath === `${input.fence.operationId}/assembled/source`;
    checkedInteger(input.bytes, "bounded spool write", 1, assembled ? UPLOAD_LIMITS.sourceBytes : UPLOAD_LIMITS.partBytes);
    if (input.expectedSha256 !== undefined) requireSha256(input.expectedSha256);
    const at = this.resolve(input.relativePath);
    return input.gate.writer(input.fence, async (signal, trackStream) => {
      let file: FileHandle | undefined;
      let writerGranted = false;
      const reader = input.stream.getReader();
      const streamClosed = trackStream();
      let cancellation: Promise<void> | undefined;
      const abort = () => {
        cancellation ??= reader.cancel(signal.reason);
        void cancellation.catch(() => {}); // observed below before advertising closure
      };
      signal.addEventListener("abort", abort, { once: true });
      const hash = createHash("sha256");
      let written = 0;
      let charged = 0;
      try {
        await this.parents(input.relativePath);
        await input.authority.assertCurrent(input.fence);
        signal.throwIfAborted();
        const availableBytes = await this.availableBytes();
        if (diskPressure(undefined, availableBytes)) throw Object.assign(new Error("Upload disk reserve exhausted"), { code: "ENOSPC" });
        try {
          await input.authority.beginWriter({ fence: input.fence, relativePath: input.relativePath, bytes: input.bytes, availableBytes });
          writerGranted = true;
        } catch (error) {
          input.gate.quiesce(error); // a lost grant response may have committed
          throw error;
        }
        // Charge the first allocation block before creating even an empty entry.
        await input.authority.beforeWrite({ fence: input.fence, relativePath: input.relativePath,
          allocatedGrowthBytes: UPLOAD_LIMITS.allocationUnitBytes, cumulativeAllocatedBytes: UPLOAD_LIMITS.allocationUnitBytes, availableBytes });
        charged = UPLOAD_LIMITS.allocationUnitBytes;
        signal.throwIfAborted();
        file = await open(at, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        while (true) {
          signal.throwIfAborted();
          const chunk = await reader.read();
          signal.throwIfAborted();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > UPLOAD_LIMITS.partBytes || written + chunk.value.byteLength > input.bytes)
            throw new Error("Upload stream exceeds its declared part length");
          for (let offset = 0; offset < chunk.value.byteLength; offset += READ_CHUNK) {
            signal.throwIfAborted();
            const block = chunk.value.subarray(offset, offset + READ_CHUNK);
            const next = Math.ceil((written + block.length) / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes;
            const availableBytes = await this.availableBytes();
            if (diskPressure(undefined, availableBytes)) throw Object.assign(new Error("Upload disk reserve exhausted"), { code: "ENOSPC" });
            await input.authority.beforeWrite({ fence: input.fence, relativePath: input.relativePath, allocatedGrowthBytes: next - charged, cumulativeAllocatedBytes: next, availableBytes });
            signal.throwIfAborted();
            let offsetInBlock = 0;
            while (offsetInBlock < block.length) {
              signal.throwIfAborted();
              const result = await file.write(block, offsetInBlock, block.length - offsetInBlock, written + offsetInBlock);
              if (!result.bytesWritten) throw new Error("Spool write made no progress");
              offsetInBlock += result.bytesWritten;
            }
            written += block.length;
            charged = next;
            hash.update(block);
          }
        }
        if (written !== input.bytes) throw new Error("Upload stream ended before its declared part length");
        const sha256 = hash.digest("hex");
        if (input.expectedSha256 !== undefined && sha256 !== input.expectedSha256) throw new Error("Upload source checksum differs");
        await file.sync();
        const durable = await file.stat();
        this.verify(durable);
        if (durable.size !== written || checkedInteger(durable.blocks * 512, "durable file allocation") > charged)
          throw new Error("Actual durable allocation exceeds its file grant");
        await input.authority.assertCurrent(input.fence);
        signal.throwIfAborted();
        await this.syncDirectory(path.dirname(at));
        return { bytes: written, sha256 };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOSPC" || code === "EDQUOT") input.gate.quiesce(error);
        // Leave partial bytes charged for crash recovery; never refund on exception.
        throw error;
      } finally {
        let settlementFailure: unknown;
        try { await reader.cancel(); } catch (error) { settlementFailure = error; }
        try { await cancellation; } catch (error) { settlementFailure ??= error; }
        reader.releaseLock();
        signal.removeEventListener("abort", abort);
        try { await file?.close(); } catch (error) { settlementFailure ??= error; }
        if (settlementFailure) throw settlementFailure; // gate retains missing closure evidence
        streamClosed();
        if (writerGranted) {
          try { await input.authority.endWriter(input.fence, input.relativePath); }
          catch (error) { input.gate.quiesce(error); throw error; }
        }
      }
    });
  }

  /** Stream every durable receipt in order; never concatenate a source in RAM. */
  async assemble(input: { fence: OperationFence; parts: PartMap; expectedSha256: string; gate: UploadIoGate; authority: SpoolAllocationAuthority }): Promise<{ bytes: number; sha256: string }> {
    requireUuid(input.fence.operationId); requireSha256(input.expectedSha256);
    requireCompleteParts(input.parts, input.fence.generation);
    const receipts = [...input.parts.receipts].sort((a, b) => a.number - b.number);
    let index = 0; let offset = 0;
    let handle: FileHandle | undefined;
    let opened: FileStat | undefined;
    let hash = createHash("sha256");
    let canceled = false;
    let pendingRead: Promise<void> | undefined;
    const close = async () => { const current = handle; handle = undefined; await current?.close(); };
    const source = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pendingRead = (async () => { try {
          if (canceled) return;
          const receipt = receipts[index];
          if (!receipt) { await close(); controller.close(); return; }
          if (!handle) {
            const relative = `${input.fence.operationId}/parts/${String(receipt.number).padStart(4, "0")}`;
            await this.parents(relative);
            const before = await lstat(this.resolve(relative)); this.verify(before);
            if (!before.isFile() || before.size !== expectedPartBytes(input.parts.sourceBytes, receipt.number)) throw new Error("Retained part length differs");
            handle = await open(this.resolve(relative), constants.O_RDONLY | constants.O_NOFOLLOW);
            opened = await handle.stat(); this.verify(opened);
            if (opened.ino !== before.ino || opened.size !== before.size || opened.ctimeMs !== before.ctimeMs) throw new Error("Retained part changed while opening");
            offset = 0; hash = createHash("sha256");
          }
          if (canceled) { await close(); return; }
          const buffer = Buffer.alloc(Math.min(READ_CHUNK, receipt.bytes - offset));
          const read = await handle.read(buffer, 0, buffer.length, offset);
          if (canceled) { await close(); return; }
          if (!read.bytesRead) throw new Error("Retained part truncated while assembling");
          offset += read.bytesRead; const chunk = buffer.subarray(0, read.bytesRead); hash.update(chunk);
          if (offset === receipt.bytes) {
            const after = await handle.stat();
            if (!opened || after.ino !== opened.ino || after.size !== opened.size || after.blocks !== opened.blocks
              || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || hash.digest("hex") !== receipt.sha256) throw new Error("Retained part checksum differs");
            await close(); index++;
          }
          controller.enqueue(chunk);
        } catch (error) { await close(); if (!canceled) controller.error(error); } })();
        return pendingRead;
      },
      cancel: async () => { canceled = true; await pendingRead; await close(); },
    }, { highWaterMark: 0 });
    return this.writeExclusive({ fence: input.fence, relativePath: `${input.fence.operationId}/assembled/source`, bytes: input.parts.sourceBytes,
      expectedSha256: input.expectedSha256, stream: source, gate: input.gate, authority: input.authority });
  }

  /** Only after exit/stream proof, and only scratch belonging to this operation. */
  async removeScratch(operationId: string, signal?: AbortSignal): Promise<void> {
    requireUuid(operationId);
    const relative = `${operationId}/scratch`;
    try { this.verify(await lstat(path.join(this.root, operationId))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    await this.parents(relative);
    let count = 0;
    const remove = async (relative: string): Promise<void> => {
      signal?.throwIfAborted();
      if (++count > MAX_SPOOL_ENTRIES) throw new Error("Scratch cleanup entry limit exceeded");
      const at = this.resolve(relative);
      let stat: FileStat;
      try { stat = await lstat(at); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      this.verify(stat);
      if (stat.isDirectory()) {
        const directory = await opendir(at);
        for await (const entry of directory) await remove(`${relative}/${entry.name}`);
        await rmdir(at);
      } else await unlink(at);
    };
    await remove(relative);
    await this.syncDirectory(path.join(this.root, operationId));
  }

  private async syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { await handle.sync(); } finally { await handle.close(); }
  }
}
