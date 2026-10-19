// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadWorkbench } from '@/components/ebooks/upload-workbench';
import { readUploadSession, writeUploadSession } from '@/lib/ebooks/upload/browser-client';
import type { UploadTarget } from '@/lib/ebooks/upload/protocol';

vi.mock('@/lib/ebooks/upload/browser-sha256', () => ({ fingerprintUploadFile: vi.fn(async () => ({
  sha256: 'a'.repeat(64), parts: [{ number: 1, bytes: 3, sha256: 'a'.repeat(64) }],
})) }));
const oldBatch = '11111111-1111-4111-8111-111111111111', newBatch = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333', runId = '44444444-4444-4444-8444-444444444444';
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function flush() { for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)); }
async function mount(target: UploadTarget = { kind: 'new' }, available = true, notice: string | null = null) { await act(async () => { root.render(createElement(UploadWorkbench, { target, initialBatchId: null, available, notice })); await flush(); }); }
function button(label: string): HTMLButtonElement { const found = [...host.querySelectorAll('button')].find((b) => b.textContent === label); if (!found) throw new Error(`Missing ${label}`); return found; }
async function click(label: string) { await act(async () => { button(label).click(); await flush(); }); }
async function choose(input: HTMLInputElement) {
  Object.defineProperty(input, 'files', { value: [new File(['abc'], 'book.epub')], configurable: true });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await flush(); });
}
function summary(generation: number, state: 'receiving' | 'completed' = 'receiving', target: UploadTarget = { kind: 'new' }) {
  return { id: itemId, name: 'book.epub', bytes: 3, sha256: 'a'.repeat(64), target, generation, state, acknowledgedBytes: state === 'completed' ? 3 : 0,
    retainedUntil: null, message: null, ebookId: null, fileId: null, originalOperationId: null, currentFingerprint: null, undoAvailable: false };
}
describe('mounted upload recovery and another batch', () => {
  it('retries the exact uncertain admission then unlocks fresh recovery only for its bound definite refusal', async () => {
    writeUploadSession({ version: 1, batchId: oldBatch, pending: null });
    let generation = 6; const commands: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === `/api/ebooks/uploads/${oldBatch}`) return Response.json({ batch: { id: oldBatch, key: oldBatch, runId, items: [summary(generation)] }, ready: true });
      if (!options?.method) { const { acknowledgedBytes: _unused, ...item } = summary(generation); return Response.json({ ...item, acknowledged: [] }); }
      commands.push(String(options.body)); const command = JSON.parse(String(options.body));
      if (command.action === 'admit') {
        generation = 7;
        if (commands.length === 1) throw new Error('response lost');
        return Response.json({ code: 'generation_changed', error: 'Recovered', refusal: {
          status: 409, code: 'generation_changed', action: 'admit', operationId: itemId, key: command.key, generation: command.generation,
        } }, { status: 409 });
      }
      return Response.json({ operationId: itemId, key: command.key, status: 200, message: 'Canceled', preview: null });
    }));
    await mount(); await click('Choose the file again'); await choose(host.querySelector('input[aria-label="Choose the file again"]')!);
    const pending = readUploadSession().pending;
    expect(pending).toMatchObject({ body: { action: 'admit', generation: 6 } });
    expect(button('Cancel upload').disabled).toBe(true); expect(button('Start another upload').disabled).toBe(true);
    expect(button('Resume').disabled).toBe(true);
    await click('Send it again');
    expect(commands).toHaveLength(2); expect(commands[1]).toBe(commands[0]);
    expect(readUploadSession()).toMatchObject({ pending: null, lastRefusal: { generation: 6 } });
    expect(button('Cancel upload').disabled).toBe(false);
    // The file chosen again is remembered, so Resume sends it without choosing it a third time
    expect(button('Resume').disabled).toBe(false);
    expect(host.textContent).toContain('The server restarted before it took the last file');
    await click('Cancel upload'); expect(JSON.parse(commands[2]).action).toBe('cancel');
  });
  it('starts a second batch with the current replacement target and retains the previous batch link', async () => {
    writeUploadSession({ version: 1, batchId: oldBatch, pending: null });
    const target: UploadTarget = { kind: 'replace', ebookId: runId, fileId: itemId, beforeFingerprint: 'b'.repeat(64) };
    const creates: { files: { target: UploadTarget }[] }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/ebooks/uploads' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body)); creates.push(body);
        return Response.json({ id: newBatch, key: body.key, runId, items: [summary(0, 'receiving', target)] });
      }
      if (url.startsWith('/api/ebooks/uploads/')) {
        const id = url.endsWith(oldBatch) ? oldBatch : newBatch;
        return Response.json({ batch: { id, key: id, runId, items: [summary(0, 'completed', target)] }, ready: true });
      }
      // Creation is committed; a subsequent transfer read is independently unavailable.
      return Response.json({ error: 'Worker recovering' }, { status: 503 });
    }));
    await mount(target); await click('Start another upload');
    expect(readUploadSession()).toMatchObject({ batchId: null, priorBatches: [oldBatch] });
    expect(host.querySelector('a[href="/ebooks/upload?batch=' + oldBatch + '"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Choose eBook files"]')!;
    expect(input.multiple).toBe(false); await choose(input); await click('Start upload');
    expect(creates).toHaveLength(1); expect(creates[0].files[0].target).toEqual(target);
    expect(readUploadSession().batchId).toBe(newBatch); expect(readUploadSession().pending).toBeNull();
  });
});

describe('the upload page says what happened (SLN-672)', () => {
  const ebookId = '55555555-5555-4555-8555-555555555555';
  it('unlocks the page after a refusal the server will repeat, and Discard drops a lost request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Uploads are not available on this server yet.' }, { status: 503 })));
    await mount(); await choose(host.querySelector('input[aria-label="Choose eBook files"]')!); await click('Start upload');
    expect(readUploadSession().pending).toBeNull();
    expect(host.textContent).toContain('Uploads are not available on this server yet.');
    expect(button('Start upload').disabled).toBe(false);
    await act(async () => root.unmount()); root = createRoot(host);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await mount(); await choose(host.querySelector('input[aria-label="Choose eBook files"]')!); await click('Start upload');
    expect(readUploadSession().pending).toMatchObject({ kind: 'create' });
    expect(button('Start upload').disabled).toBe(true);
    await click('Discard request');
    expect(readUploadSession().pending).toBeNull(); expect(button('Start upload').disabled).toBe(false);
  });
  it('says up front when uploads are off', async () => {
    await mount({ kind: 'new' }, false);
    expect(host.textContent).toContain('Uploads are off on this server');
    expect(button('Choose files').disabled).toBe(true);
  });
  it('says up front when the upload service needs the Mac to sign in again', async () => {
    await mount({ kind: 'new' }, true, 'Uploads need the Mac to sign in to AWS again.');
    expect(host.querySelector('[role="note"]')?.textContent).toBe('Uploads need the Mac to sign in to AWS again.');
    expect(host.textContent).not.toContain('Uploads are off on this server');
  });
  it('leads from a finished file to its eBook, the reader and linking', async () => {
    writeUploadSession({ version: 1, batchId: oldBatch, pending: null });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ batch: { id: oldBatch, key: oldBatch, runId,
      items: [{ ...summary(0, 'completed'), ebookId, fileId: itemId }] }, ready: true })));
    await mount();
    expect(host.querySelector(`a[href="/ebooks/${ebookId}"]`)?.textContent).toBe('Open eBook');
    expect(host.querySelector(`a[href^="/reader/${ebookId}"]`)?.textContent).toBe('Read');
    expect(host.querySelector(`a[href="/ebooks/${ebookId}#book"]`)?.textContent).toBe('Link to a book…');
    expect(host.textContent).toContain('Added · 1 KB');
    expect(host.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('100');
  });
  it('previews and confirms every received file in turn', async () => {
    writeUploadSession({ version: 1, batchId: oldBatch, pending: null });
    const second = '66666666-6666-4666-8666-666666666666';
    const items = [{ ...summary(0), state: 'ready' }, { ...summary(0), id: second, name: 'other.epub', sha256: 'c'.repeat(64), state: 'ready' }];
    const actions: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (!options?.method) return Response.json({ batch: { id: oldBatch, key: oldBatch, runId, items }, ready: true });
      const command = JSON.parse(String(options.body)); actions.push(`${command.action} ${url.split('/').pop()}`);
      return Response.json({ operationId: url.split('/').pop(), key: command.key, status: 200, message: 'Previewed',
        preview: command.action === 'prepare' ? { token: 'd'.repeat(64), effect: 'Adds this file to the library as a new eBook.', expiresAt: new Date(Date.now() + 600_000).toISOString() } : null });
    }));
    await mount(); await click('Preview all (2)');
    expect(actions).toEqual([`prepare ${itemId}`, `prepare ${second}`]);
    await click('Confirm all (2)');
    expect(actions.slice(2)).toEqual([`confirm ${itemId}`, `confirm ${second}`]);
  });
});

describe('cancel while sending, and adding on its own (SLN-672)', () => {
  const ebookId = '55555555-5555-4555-8555-555555555555';
  /** A server for one file: the part upload waits until it is aborted; `state` is what the batch shows */
  function server(opts: { target?: UploadTarget; hangPart?: boolean; state: () => string; prepare?: (calls: number) => Response | null }) {
    const actions: string[] = []; let prepares = 0;
    const target = opts.target ?? { kind: 'new' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url === '/api/ebooks/uploads' && options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        return Response.json({ id: newBatch, key: body.key, runId, items: [summary(0, 'receiving', target)] });
      }
      if (url.startsWith('/api/ebooks/uploads/')) return Response.json({ batch: { id: newBatch, key: newBatch, runId,
        items: [{ ...summary(0, 'receiving', target), state: opts.state(), ebookId: opts.state() === 'completed' ? ebookId : null }] }, ready: true });
      if (options?.method === 'PUT') {
        actions.push('put');
        if (opts.hangPart) return new Promise<Response>((_, reject) => options.signal!.addEventListener('abort', () => reject(options.signal!.reason)));
        return Response.json({ number: 1, bytes: 3, sha256: 'a'.repeat(64), generation: 0 });
      }
      if (!options?.method) { const { acknowledgedBytes: _unused, ...item } = summary(0, 'receiving', target); return Response.json({ ...item, acknowledged: [] }); }
      const command = JSON.parse(String(options.body)); actions.push(command.action);
      if (command.action === 'prepare') { const answer = opts.prepare?.(++prepares); if (answer) return answer; }
      return Response.json({ operationId: itemId, key: command.key, status: 200, message: command.action === 'cancel' ? 'Upload canceled.' : 'Done',
        preview: command.action === 'prepare' ? { token: 'd'.repeat(64), effect: 'Adds this file to the library as a new eBook.', expiresAt: new Date(Date.now() + 600_000).toISOString() } : null });
    }));
    return actions;
  }
  /** Waits through the page's 3 s refreshes until `done`, or until `ms` have passed */
  async function until(done: () => boolean, ms = 10_000) {
    const end = Date.now() + ms;
    while (!done() && Date.now() < end) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); await flush(); });
  }
  async function send(target: UploadTarget = { kind: 'new' }) {
    await mount(target); await choose(host.querySelector('input[aria-label="Choose eBook files"]')!);
    await act(async () => { button('Start upload').click(); await flush(); });
  }
  it('stops the parts in flight and cancels the file while it sends', async () => {
    const actions = server({ hangPart: true, state: () => 'receiving' });
    await send();
    expect(actions).toEqual(['admit', 'put']);
    expect(button('Cancel upload').disabled).toBe(false);
    await click('Cancel upload');
    expect(actions).toEqual(['admit', 'put', 'cancel']);
    expect(host.textContent).toContain('Upload canceled.');
    expect(button('Start another upload').disabled).toBe(false);
  });
  it('previews and confirms a sent file on its own once it is checked', async () => {
    let state = 'processing';
    const actions = server({ state: () => state });
    await send();
    expect(actions).toEqual(['admit', 'put', 'complete']);
    state = 'ready';
    await until(() => actions.length >= 5);
    expect(actions.slice(3)).toEqual(['prepare', 'confirm']);
  }, 20_000);
  it('tries again while the worker is busy, and leaves a refused file waiting with Preview', async () => {
    const actions = server({ state: () => 'ready', prepare: (calls) => calls === 1
      ? Response.json({ code: 'upload_not_settled', error: 'Wait for the upload worker to finish verified cleanup.' }, { status: 409 })
      : Response.json({ code: 'upload_replace_required', error: 'This exact file is already in the library.' }, { status: 409 }) });
    await send();
    expect(actions.slice(3)).toEqual(['prepare']);
    expect(host.textContent).not.toContain('Wait for the upload worker');
    await until(() => actions.length >= 5);
    expect(actions.slice(3)).toEqual(['prepare', 'prepare']);
    expect(host.textContent).toContain('This exact file is already in the library.');
    expect(button('Preview').disabled).toBe(false);
    // Refused: later refreshes do not try it again
    await until(() => false, 3500);
    expect(actions.slice(3)).toEqual(['prepare', 'prepare']);
  }, 20_000);
  it('waits for Confirm on a replacement', async () => {
    const target: UploadTarget = { kind: 'replace', ebookId, fileId: itemId, beforeFingerprint: 'b'.repeat(64) };
    const actions = server({ target, state: () => 'ready' });
    await send(target);
    await until(() => false, 3500);
    expect(actions).toEqual(['admit', 'put', 'complete']);
    expect(button('Preview').disabled).toBe(false);
  }, 20_000);
});
