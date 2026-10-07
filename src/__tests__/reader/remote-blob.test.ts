import { describe, expect, it, vi } from "vitest";
import { RangeSource, ReadError, RemoteBlob } from "@/lib/reader/engines/foliate/remote-blob";

/* SLN-492: the file's bytes over HTTP Range, from the page's prefetch and a small cache */

const SIZE = 1_000_000;
const file = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);
const expected = (start: number, end: number) => Array.from(file.subarray(start, end));

/** A server that answers byte ranges (or the whole file), and the ranges it was asked for */
function server(options: { status?: (url: string) => number; whole?: boolean; failUrl?: string } = {}) {
  const asked: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (options.failUrl && url === options.failUrl) throw new TypeError("Failed to fetch");
    const range = (init?.headers as Record<string, string>).Range;
    asked.push(`${url} ${range}`);
    const status = options.status?.(url) ?? 206;
    if (status !== 206) return new Response(status === 200 || options.whole ? file : null, { status });
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    const body = file.slice(Number(a), Number(b) + 1);
    return new Response(body, { status: 206, headers: { "content-range": `bytes ${a}-${b}/${SIZE}` } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, asked };
}

const source = (s: ReturnType<typeof server>, over: Partial<ConstructorParameters<typeof RangeSource>[0]> = {}) =>
  new RangeSource({ ebookId: "e1", url: "https://cdn.test/f", fallbackUrl: "/api/ebooks/files/f", size: SIZE, fetch: s.fetch, ...over });

describe("RangeSource", () => {
  it("serves a read inside the page's prefetch without a request", async () => {
    const s = server();
    const r = source(s, { prefetch: Promise.resolve([{ start: 0, bytes: file.slice(0, 65536).buffer }]) });
    expect(Array.from(await r.read(10, 20))).toEqual(expected(10, 20));
    expect(s.asked).toEqual([]);
  });

  it("fetches at least 64 KiB on a miss, and reads inside it after", async () => {
    const s = server();
    const r = source(s);
    expect(Array.from(await r.read(1000, 1010))).toEqual(expected(1000, 1010));
    expect(Array.from(await r.read(50_000, 60_000))).toEqual(expected(50_000, 60_000));
    expect(s.asked).toEqual(["https://cdn.test/f bytes=1000-66535"]);
    expect(r.requests).toBe(1);
    expect(r.transferred).toBe(65536);
  });

  it("fetches up to what the caller reads next", async () => {
    const s = server();
    await source(s).read(0, 10, 200_000);
    expect(s.asked).toEqual(["https://cdn.test/f bytes=0-199999"]);
  });

  it("fetches only the part of a read past what it already holds", async () => {
    const s = server();
    const r = source(s, { prefetch: Promise.resolve([{ start: 0, bytes: file.slice(0, 262_144).buffer }]) });
    const bytes = await r.read(65_536, SIZE);
    expect(s.asked).toEqual([`https://cdn.test/f bytes=262144-${SIZE - 1}`]);
    expect(bytes.length).toBe(SIZE - 65_536);
    expect(Array.from(bytes.subarray(0, 5))).toEqual(expected(65_536, 65_541));
    expect(Array.from(bytes.subarray(262_144 - 65_536 - 2, 262_144 - 65_536 + 2))).toEqual(expected(262_142, 262_146));
    expect(bytes[bytes.length - 1]).toBe(file[SIZE - 1]);
  });

  it("joins cached pieces that run on from each other", async () => {
    const s = server();
    const r = source(s, {
      prefetch: Promise.resolve([
        { start: 0, bytes: file.slice(0, 1000).buffer },
        { start: 1000, bytes: file.slice(1000, 3000).buffer },
      ]),
    });
    expect(Array.from(await r.read(500, 2500))).toEqual(expected(500, 2500));
    expect(Array.from(await r.read(2000, 4000))).toEqual(expected(2000, 4000));
    expect(s.asked).toEqual(["https://cdn.test/f bytes=3000-68535"]);
  });

  it("keeps the asked part of a whole-file answer", async () => {
    const s = server({ status: () => 200 });
    expect(Array.from(await source(s).read(10, 20))).toEqual(expected(10, 20));
  });

  it("refreshes an expired link once, then reports it expired", async () => {
    let signed = 0;
    const s = server({ status: (url) => (url.includes("sig=new") ? 206 : 403) });
    const r = source(s, { refreshUrl: async () => `https://cdn.test/f?sig=new${++signed}` });
    expect(Array.from(await r.read(0, 4))).toEqual(expected(0, 4));
    expect(signed).toBe(1);

    const stale = server({ status: () => 403 });
    const again = source(stale, { refreshUrl: async () => "https://cdn.test/f?still-bad" });
    await expect(again.read(0, 4)).rejects.toMatchObject({ kind: "expired" });
  });

  it("moves to the app route when the CDN cannot be reached", async () => {
    const s = server({ failUrl: "https://cdn.test/f" });
    const r = source(s);
    expect(Array.from(await r.read(0, 4))).toEqual(expected(0, 4));
    expect(s.asked).toEqual(["/api/ebooks/files/f bytes=0-65535"]);
  });

  it("reports a network failure on the app route", async () => {
    const s = server({ failUrl: "/api/ebooks/files/f" });
    const r = source(s, { url: "/api/ebooks/files/f" });
    const error = await r.read(0, 4).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ReadError);
    expect(error).toMatchObject({ kind: "network" });
  });

  it("clamps reads to the file", async () => {
    const s = server();
    const r = source(s);
    expect((await r.read(SIZE - 2, SIZE + 100)).length).toBe(2);
    expect((await r.read(5, 5)).length).toBe(0);
  });
});

describe("RemoteBlob", () => {
  it("slices like a Blob, negative ends included", async () => {
    const s = server();
    const blob = new RemoteBlob(source(s), "application/pdf", "book.pdf");
    expect(blob.size).toBe(SIZE);
    const tail = blob.slice(-10);
    expect(tail.size).toBe(10);
    expect(Array.from(new Uint8Array(await tail.arrayBuffer()))).toEqual(expected(SIZE - 10, SIZE));
    const inner = blob.slice(100, 200).slice(10, 20);
    expect(Array.from(new Uint8Array(await inner.arrayBuffer()))).toEqual(expected(110, 120));
    expect(blob.slice(50, 10).size).toBe(0);
  });
});
