import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { BrowserSha256 } from "@/lib/ebooks/upload/browser-sha256";
import { readUploadSession, writeUploadSession, sendUploadRequest, sendUploadParts, settleUploadAdmissionRefusal, startAnotherUploadBatch } from "@/lib/ebooks/upload/browser-client";
import { UploadAdmissionRefusal } from "@/lib/ebooks/upload/admission-refusal";
import type { UploadItemView } from "@/lib/ebooks/upload/protocol";

afterEach(() => { vi.unstubAllGlobals(); });
const key = "11111111-1111-4111-8111-111111111111";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("bounded browser upload recovery", () => {
  it("matches SHA-256 across empty input, padding boundaries and repeated updates", () => {
    for (const size of [0, 1, 55, 56, 63, 64, 65, 127, 128, 129, 65538]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index * 73 & 255);
      for (const chunk of [1, 63, 64, 65, 4096]) {
        const incremental = new BrowserSha256();
        for (let at = 0; at < bytes.length; at += chunk) incremental.update(bytes.subarray(at, at + chunk));
        expect(incremental.digest()).toBe(hash(bytes));
        expect(() => incremental.update(bytes)).toThrow("complete");
      }
    }
  });
  it("retains the exact mutation key/body after an uncertain response", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const pending = { kind: "command" as const, operationId: key, body: { action: "cancel" as const, key } };
    writeUploadSession({ version: 1, batchId: key, pending });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("response lost"); }));
    await expect(sendUploadRequest(pending)).rejects.toThrow("response lost");
    expect(readUploadSession().pending).toEqual(pending);
  });
  it("rejects altered retained bytes before admission or any PUT, regardless of file name", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const bytes = new TextEncoder().encode("abc");
    const file = Object.assign(new Blob([bytes]), { name: "same.epub" }) as File;
    const item: UploadItemView = { id: key, name: file.name, bytes: bytes.length, sha256: hash(bytes), target: { kind: "new" },
      generation: 7, state: "receiving", acknowledged: [{ number: 1, bytes: 3, sha256: "a".repeat(64) }],
      retainedUntil: null, message: null, ebookId: null, fileId: null, originalOperationId: null, currentFingerprint: null, undoAvailable: false };
    const admit = vi.fn();
    await expect(sendUploadParts(file, item, new AbortController().signal, () => {}, admit)).rejects.toThrow("Reselected");
    expect(admit).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('settles only a bound pre-admission refusal and preserves its original request evidence', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    const pending = { kind: 'command' as const, operationId: key, body: { action: 'admit' as const, key, generation: 6 } };
    const refusal = { status: 409 as const, code: 'generation_changed' as const, action: 'admit' as const, operationId: key, key, generation: 6 };
    const session = { version: 1 as const, batchId: key, pending }; writeUploadSession(session);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: refusal.code, error: 'Recovered', refusal }, { status: 409 })));
    let error: unknown; try { await sendUploadRequest(pending); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(UploadAdmissionRefusal);
    const settled = settleUploadAdmissionRefusal(session, pending, error as UploadAdmissionRefusal); writeUploadSession(settled);
    expect(readUploadSession()).toMatchObject({ pending: null, lastRefusal: refusal });
    expect(JSON.parse(values.get(`durtal.ebook-upload.refusal.${key}`)!)).toEqual({ request: pending, refusal });
    expect(() => settleUploadAdmissionRefusal(session, pending, new UploadAdmissionRefusal({ ...refusal, generation: 5 }))).toThrow('does not settle');
  });
  it('keeps uncertainty for an unbound refusal or an arbitrary HTTP error', async () => {
    const pending = { kind: 'command' as const, operationId: key, body: { action: 'admit' as const, key, generation: 6 } };
    for (const body of [{ code: 'generation_changed', error: 'Recovered' }, { code: 'outcome_unknown_retry_original', error: 'Lost' }]) {
      vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status: 409 })));
      await expect(sendUploadRequest(pending)).rejects.not.toBeInstanceOf(UploadAdmissionRefusal);
    }
    expect(() => startAnotherUploadBatch({ version: 1, batchId: key, pending })).toThrow('Resolve');
  });
});
