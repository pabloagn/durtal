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
async function mount(target: UploadTarget = { kind: 'new' }) { await act(async () => { root.render(createElement(UploadWorkbench, { target, initialBatchId: null })); await flush(); }); }
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
    await mount(); await choose(host.querySelector('input[type=file]')!);
    const pending = readUploadSession().pending;
    expect(pending).toMatchObject({ body: { action: 'admit', generation: 6 } });
    expect(button('Cancel upload').disabled).toBe(true); expect(button('Start another upload').disabled).toBe(true);
    await click('Retry saved request');
    expect(commands).toHaveLength(2); expect(commands[1]).toBe(commands[0]);
    expect(readUploadSession()).toMatchObject({ pending: null, lastRefusal: { generation: 6 } });
    expect(button('Cancel upload').disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(false);
    expect(host.textContent).toContain('Admission for generation 6 was refused');
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
