import { describe, expect, it, vi } from "vitest";
import { boundedJsonBytes } from "@/lib/ebooks/upload/bounded-json";
import { decodeInspectorRequest, encodeInspectorRequest, type InspectorWorkerRequest } from "@/lib/ebooks/upload/worker-request";
import { InspectorAttemptBudget } from "@/lib/ebooks/upload/inspector-resources";
import { withInspectionBudget } from "@/lib/ebooks/ingest/budget";
import { parseXml } from "@/lib/ebooks/ingest/inspect/xml";
import { palmDocDecompress } from "@/lib/ebooks/ingest/inspect/mobi";
import { rasterHeader } from "@/lib/ebooks/ingest/image-header";
import { openZip } from "@/lib/ebooks/ingest/zip";
import { makeCovers } from "@/lib/ebooks/ingest/cover";
import { MiB, UPLOAD_LIMITS } from "@/lib/ebooks/upload/limits";

const native = vi.hoisted(() => vi.fn());
vi.mock("sharp", () => ({ default: native }));

const request: InspectorWorkerRequest = { protocol: 1, name: "book.epub", bytes: 123, sha256: "a".repeat(64),
  identity: { volumeId: "11111111-1111-4111-8111-111111111111", bindingSha256: "b".repeat(64),
    fence: { operationId: "22222222-2222-4222-8222-222222222222", ownerToken: "33333333-3333-4333-8333-333333333333", ownerFence: 7, generation: 2 } } };

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer); view.setUint32(8, 13); bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width); view.setUint32(20, height); bytes[24] = 8; bytes[25] = 2; return bytes;
}
function webp(canvas: number, frame: number): Uint8Array {
  const bytes = new Uint8Array(48); const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF")); view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBPVP8X"), 8); view.setUint32(16, 10, true);
  bytes[24] = canvas - 1; bytes[27] = canvas - 1;
  bytes.set(new TextEncoder().encode("VP8 "), 30); view.setUint32(34, 10, true);
  bytes.set([0x9d, 0x01, 0x2a], 41); view.setUint16(44, frame, true); view.setUint16(46, frame, true);
  return bytes;
}

describe("isolated worker allocation boundaries", () => {
  it("measures exact JSON wire bytes before serialization, including escaping and surrogate pairs", () => {
    for (const value of [null, true, -0, 1e+30, [undefined, "€𐀀\ud800\udc00\ud800"], { text: "\0\b\t\n\f\r\"\\", omitted: undefined }]) {
      const bytes = Buffer.byteLength(JSON.stringify(value));
      expect(boundedJsonBytes(value, bytes)).toBe(bytes);
      expect(() => boundedJsonBytes(value, bytes - 1)).toThrow();
    }
  });
  it("refuses cycles, unsupported values and excessive nesting before allocating JSON", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    let nested: unknown = null; for (let i = 0; i < 34; i++) nested = [nested];
    for (const value of [cycle, nested, new Date(), NaN, BigInt(1), { callback() {} }]) expect(() => boundedJsonBytes(value)).toThrow();
  });
  it("binds a strict worker request and rejects extra fields, unsafe names, invalid fences and invalid UTF-8", () => {
    expect(decodeInspectorRequest(encodeInspectorRequest(request))).toEqual(request);
    const candidates = [{ ...request, command: "ignored" }, { ...request, name: "../book.epub" }, { ...request, bytes: UPLOAD_LIMITS.sourceBytes + 1 },
      { ...request, identity: { ...request.identity, fence: { ...request.identity.fence, generation: -1 } } }];
    for (const candidate of candidates) expect(() => decodeInspectorRequest(Buffer.from(JSON.stringify(candidate)))).toThrow();
    expect(() => decodeInspectorRequest(new Uint8Array([0xff]))).toThrow();
    expect(() => decodeInspectorRequest(new Uint8Array(64 * 1024 + 1))).toThrow("byte bound");
  });
  it("keeps parser resource failure latched when an inspector catches it as damaged input", async () => {
    const budget = new InspectorAttemptBudget();
    await expect(withInspectionBudget(budget, async () => {
      try { parseXml("<a>".repeat(256) + "</a>".repeat(256)); } catch { return "quarantined"; }
      return "accepted";
    })).rejects.toThrow("XML tree");
    expect(budget.signal.aborted).toBe(true);
  });
  it("preserves PalmDOC backreferences across its 64 KiB chunk boundary", async () => {
    const encoded = new Uint8Array(65537); encoded.fill(65, 0, 65535); encoded.set([0x80, 0x08], 65535);
    const budget = new InspectorAttemptBudget();
    const decoded = await withInspectionBudget(budget, async () => palmDocDecompress(encoded, "cross-chunk"));
    expect(decoded.length).toBe(65538); expect(decoded.every((byte) => byte === 65)).toBe(true);
    expect(budget.snapshot().decodedBytes).toBe(decoded.length);
  });
  it("rejects an oversized archive directory before zip.js lists entries", async () => {
    const size = 10 * MiB; const reads: number[] = [];
    const source = { name: "large-directory.epub", size, close: async () => {}, read: async (offset: number, length: number) => {
      reads.push(length); const tail = new Uint8Array(length); const view = new DataView(tail.buffer); const end = size - offset - 22;
      view.setUint32(end, 0x06054b50, true); view.setUint16(end + 10, 1, true);
      view.setUint32(end + 12, 9 * MiB, true); view.setUint32(end + 16, 0, true); return tail;
    } };
    await expect(withInspectionBudget(new InspectorAttemptBudget(), async () => openZip(source))).rejects.toThrow();
    expect(reads).toHaveLength(1); expect(reads[0]).toBeLessThan(66_000);
  });
  it("checks actual WebP frame dimensions rather than trusting a smaller outer canvas", () => {
    expect(rasterHeader(webp(2, 2))).toEqual({ width: 2, height: 2, format: "webp" });
    expect(() => rasterHeader(webp(2, 16000))).toThrow("dimensions differ");
    const animated = webp(2, 2); animated[20] = 2;
    expect(() => rasterHeader(animated)).toThrow("Animated");
  });
  it("rejects a forged ZIP end-record count before listing the actual entries", async () => {
    const count = 10_001; const directoryBytes = count * 46;
    const bytes = new Uint8Array(directoryBytes + 22); const view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) view.setUint32(i * 46, 0x02014b50, true);
    view.setUint32(directoryBytes, 0x06054b50, true); view.setUint16(directoryBytes + 10, 1, true);
    view.setUint32(directoryBytes + 12, directoryBytes, true);
    const source = { name: "forged-count.epub", size: bytes.length, close: async () => {},
      read: async (offset: number, length: number) => bytes.slice(offset, offset + length) };
    await expect(withInspectionBudget(new InspectorAttemptBudget(), async () => openZip(source))).rejects.toThrow("actual entry count exceeds");
  });
  it("rejects oversized raster surfaces before calling the native decoder even if cover errors are caught", async () => {
    native.mockClear();
    await expect(withInspectionBudget(new InspectorAttemptBudget(), async () => makeCovers({ kind: "bytes", load: async () => png(16384, 16384) })))
      .rejects.toThrow();
    expect(native).not.toHaveBeenCalled();
  });
  it("omits unknown raster codecs without invoking native decoding", async () => {
    native.mockClear();
    const result = await withInspectionBudget(new InspectorAttemptBudget(), async () => makeCovers({ kind: "bytes", load: async () => Buffer.from("GIF89a") }));
    expect(result.covers).toBeNull(); expect(result.reason).toContain("bounded raster profile"); expect(native).not.toHaveBeenCalled();
  });
});
