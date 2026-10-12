import { constants } from "node:fs";
import { lstat, open, mkdir, type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { checkedInteger, UPLOAD_LIMITS } from "./limits";
import { INSPECTOR_PROTOCOL } from "./runtime-contract";
import { InspectorAttemptBudget, readInspectorCgroup } from "./inspector-resources";
import { inspectorPdfPhaseFrame, inspectorReadyFrame, inspectorReportFrame } from "./inspector-protocol";
import { boundedJsonBytes } from "./bounded-json";
import { withInspectionBudget } from "../ingest/budget";
import { installPdfBudgetHooks } from "../ingest/pdf-budget";
import { prepareFile, sniffSource, derivedCachePath } from "../ingest/prepare";
import type { ByteSource } from "../ingest/source";
import { decodeInspectorRequest, INSPECTOR_REQUEST_BYTES, type InspectorWorkerRequest } from "./worker-request";

const CHUNK = 64 * 1024;
const CACHE = "/scratch/cache";

async function privateFile(at: string, maximum: number): Promise<FileHandle> {
  const before = await lstat(at);
  if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || before.gid !== process.getgid?.()
    || (before.mode & 0o777) !== 0o600) throw new Error("Inspector input is not an owned private regular file");
  checkedInteger(before.size, "inspector input bytes", 1, maximum);
  const file = await open(at, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat();
    if (opened.ino !== before.ino || opened.size !== before.size || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs)
      throw new Error("Inspector input changed during open");
    return file;
  } catch (error) { await file.close(); throw error; }
}

let outputBytes = 0;
async function writeFrame(frame: string): Promise<void> {
  outputBytes = checkedInteger(outputBytes + Buffer.byteLength(frame), "complete inspector wire output", 0, UPLOAD_LIMITS.reportBytes);
  await new Promise<void>((resolve, reject) => { process.stdout.write(frame, (error) => error ? reject(error) : resolve()); });
}

/** Explicit isolated entrypoint; imported by its bootstrap, never autostarts in Next.js. */
export async function runInspectorWorker(): Promise<void> {
  if (outputBytes) throw new Error("Inspector process cannot run another attempt");
  if (process.platform !== "linux" || process.execArgv.length !== 1 || process.execArgv[0] !== "--max-old-space-size=256")
    throw new Error("Inspector heap/platform configuration differs");
  const allowed = new Set(["PATH", "NODE_VERSION", "YARN_VERSION", "NODE_ENV", "TMPDIR", "HOME", "HOSTNAME", "UV_THREADPOOL_SIZE", "MALLOC_ARENA_MAX"]);
  if (Object.keys(process.env).some((key) => !allowed.has(key))) throw new Error("Inspector inherited unexpected environment");
  if (process.env.HOSTNAME !== "ebook-inspector") throw new Error("Inspector hostname configuration differs");
  const cgroup = await readInspectorCgroup();
  await writeFrame(inspectorReadyFrame(cgroup)); // real OS limits precede all untrusted parsing
  const frameWrites: Promise<void>[] = [];
  const budget = new InspectorAttemptBudget((phase) => { frameWrites.push(writeFrame(inspectorPdfPhaseFrame(phase))); });
  const report = await withInspectionBudget(budget, async () => {
    const metadata = await privateFile("/input/request.json", INSPECTOR_REQUEST_BYTES);
    let input: InspectorWorkerRequest;
    try {
      const size = (await metadata.stat()).size;
      budget.retainTextPermanent(size * 3);
      const bytes = Buffer.alloc(size); let read = 0;
      while (read < size) {
        const result = await metadata.read(bytes, read, size - read, read);
        if (!result.bytesRead) throw new Error("Inspector request truncated"); read += result.bytesRead;
      }
      input = decodeInspectorRequest(bytes);
    } finally { await metadata.close(); }
    const file = await privateFile("/input/source", UPLOAD_LIMITS.sourceBytes);
    try {
      const before = await file.stat();
      if (before.size !== input.bytes) throw new Error("Inspector source length differs");
      const hash = createHash("sha256"); const block = Buffer.alloc(CHUNK);
      for (let at = 0; at < before.size;) {
        budget.assertHealthy(); const { bytesRead } = await file.read(block, 0, Math.min(CHUNK, before.size - at), at);
        if (!bytesRead) throw new Error("Inspector source truncated while hashing"); hash.update(block.subarray(0, bytesRead)); at += bytesRead;
      }
      if (hash.digest("hex") !== input.sha256) throw new Error("Inspector source checksum differs");
      const source: ByteSource = { name: input.name, size: input.bytes,
        async read(offset, length) {
          budget.assertHealthy(); checkedInteger(offset, "source read offset", 0, input.bytes);
          checkedInteger(length, "source read range", 0, UPLOAD_LIMITS.entryDecodedBytes);
          const want = Math.min(length, input.bytes - offset); const bytes = new Uint8Array(want); let read = 0;
          while (read < want) { const result = await file.read(bytes, read, want - read, offset + read); if (!result.bytesRead) throw new Error("Inspector source range truncated"); read += result.bytesRead; }
          return bytes;
        }, close: async () => {}, // owned file finally below includes the report's lifetime
      };
      await installPdfBudgetHooks();
      const sniffed = await sniffSource(source); budget.assertHealthy();
      if (sniffed.kind !== "ebook") throw new Error("Inspector input is not a recognized e-book");
      await mkdir(CACHE, { mode: 0o700 });
      const prepared = await prepareFile(source, input.sha256, sniffed.format, CACHE); budget.assertHealthy();
      const derived: { name: string; bytes: number; sha256: string; base64: string }[] = [];
      let encodedBytes = 0;
      for (const object of prepared.derived) {
        if (!["manifest.json", "cover-240.webp", "cover-400.webp", "cover-800.webp"].includes(object.name)) throw new Error("Inspector derived filename differs");
        checkedInteger(object.size, "derived report object", 1, UPLOAD_LIMITS.reportBytes);
        encodedBytes += Math.ceil(object.size / 3) * 4;
        checkedInteger(encodedBytes, "derived report encoding", 0, UPLOAD_LIMITS.reportBytes);
        budget.retainTextPermanent(Math.ceil(object.size / 3) * 4);
        const artifact = await privateFile(derivedCachePath(CACHE, input.sha256, object.name), UPLOAD_LIMITS.reportBytes);
        try {
          if ((await artifact.stat()).size !== object.size) throw new Error("Inspector derived length differs");
          const bytes = await artifact.readFile();
          if (createHash("sha256").update(bytes).digest("hex") !== object.sha256) throw new Error("Inspector derived checksum differs");
          derived.push({ name: object.name, bytes: object.size, sha256: object.sha256, base64: bytes.toString("base64") });
        } finally { await artifact.close(); }
      }
      const after = await file.stat();
      if (after.ino !== before.ino || after.size !== before.size || after.blocks !== before.blocks || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
        throw new Error("Inspector source changed during parsing");
      return { identity: input.identity, sourceSha256: input.sha256, prepared, derived };
    } finally { await file.close(); }
  });
  await Promise.all(frameWrites);
  budget.assertHealthy();
  // Include framing in the byte limit, before JSON serialization allocates.
  const size = boundedJsonBytes({ protocol: INSPECTOR_PROTOCOL, kind: "report", payload: report }, UPLOAD_LIMITS.reportBytes - outputBytes - 1);
  budget.retainTextPermanent(size * 3); await writeFrame(inspectorReportFrame(report));
}
