import { describe, expect, it, vi } from "vitest";
import { UploadDispatcher } from "@/lib/ebooks/upload/dispatcher";
import { decodePublishedInspection } from "@/lib/ebooks/upload/published-inspection";
import { UploadIoGate } from "@/lib/ebooks/upload/io-gate";
import { hashBytes, validationFor } from "@/lib/ebooks/medallion";
import type { UploadSupervisor, UploadJobScope } from "@/lib/ebooks/upload/supervisor";
import type { PostgresUploadStore } from "@/lib/ebooks/upload/store";
import type { PrivateUploadSpool } from "@/lib/ebooks/upload/private-spool";
import type { UploadJobCoreAdapter } from "@/lib/ebooks/upload/job-contract";
import { storeObject } from "@/lib/ebooks/ingest/store";
import type { OperationFence } from "@/lib/ebooks/upload/lifecycle";
import { verifyPublication } from "@/lib/ebooks/publication";

vi.mock("@/lib/ebooks/ingest/store", () => ({ storeObject: vi.fn(async () => ({ adopted: false, multipart: false })) }));
vi.mock("@/lib/ebooks/publication", () => ({ verifyPublication: vi.fn(async () => null) }));
const id = '11111111-1111-4111-8111-111111111111', token = '22222222-2222-4222-8222-222222222222';
const sha256 = 'a'.repeat(64);
const owner = { volumeId: id, bindingSha256: 'b'.repeat(64), ownerToken: token, ownerFence: 3, leaseExpiresAt: 9999999999999 };
const fence = { operationId: id, ownerToken: token, ownerFence: 3, generation: 7 };
const identity = { volumeId: id, bindingSha256: owner.bindingSha256, fence };
function report(downloadable = true) {
  const manifest = Buffer.from(JSON.stringify({ version: 1, format: 'epub', sha256 }));
  const cover = Buffer.from('fixture cover');
  const derived = [{ name: 'manifest.json', size: manifest.length, sha256: hashBytes(manifest), contentType: 'application/json' },
    { name: 'cover-240.webp', size: cover.length, sha256: hashBytes(cover), contentType: 'image/webp' }];
  return { identity, sourceSha256: sha256, prepared: { version: 2, sha256, size: 3, format: 'epub', contentType: 'application/epub+zip',
    validation: validationFor('epub', downloadable ? null : 'Damaged', null, true), drm: null, problem: downloadable ? null : 'Damaged',
    metadata: { title: 'Book' }, details: {}, text: { wordCount: 1, charCount: 3, frontBackWordCount: null, pageEstimate: 1,
      language: 'en', toolVersion: 1, reason: null }, coverReason: null, opfUuid: null, derived },
  derived: derived.map((d, index) => ({ name: d.name, bytes: d.size, sha256: d.sha256, base64: (index ? cover : manifest).toString('base64') })) };
}
function setup(downloadable = true) {
  vi.mocked(storeObject).mockClear(); vi.mocked(verifyPublication).mockClear().mockResolvedValue(null);
  const events: string[] = []; const abort = new AbortController(); const io = new UploadIoGate(); io.open(fence);
  const scope: UploadJobScope = { identity, signal: abort.signal, current: vi.fn(async () => { abort.signal.throwIfAborted(); return owner; }) };
  const core = { assertInspectionCurrent: vi.fn(async () => { events.push('core_current'); }),
    settleInspection: vi.fn(async () => { events.push('core_receipt'); }) };
  const store = { claimNext: vi.fn<(_owner: typeof owner, _token: string) => Promise<OperationFence | null>>(async () => fence), assertOperation: vi.fn(async () => {}),
    transport: vi.fn(async () => ({ sourceBytes: 3, input: { name: 'book.epub', sha256 }, progress: {} as Record<string, unknown>, transport: { assembled: { bytes: 3, sha256 }, corrupt: false } })),
    multipartState: vi.fn(), setMultipartState: vi.fn() };
  const spool = { root: '/private/spool', writeExclusive: vi.fn<PrivateUploadSpool['writeExclusive']>(async () => { events.push('request'); return { bytes: 1, sha256 }; }),
    verifyRetainedFile: vi.fn(async () => ({ bytes: 3, sha256 })) };
  const supervisor = { io, readiness: vi.fn(() => ({ state: 'ready', owner, checkedAt: 1 })),
    runNextJob: vi.fn(async (claim: Parameters<UploadSupervisor['runNextJob']>[0], job: Parameters<UploadSupervisor['runNextJob']>[1]) => {
      if (!await claim(owner)) return;
      await job.prepare(scope); events.push('create_then_exit'); const result = await job.consume(JSON.stringify(report(downloadable)), scope);
      events.push('lease_cleanup'); return result;
    }) };
  const dispatcher = new UploadDispatcher({ supervisor: supervisor as unknown as UploadSupervisor, store: store as unknown as PostgresUploadStore,
    spool: spool as unknown as PrivateUploadSpool, core: core as unknown as UploadJobCoreAdapter,
    context: { channel: 'ui', targetFingerprint: 'c'.repeat(64), bindingSha256: owner.bindingSha256 }, onFailure: vi.fn() });
  return { dispatcher, store, spool, core, supervisor, events, abort };
}
describe('owned inspection publication', () => {
  it('binds the claimed generation request, uses actual stage order and awaits the core receipt', async () => {
    const s = setup(); await s.dispatcher.dispatchOne();
    expect(s.spool.writeExclusive.mock.calls[0][0]).toMatchObject({ fence, relativePath: `${id}/metadata/request-3-7.json` });
    const keys = vi.mocked(storeObject).mock.calls.map(([input]) => input.key);
    expect(keys).toHaveLength(5);
    expect(keys[0]).toMatch(/^bronze\//); expect(keys[1]).toMatch(/^silver\//);
    expect(keys[2]).toMatch(/^gold\//); expect(keys[3]).toContain('cover-240.webp'); expect(keys[4]).toContain('manifest.json');
    const options = vi.mocked(storeObject).mock.calls[0][1];
    expect(options.scope?.signal).toBe(s.abort.signal); expect(options.multipartState).toBeDefined();
    expect(s.core.settleInspection).toHaveBeenCalledWith(expect.objectContaining({ identity, name: 'book.epub' }), expect.any(Object));
    expect(s.events.indexOf('request')).toBeLessThan(s.events.indexOf('create_then_exit'));
    expect(s.events.indexOf('core_receipt')).toBeLessThan(s.events.indexOf('lease_cleanup'));
  });
  it('stores quarantined bronze and silver without any gold publication', async () => {
    const s = setup(false); await s.dispatcher.dispatchOne();
    expect(storeObject).toHaveBeenCalledTimes(2);
    expect(s.core.settleInspection).toHaveBeenCalledWith(expect.objectContaining({ publication: expect.objectContaining({
      medallion: expect.objectContaining({ gold: [] }), derived: [],
    }) }), expect.any(Object));
  });
  it('does not publish or settle an assembled item without a durable accepted completion claim', async () => {
    const s = setup(); s.store.claimNext.mockResolvedValue(null);
    await s.dispatcher.dispatchOne();
    expect(s.spool.writeExclusive).not.toHaveBeenCalled(); expect(storeObject).not.toHaveBeenCalled(); expect(s.core.settleInspection).not.toHaveBeenCalled();
  });
  it('never commits the core receipt when remote publication evidence differs', async () => {
    const s = setup(); vi.mocked(verifyPublication).mockResolvedValue('Publication object differs');
    await expect(s.dispatcher.dispatchOne()).rejects.toThrow('Publication object differs');
    expect(s.core.settleInspection).not.toHaveBeenCalled(); expect(s.events).not.toContain('lease_cleanup');
  });
  it('refuses a changed original before any storage mutation', async () => {
    const s = setup(); s.spool.verifyRetainedFile.mockResolvedValue({ bytes: 3, sha256: 'd'.repeat(64) });
    await expect(s.dispatcher.dispatchOne()).rejects.toThrow('source checksum');
    expect(storeObject).not.toHaveBeenCalled(); expect(s.core.settleInspection).not.toHaveBeenCalled();
  });
  it('refuses evidence that cannot fit the actual durable progress receipt before publishing remote objects', async () => {
    const s = setup(); const retained = await s.store.transport();
    s.store.transport.mockResolvedValue({ ...retained, progress: { retainedEvidence: 'x'.repeat(127 * 1024) } });
    await expect(s.dispatcher.dispatchOne()).rejects.toThrow('byte limit');
    expect(storeObject).not.toHaveBeenCalled(); expect(s.core.settleInspection).not.toHaveBeenCalled();
  });
  it('refuses worker source/generation mismatch, missing artifacts and corrupted base64', () => {
    const expected = { identity, bytes: 3, sha256 };
    for (const mutate of [
      (r: ReturnType<typeof report>) => { r.identity = { ...r.identity, fence: { ...fence, generation: 6 } }; },
      (r: ReturnType<typeof report>) => { r.sourceSha256 = 'd'.repeat(64); },
      (r: ReturnType<typeof report>) => { r.derived.pop(); },
      (r: ReturnType<typeof report>) => { r.derived[0].base64 = '!!!!'; },
      (r: ReturnType<typeof report>) => { r.prepared.validation.downloadable = false; },
    ]) { const altered = report(); mutate(altered); expect(() => decodePublishedInspection(JSON.stringify(altered), expected)).toThrow(); }
  });
});
