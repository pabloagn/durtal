import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadHostBridge, UploadHostClient } from '@/lib/ebooks/upload/host-bridge';
import { UploadAdmissionRefusal } from '@/lib/ebooks/upload/admission-refusal';
import type { UploadGateway } from '@/lib/ebooks/upload/broker';

const fixture = vi.hoisted(() => ({ bound: false, handler: null as null | ((req: IncomingMessage, res: ServerResponse) => void),
  status: 200, response: {} as unknown, requestOptions: null as unknown }));
vi.mock('node:fs/promises', () => ({
  realpath: vi.fn(async (value: string) => value), chmod: vi.fn(async () => {}), unlink: vi.fn(async () => { fixture.bound = false; }),
  lstat: vi.fn(async (value: string) => {
    const socket = value.endsWith('.sock');
    if (socket && !fixture.bound) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return { isDirectory: () => !socket, isSocket: () => socket, mode: socket ? 0o140600 : 0o40700,
      uid: process.getuid?.(), gid: process.getgid?.(), ino: 22, dev: 11 };
  }),
}));
vi.mock('node:http', async () => {
  const { Readable } = await import('node:stream');
  return {
    createServer: (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      fixture.handler = handler;
      const server = { once: vi.fn(), removeListener: vi.fn(), on: vi.fn(),
        listen: (_path: string, ready: () => void) => { fixture.bound = true; ready(); },
        close: (done: () => void) => { fixture.bound = false; done(); }, closeIdleConnections: vi.fn() };
      return server;
    },
    request: (options: unknown, receive: (res: IncomingMessage) => void) => {
      fixture.requestOptions = options;
      return { setTimeout: vi.fn(), once: vi.fn(), destroy: vi.fn(), end: () => {
        const res = Object.assign(Readable.from([Buffer.from(JSON.stringify(fixture.response))]), { statusCode: fixture.status });
        queueMicrotask(() => receive(res as IncomingMessage));
      } };
    },
  };
});
const id = '11111111-1111-4111-8111-111111111111', key = '22222222-2222-4222-8222-222222222222';
const config = { socketPath: '/private/upload/bridge.sock', secret: 'a'.repeat(64), targetFingerprint: 'b'.repeat(64), bindingSha256: 'c'.repeat(64) };
beforeEach(() => { fixture.bound = false; fixture.handler = null; fixture.response = {}; fixture.status = 200; fixture.requestOptions = null; });
async function call(method: string, url: string, body: string, extra: Record<string, string> = {}) {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method, url, headers: {
    authorization: `Bearer ${config.secret}`, 'x-upload-target': config.targetFingerprint, 'x-upload-binding': config.bindingSha256,
    'x-upload-channel': 'ui', 'content-type': 'application/json', ...extra,
  } }) as unknown as IncomingMessage;
  const iterator = vi.spyOn(req, Symbol.asyncIterator);
  let complete!: () => void; const done = new Promise<void>((resolve) => { complete = resolve; });
  const res = { headersSent: false, destroyed: false, status: 0, body: null as unknown, shouldKeepAlive: true,
    writeHead(status: number) { this.status = status; this.headersSent = true; },
    end(bytes: Buffer) { this.body = JSON.parse(bytes.toString()); complete(); }, destroy: vi.fn() };
  fixture.handler!(req, res as unknown as ServerResponse); await done;
  return { req, res, iterator };
}
describe('owned Unix upload bridge without real listeners', () => {
  it('authenticates before any byte body/core call and never exposes an arbitrary file route', async () => {
    const create = vi.fn(); const bridge = new UploadHostBridge(config, { create } as unknown as UploadGateway,
      { port: 45506, assertHeld: vi.fn(), acquire: vi.fn(), release: vi.fn() });
    await bridge.start();
    const refused = await call('POST', '/v1/batches', '{}', { authorization: 'Bearer wrong' });
    expect(refused.res.status).toBe(403); expect(create).not.toHaveBeenCalled(); expect(refused.iterator).not.toHaveBeenCalled();
    const unknown = await call('GET', '/private/spool/source', ''); expect(unknown.res.status).toBe(404);
    await bridge.stop();
  });
  it('preserves a bound stale admission refusal across the host/app boundary', async () => {
    const refusal = { status: 409 as const, code: 'generation_changed' as const, action: 'admit' as const, operationId: id, key, generation: 6 };
    const command = vi.fn(async () => { throw new UploadAdmissionRefusal(refusal); });
    const bridge = new UploadHostBridge(config, { command } as unknown as UploadGateway,
      { port: 45506, assertHeld: vi.fn(), acquire: vi.fn(), release: vi.fn() });
    await bridge.start(); const result = await call('POST', `/v1/items/${id}`, JSON.stringify({ action: 'admit', key, generation: 6 }));
    expect(result.res.status).toBe(409); expect(result.res.body).toMatchObject({ refusal });
    fixture.response = result.res.body; fixture.status = 409;
    await expect(new UploadHostClient(config).command(id, { action: 'admit', key, generation: 6 }, 'ui')).rejects.toMatchObject({ refusal });
    await bridge.stop();
  });
  it('returns a permanent negative command receipt unchanged so the app can settle the original key', async () => {
    fixture.bound = true; fixture.status = 409;
    fixture.response = { operationId: id, key, status: 409, message: 'Target changed', preview: null };
    expect(await new UploadHostClient(config).command(id, { action: 'prepare', key }, 'ui')).toEqual(fixture.response);
    expect(fixture.requestOptions).toMatchObject({ socketPath: config.socketPath, method: 'POST', path: `/v1/items/${id}` });
  });
  it('says the service is not running, rather than an uncertain outcome, when its socket is missing', async () => {
    fixture.bound = false;
    await expect(new UploadHostClient(config).ready()).rejects.toMatchObject({ status: 503, code: 'upload_unavailable' });
    expect(fixture.requestOptions).toBeNull();
  });
});
