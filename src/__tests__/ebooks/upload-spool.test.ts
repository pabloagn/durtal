import { afterEach, describe, expect, it, vi } from "vitest";
import { chown, chmod, link, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrivateUploadSpool, type SpoolAllocationAuthority } from "@/lib/ebooks/upload/private-spool";
import { UploadIoGate } from "@/lib/ebooks/upload/io-gate";
import { GiB } from "@/lib/ebooks/upload/limits";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const fence = { operationId: "22222222-2222-4222-8222-222222222222", ownerToken: "33333333-3333-4333-8333-333333333333", ownerFence: 7, generation: 2 };
const relativePath = `${fence.operationId}/transport/part-1`;
function stream(bytes: Uint8Array) { return new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }); }
async function setup() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "durtal-upload-spool-")));
  roots.push(root); await chown(root, process.getuid!(), process.getgid!()); await chmod(root, 0o700);
  await mkdir(path.join(root, fence.operationId), { mode: 0o700 });
  await mkdir(path.join(root, fence.operationId, "transport"), { mode: 0o700 });
  const spool = await PrivateUploadSpool.open(root);
  vi.spyOn(spool, "availableBytes").mockResolvedValue(100 * GiB);
  const gate = new UploadIoGate(); gate.open(fence);
  const authority: SpoolAllocationAuthority = { beginWriter: vi.fn(async () => {}), endWriter: vi.fn(async () => {}), beforeWrite: vi.fn(async () => {}), assertCurrent: vi.fn(async () => {}) };
  return { root, spool, gate, authority };
}

describe("private bounded spool I/O", () => {
  it("recovers a settled retained-file hash without rewriting and rejects partial lengths", async () => {
    const s = await setup(); const bytes = Buffer.from("durable original");
    await writeFile(path.join(s.root, relativePath), bytes, { mode: 0o600 });
    const receipt = await s.spool.verifyRetainedFile(relativePath, bytes.length, { fence, gate: s.gate });
    expect(receipt).toEqual({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    await expect(s.spool.verifyRetainedFile(relativePath, bytes.length + 1, { fence, gate: s.gate })).rejects.toThrow("exact allocation");
    expect(await readFile(path.join(s.root, relativePath))).toEqual(bytes);
    expect(s.gate.snapshot()).toMatchObject({ activeWriters: 0, streamsClosed: true });
  });
  it("grants and fsyncs fixed private directories, with idempotent completed replay", async () => {
    const s = await setup();
    await s.spool.prepareDirectories({ fence, gate: s.gate, authority: s.authority });
    expect(s.authority.beginWriter).toHaveBeenCalledWith(expect.objectContaining({ relativePath: `${fence.operationId}/metadata/directories`, bytes: 6 * 64 * 1024 }));
    expect(s.authority.beforeWrite).toHaveBeenCalledTimes(5);
    for (const name of ["parts", "assembled", "metadata", "derived", "scratch"]) {
      const stat = await lstat(path.join(s.root, fence.operationId, name));
      expect(stat.isDirectory()).toBe(true); expect(stat.mode & 0o777).toBe(0o700);
    }
    await s.spool.prepareDirectories({ fence, gate: s.gate, authority: s.authority });
    expect(s.authority.beginWriter).toHaveBeenCalledOnce(); expect(s.authority.endWriter).toHaveBeenCalledOnce();
    expect(s.gate.snapshot()).toMatchObject({ activeWriters: 0, pendingIoSettled: true });
  });
  it("retains directory allocation charges when grant settlement is uncertain", async () => {
    const s = await setup(); vi.mocked(s.authority.endWriter).mockRejectedValue(new Error("directory settlement lost"));
    await expect(s.spool.prepareDirectories({ fence, gate: s.gate, authority: s.authority })).rejects.toThrow("settlement lost");
    expect((await lstat(path.join(s.root, fence.operationId, "metadata"))).isDirectory()).toBe(true);
    expect(s.gate.snapshot().accepting).toBe(false);
  });
  it("writes exclusively with allocation grants, durable bytes, exact length and hash", async () => {
    const s = await setup(); const bytes = new TextEncoder().encode("original upload bytes");
    const result = await s.spool.writeExclusive({ fence, relativePath, bytes: bytes.length, stream: stream(bytes), gate: s.gate, authority: s.authority });
    expect(result).toEqual({ bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    expect(await readFile(path.join(s.root, relativePath))).toEqual(Buffer.from(bytes));
    expect((await lstat(path.join(s.root, relativePath))).mode & 0o777).toBe(0o600);
    expect(s.authority.beforeWrite).toHaveBeenCalled();
    const inventory = await s.spool.inventory(); expect(inventory.files[0]).toMatchObject({ relativePath, bytes: bytes.length, sha256: result.sha256 });
    expect(s.gate.snapshot()).toMatchObject({ activeWriters: 0, streamsClosed: true, pendingIoSettled: true });
    await expect(s.spool.writeExclusive({ fence, relativePath, bytes: bytes.length, stream: stream(bytes), gate: s.gate, authority: s.authority })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(path.join(s.root, relativePath))).toEqual(Buffer.from(bytes));
  });
  it("keeps partial bytes charged on truncated, overlong or failed streams", async () => {
    for (const [declared, actual] of [[4, 2], [2, 4]]) {
      const s = await setup();
      await expect(s.spool.writeExclusive({ fence, relativePath, bytes: declared, stream: stream(new Uint8Array(actual)), gate: s.gate, authority: s.authority })).rejects.toThrow("part length");
      expect(await lstat(path.join(s.root, relativePath))).toBeDefined();
      expect(s.authority.beforeWrite).toHaveBeenCalled(); expect(s.gate.snapshot().pendingIoSettled).toBe(true);
    }
  });
  it("quiesces on external disk pressure before creating bytes", async () => {
    const s = await setup(); vi.mocked(s.spool.availableBytes).mockResolvedValue(8 * GiB - 1);
    await expect(s.spool.writeExclusive({ fence, relativePath, bytes: 1, stream: stream(new Uint8Array(1)), gate: s.gate, authority: s.authority })).rejects.toMatchObject({ code: "ENOSPC" });
    await expect(lstat(path.join(s.root, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(s.gate.snapshot().accepting).toBe(false); expect(s.authority.beforeWrite).not.toHaveBeenCalled();
  });
  it("settles cancellation and file handles before advertising writer drain", async () => {
    const s = await setup(); let cancelled = false;
    const pending = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const write = s.spool.writeExclusive({ fence, relativePath, bytes: 1, stream: pending, gate: s.gate, authority: s.authority });
    await vi.waitFor(() => expect(s.authority.beforeWrite).toHaveBeenCalled());
    s.gate.quiesce(new Error("cancelled upload")); await expect(write).rejects.toThrow("cancelled"); await s.gate.drain();
    expect(cancelled).toBe(true); expect(s.gate.snapshot()).toMatchObject({ streamsClosed: true, pendingIoSettled: true });
  });
  it("fails closed on symlinks, hard links, wrong permissions and traversal", async () => {
    const s = await setup(); const target = path.join(s.root, relativePath);
    await writeFile(target, "retained", { mode: 0o600 });
    await link(target, path.join(s.root, "alias")); await expect(s.spool.inventory()).rejects.toThrow("unsafe");
    await rm(path.join(s.root, "alias")); await chmod(target, 0o644); await expect(s.spool.inventory()).rejects.toThrow("unsafe");
    await chmod(target, 0o600); await symlink(target, path.join(s.root, "alias")); await expect(s.spool.inventory()).rejects.toThrow("unsafe");
    await expect(s.spool.writeExclusive({ fence, relativePath: "../escape", bytes: 1, stream: stream(new Uint8Array(1)), gate: s.gate, authority: s.authority })).rejects.toThrow("path");
  });
  it("removes only verified operation scratch and retains original transport", async () => {
    const s = await setup(); await writeFile(path.join(s.root, relativePath), "original", { mode: 0o600 });
    const scratch = path.join(s.root, fence.operationId, "scratch"); await mkdir(scratch, { mode: 0o700 });
    await writeFile(path.join(scratch, "temporary"), "scratch", { mode: 0o600 }); await s.spool.removeScratch(fence.operationId);
    await expect(lstat(scratch)).rejects.toMatchObject({ code: "ENOENT" }); expect(await readFile(path.join(s.root, relativePath), "utf8")).toBe("original");
    await s.spool.removeScratch(fence.operationId); // crash/retry is idempotent
    await s.spool.removeScratch("55555555-5555-4555-8555-555555555555"); // queued metadata has no spool yet
  });
  it("does not follow or remove an unsafe scratch tree", async () => {
    const s = await setup(); const scratch = path.join(s.root, fence.operationId, "scratch");
    await symlink(path.join(s.root, fence.operationId, "transport"), scratch);
    await expect(s.spool.removeScratch(fence.operationId)).rejects.toThrow("unsafe"); expect((await lstat(scratch)).isSymbolicLink()).toBe(true);
  });
  it("assembles verified parts by streaming and rejects changed original bytes", async () => {
    for (const damaged of [false, true]) {
      const s = await setup();
      await mkdir(path.join(s.root, fence.operationId, "parts"), { mode: 0o700 });
      await mkdir(path.join(s.root, fence.operationId, "assembled"), { mode: 0o700 });
      const original = Buffer.from("verified original"); const sha256 = createHash("sha256").update(original).digest("hex");
      await writeFile(path.join(s.root, fence.operationId, "parts", "0001"), damaged ? Buffer.from("tampered original") : original, { mode: 0o600 });
      const pending = s.spool.assemble({ fence, expectedSha256: sha256, parts: { generation: fence.generation, sourceBytes: original.length,
        receipts: [{ number: 1, bytes: original.length, sha256 }] }, gate: s.gate, authority: s.authority });
      if (damaged) await expect(pending).rejects.toThrow("checksum");
      else {
        expect(await pending).toEqual({ bytes: original.length, sha256 });
        expect(await readFile(path.join(s.root, fence.operationId, "assembled", "source"))).toEqual(original);
      }
      expect(s.authority.endWriter).toHaveBeenCalledOnce(); expect(s.gate.snapshot().streamsClosed).toBe(true);
    }
  });
  it("keeps a lost grant response charged and refuses stream closure without cancellation proof", async () => {
    const s = await setup(); vi.mocked(s.authority.beginWriter).mockRejectedValue(new Error("grant response lost"));
    await expect(s.spool.writeExclusive({ fence, relativePath, bytes: 1, stream: stream(new Uint8Array(1)), gate: s.gate, authority: s.authority })).rejects.toThrow("response lost");
    expect(s.authority.endWriter).not.toHaveBeenCalled(); expect(s.gate.snapshot().accepting).toBe(false);
    const held = await setup();
    const source = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(2)); }, cancel() { throw new Error("source closure unproved"); } });
    await expect(held.spool.writeExclusive({ fence, relativePath, bytes: 1, stream: source, gate: held.gate, authority: held.authority })).rejects.toThrow("closure unproved");
    expect(held.authority.endWriter).not.toHaveBeenCalled(); expect(held.gate.snapshot()).toMatchObject({ accepting: false, streamsClosed: false });
  });
});
