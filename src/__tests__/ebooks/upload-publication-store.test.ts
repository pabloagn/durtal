import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { storeObject, withRetries, type UploadState } from '@/lib/ebooks/ingest/store';
import { hashBytes } from '@/lib/ebooks/medallion';

const calls = vi.hoisted(() => ({ send: vi.fn(), head: vi.fn(), matches: vi.fn() }));
vi.mock('@/lib/s3/preview-dir', () => ({ previewS3Dir: () => null }));
vi.mock('@/lib/ebooks/storage', () => ({
  ebookS3: () => ({ send: calls.send }), ebookStorage: () => ({ bucket: 'fixture-bucket', region: 'fixture-region' }),
  ebookCredentialIdentity: () => 'fixture-identity', ebookOwner: () => ({}), ebookObjectHeaders: () => ({}),
  headEbookObject: calls.head, objectMatches: calls.matches, previewFile: () => { throw new Error('No preview writes'); },
  statusOf: (error: { $metadata?: { httpStatusCode?: number } }) => error?.$metadata?.httpStatusCode,
  checkEbookStorageScope: async (scope?: { signal: AbortSignal; current(): Promise<void> }) => {
    scope?.signal.throwIfAborted(); await scope?.current(); scope?.signal.throwIfAborted();
  },
}));
const bytes = Buffer.from('abc'), sha256 = hashBytes(bytes);
const input = { key: `bronze/ebooks/epub/aa/${sha256}/source.epub`, sha256, size: bytes.length, contentType: 'application/epub+zip', body: { bytes } };
function options() {
  const abort = new AbortController(); const current = vi.fn(async () => {});
  const multipartState = { read: vi.fn<(_key: string) => Promise<UploadState | null>>(async () => null),
    write: vi.fn(async (_key: string, _state: UploadState) => {}), remove: vi.fn(async (_key: string) => {}) };
  return { abort, current, multipartState, value: { cacheDir: '/must-not-create-any-local-cache', singlePutMax: 1, partSize: 5 * 1024 * 1024,
    scope: { signal: abort.signal, current }, multipartState } };
}
beforeEach(() => {
  calls.send.mockReset(); calls.head.mockReset(); calls.matches.mockReset();
  calls.head.mockResolvedValueOnce(null).mockResolvedValue({ size: bytes.length, sha256, checksumType: 'full' });
  calls.send.mockImplementation(async (command: unknown) => {
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'owned-multipart' };
    if (command instanceof UploadPartCommand) return { ETag: 'verified-part', ChecksumSHA256: command.input.ChecksumSHA256 };
    return {};
  });
});
describe('actual stage publisher under an owned job scope', () => {
  it('uses injected durable multipart custody and sends the same cancellation signal on each storage call', async () => {
    const o = options(); await storeObject(input, o.value);
    expect(o.multipartState.write).toHaveBeenCalledWith(input.key, expect.objectContaining({ uploadId: 'owned-multipart', key: input.key }));
    expect(o.multipartState.remove).toHaveBeenCalledWith(input.key);
    expect(calls.send.mock.calls.map(([command]) => command.constructor)).toEqual([
      CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
    ]);
    expect(calls.send.mock.calls.every((call) => call[1].abortSignal === o.abort.signal)).toBe(true);
  });
  it('retains saved multipart custody when cancellation arrives after state persistence', async () => {
    const o = options(); o.multipartState.write.mockImplementation(async () => { o.abort.abort(new Error('Canceled')); });
    await expect(storeObject(input, o.value)).rejects.toThrow('Canceled');
    expect(calls.send).toHaveBeenCalledTimes(1); expect(o.multipartState.remove).not.toHaveBeenCalled();
  });
  it('does not send parts when the durable multipart state write is uncertain', async () => {
    const o = options(); o.multipartState.write.mockRejectedValue(new Error('state response lost'));
    await expect(storeObject(input, o.value)).rejects.toThrow('state response lost');
    expect(calls.send).toHaveBeenCalledTimes(1); expect(o.multipartState.remove).not.toHaveBeenCalled();
  });
  it('refuses an existing multipart state from a different storage binding without discarding it', async () => {
    const o = options(); o.multipartState.read.mockResolvedValue({ key: input.key, uploadId: 'prior', partSize: o.value.partSize,
      bucket: 'another-bucket', region: 'fixture-region', credentialIdentity: 'fixture-identity' });
    await expect(storeObject(input, o.value)).rejects.toThrow('binding differs');
    expect(calls.send).not.toHaveBeenCalled(); expect(o.multipartState.write).not.toHaveBeenCalled(); expect(o.multipartState.remove).not.toHaveBeenCalled();
  });
  it('rechecks the fence before a network retry instead of continuing a stale effect', async () => {
    const o = options(); const run = vi.fn(async () => { throw Object.assign(new Error('network lost'), { code: 'ECONNRESET' }); });
    const sleep = vi.fn(async () => { o.current.mockRejectedValue(new Error('lease changed')); });
    await expect(withRetries(run, sleep, o.value.scope)).rejects.toThrow('lease changed');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
