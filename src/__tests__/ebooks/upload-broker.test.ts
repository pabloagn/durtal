import { describe, expect, it, vi } from "vitest";
import { UploadBroker } from "@/lib/ebooks/upload/broker";
import type { UploadCoreAdapter } from "@/lib/ebooks/upload/core-contract";
import type { PostgresUploadStore } from "@/lib/ebooks/upload/store";
import type { PrivateUploadSpool } from "@/lib/ebooks/upload/private-spool";
import type { UploadSupervisor } from "@/lib/ebooks/upload/supervisor";
import { UploadIoGate } from "@/lib/ebooks/upload/io-gate";

const id = "11111111-1111-4111-8111-111111111111", key = "22222222-2222-4222-8222-222222222222";
const owner = { volumeId: id, bindingSha256: "a".repeat(64), ownerToken: key, ownerFence: 3, leaseExpiresAt: 9999999999999 };
const fence = { operationId: id, generation: 4, ownerToken: key, ownerFence: 3 };
const sha256 = "b".repeat(64);
function setup() {
  const io = new UploadIoGate(); io.open(fence);
  const supervisor = { io, readiness: vi.fn<UploadSupervisor["readiness"]>(() => ({ state: "ready", owner, checkedAt: 0 })) };
  const core = { createBatch: vi.fn(), readBatch: vi.fn(), readItem: vi.fn(), replayCommand: vi.fn<UploadCoreAdapter["replayCommand"]>(async () => null), command: vi.fn() };
  const store = { transport: vi.fn(), acknowledgePart: vi.fn(), acknowledgeAssembly: vi.fn(), admit: vi.fn(), uploadView: vi.fn() };
  const spool = { verifyRetainedFile: vi.fn(), writeExclusive: vi.fn() };
  const broker = new UploadBroker({ supervisor: supervisor as unknown as UploadSupervisor, core: core as unknown as UploadCoreAdapter,
    store: store as unknown as PostgresUploadStore, spool: spool as unknown as PrivateUploadSpool,
    bindingSha256: owner.bindingSha256, targetFingerprint: "c".repeat(64) });
  return { broker, core, store, spool, supervisor };
}
describe("actual upload transport composition", () => {
  it('delegates user preview after job settlement without imposing a running worker lease', async () => {
    const s = setup(); s.supervisor.readiness.mockImplementation(() => ({ state: 'stopped' }));
    const outcome = { operationId: id, key, status: 200, message: 'Preview', preview: {
      token: sha256, effect: 'Add this format', expiresAt: '2026-10-11T12:00:00Z',
    } };
    s.core.command.mockResolvedValue(outcome);
    expect(await s.broker.command(id, { action: 'prepare', key }, 'ui')).toEqual(outcome);
    expect(s.supervisor.readiness).not.toHaveBeenCalled(); expect(s.store.uploadView).not.toHaveBeenCalled();
    expect(s.core.command).toHaveBeenCalledWith(id, { action: 'prepare', key }, expect.any(Object));
  });
  it("binds a definite stale admission refusal to the original key before allocating any bytes", async () => {
    const s = setup(); s.store.uploadView.mockResolvedValue({ sourceBytes: 3, generation: 5, state: 'receiving' });
    await expect(s.broker.command(id, { action: 'admit', key, generation: 4 }, 'ui')).rejects.toMatchObject({ status: 409,
      refusal: { status: 409, code: 'generation_changed', action: 'admit', key, operationId: id, generation: 4 } });
    expect(s.core.replayCommand).toHaveBeenCalledWith(id, { action: 'admit', key, generation: 4 }, expect.any(Object));
    expect(s.store.admit).not.toHaveBeenCalled(); expect(s.spool.writeExclusive).not.toHaveBeenCalled(); expect(s.core.command).not.toHaveBeenCalled();
  });
  it("replays a durable command before current owner freshness and never performs another effect", async () => {
    const s = setup();
    const receipt = { operationId: id, key, status: 200, message: "Saved", preview: null };
    s.core.replayCommand.mockResolvedValue(receipt);
    s.supervisor.readiness.mockImplementation(() => ({ state: "quiescing" }));
    expect(await s.broker.command(id, { action: "complete", key, generation: 1, sha256 }, "ui")).toEqual(receipt);
    expect(s.supervisor.readiness).not.toHaveBeenCalled(); expect(s.core.command).not.toHaveBeenCalled();
    expect(s.spool.writeExclusive).not.toHaveBeenCalled();
  });
  it("rehashes a settled orphan part after acknowledgement response loss without rewriting bytes", async () => {
    const s = setup();
    s.store.transport.mockResolvedValue({ sourceBytes: 3, input: { name: "book.epub", sha256 }, transport: {
      parts: {}, assembled: null, grants: { "parts/0001": 65536 }, writers: {}, corrupt: false,
    } });
    s.spool.verifyRetainedFile.mockResolvedValue({ bytes: 3, sha256 });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.close(); } });
    expect(await s.broker.part({ id, generation: 4, number: 1, sha256, body })).toEqual({ number: 1, bytes: 3, sha256, generation: 4 });
    expect(s.spool.verifyRetainedFile).toHaveBeenCalledWith(`${id}/parts/0001`, 3, { fence, gate: s.supervisor.io });
    expect(s.store.acknowledgePart).toHaveBeenCalledWith(owner, fence, { number: 1, bytes: 3, sha256 });
    expect(s.spool.writeExclusive).not.toHaveBeenCalled();
  });
  it("holds an orphan grant while the original writer remains unsettled", async () => {
    const s = setup();
    s.store.transport.mockResolvedValue({ sourceBytes: 3, input: {}, transport: {
      parts: {}, assembled: null, grants: { "parts/0001": 65536 }, writers: { "parts/0001": key }, corrupt: false,
    } });
    await expect(s.broker.part({ id, generation: 4, number: 1, sha256, body: new ReadableStream() })).rejects.toMatchObject({ code: "part_pending" });
    expect(s.spool.verifyRetainedFile).not.toHaveBeenCalled(); expect(s.store.acknowledgePart).not.toHaveBeenCalled();
  });
});
