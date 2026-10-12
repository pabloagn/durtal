import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManagedReaderFontAssets } from "@/lib/reader/presentation/managed-font-assets";
import { fontFaceCSS, READER_FONT_FILES } from "@/lib/reader/presentation/fonts";
import { presentationCss, policyTypographyCss, presentationFromPreferences } from "@/lib/reader/presentation";
import { PRESENTATION_DEFAULTS } from "@/lib/reader/presentation/defaults";

const origin = "https://reader.example";
const latin = READER_FONT_FILES.find(file => file.id === "literata" && file.style === "roman" && file.subset === "latin")!;
const inter = READER_FONT_FILES.find(file => file.id === "inter" && file.style === "roman" && file.subset === "latin")!;
const single = (path: string) => fontFaceCSS(origin).split("\n").find(line => line.includes(path))!;
const css = single(latin.path);
function response(path: string) {
  const bytes = Uint8Array.from(readFileSync(new URL("../../../public" + path, import.meta.url)));
  return new Response(bytes.buffer, { status: 200 });
}
function deferred() {
  let resolve!: (value: Response | undefined) => void;
  const promise = new Promise<Response | undefined>(done => { resolve = done; });
  return { promise, resolve };
}
function setup(read?: (url: string) => Promise<Response | undefined>) {
  const match = read ?? vi.fn(async (url: string) => response(new URL(url).pathname));
  let sequence = 0;
  const create = vi.fn(() => "blob:verified-font-" + ++sequence), revoke = vi.fn();
  const owner = createManagedReaderFontAssets(origin, { match, createObjectURL: create, revokeObjectURL: revoke });
  return { owner, match, create, revoke };
}
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Font helper must not fetch"); })); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("verified parent cache reader fonts", () => {
  it("reads only the selected family's declared cache URLs and preserves all CSS descriptors", async () => {
    const { owner, match, create } = setup();
    const selected = fontFaceCSS(origin, "literata"), managed = await owner.prepare(selected, new AbortController().signal);
    expect(match).toHaveBeenCalledTimes(12); expect(create).toHaveBeenCalledTimes(12);
    for (const [url] of vi.mocked(match).mock.calls) expect(url).toMatch(/^https:\/\/reader\.example\/fonts\/reader\/v1\/literata\//);
    const descriptors = (value: string) => value.replace(/url\("[^"\n]+"\)/g, 'url("<font>")');
    expect(descriptors(managed)).toBe(descriptors(selected)); expect(managed).not.toContain("https://reader.example/fonts/");
    expect(fetch).not.toHaveBeenCalled(); owner.dispose();
  });
  it("supplies the same verified blob to both supported stylesheet paths", async () => {
    const { owner } = setup(), managed = await owner.prepare(css, new AbortController().signal);
    const p = { ...presentationFromPreferences(PRESENTATION_DEFAULTS.desktop, origin), fontFaces: managed };
    expect(policyTypographyCss(p)).toContain(managed); expect(presentationCss({ ...p, policy: undefined })).toContain(managed); owner.dispose();
  });
  it("reuses verified URLs and revokes each once on disposal", async () => {
    const { owner, match, create, revoke } = setup(), first = await owner.prepare(css, new AbortController().signal);
    expect(await owner.prepare(css, new AbortController().signal)).toBe(first); expect(owner.ready(css)).toBe(first);
    expect(match).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
    owner.dispose(); owner.dispose(); expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:verified-font-1");
  });
  it("leaves publisher and undeclared legacy resources alone", async () => {
    const { owner, match, create } = setup();
    for (const value of ['', '@font-face{src:url("blob:publisher-owned")}', '@font-face{src:url("https://reader.example/fonts/literata.woff2")}'])
      expect(await owner.prepare(value, new AbortController().signal)).toBe(value);
    expect(match).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled(); owner.dispose();
  });
  it("preserves normal URLs when the Cache API is unavailable, without a new network call", async () => {
    vi.stubGlobal("caches", undefined);
    const create = vi.fn(), owner = createManagedReaderFontAssets(origin, { createObjectURL: create });
    expect(owner.ready(css)).toBe(css); expect(await owner.prepare(css, new AbortController().signal)).toBe(css);
    expect(create).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); owner.dispose();
  });
  it("does not block a verified Latin face on missing unused subsets", async () => {
    const selected = fontFaceCSS(origin, "literata");
    const { owner, create } = setup(vi.fn(async url => url.endsWith(latin.path) ? response(latin.path) : undefined));
    const managed = await owner.prepare(selected, new AbortController().signal);
    expect(managed).toContain('url("blob:verified-font-1")'); expect(managed).not.toContain(origin + latin.path);
    expect(managed).toContain(origin + READER_FONT_FILES.find(file => file.id === "literata" && file.subset !== "latin")!.path);
    expect(create).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); owner.dispose();
  });
  it("does not negatively cache a miss when an offline download later populates the cache", async () => {
    const read = vi.fn<(url: string) => Promise<Response | undefined>>().mockResolvedValueOnce(undefined).mockImplementation(async () => response(latin.path));
    const { owner, create } = setup(read);
    expect(await owner.prepare(css, new AbortController().signal)).toBe(css); expect(owner.ready(css)).toBeNull();
    expect(await owner.prepare(css, new AbortController().signal)).toContain('url("blob:verified-font-1")');
    expect(read).toHaveBeenCalledTimes(2); expect(create).toHaveBeenCalledTimes(1); owner.dispose();
  });
  it.each(["length", "hash", "status", "redirect", "denied"])("does not publish %s-invalid cache bytes", async invalid => {
    const good = new Uint8Array(await response(latin.path).arrayBuffer()); good[0] ^= 1;
    const read = vi.fn(async () => {
      if (invalid === "denied") throw new TypeError("Cache unavailable");
      if (invalid === "length") return new Response(new Uint8Array(4).buffer);
      if (invalid === "hash") return new Response(good.buffer);
      if (invalid === "status") return new Response("missing", { status: 404 });
      const reply = response(latin.path); Object.defineProperty(reply, "redirected", { value: true }); return reply;
    });
    const { owner, create } = setup(read);
    expect(await owner.prepare(css, new AbortController().signal)).toBe(css);
    expect(create).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); owner.dispose();
  });
  it("bounds a hung cache lookup and ignores its late successful result", async () => {
    vi.useFakeTimers(); const late = deferred(), { owner, create } = setup(vi.fn(() => late.promise));
    const work = owner.prepare(css, new AbortController().signal); await vi.advanceTimersByTimeAsync(2000);
    expect(await work).toBe(css); late.resolve(response(latin.path)); await Promise.resolve(); await Promise.resolve();
    expect(create).not.toHaveBeenCalled(); expect(owner.ready(css)).toBeNull(); owner.dispose();
  });
  it("aborts pending cache work on disposal even when the cache ignores cancellation", async () => {
    const late = deferred(), { owner, create } = setup(vi.fn(() => late.promise)), work = owner.prepare(css, new AbortController().signal);
    const rejected = expect(work).rejects.toMatchObject({ name: "AbortError" }); owner.dispose();
    late.resolve(response(latin.path)); await rejected; expect(create).not.toHaveBeenCalled();
  });
  it("retires the old family without publishing late bytes over the new family", async () => {
    const late = deferred(), { owner, create } = setup(vi.fn(url => url.endsWith(latin.path) ? late.promise : Promise.resolve(response(inter.path))));
    const signal = new AbortController().signal, old = owner.prepare(css, signal), rejected = expect(old).rejects.toMatchObject({ name: "AbortError" });
    const nextCSS = single(inter.path), current = await owner.prepare(nextCSS, signal);
    late.resolve(response(latin.path)); await rejected;
    expect(owner.ready(nextCSS)).toBe(current); expect(owner.ready(css)).toBeNull(); expect(create).toHaveBeenCalledTimes(1); owner.dispose();
  });
  it("honours external cancellation before installing bytes", async () => {
    const late = deferred(), controller = new AbortController(), { owner, create } = setup(vi.fn(() => late.promise));
    const work = owner.prepare(css, controller.signal), rejected = expect(work).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); late.resolve(response(latin.path)); await rejected; expect(create).not.toHaveBeenCalled(); owner.dispose();
  });
  it("rolls back all allocated URLs if allocation fails", async () => {
    const create = vi.fn().mockReturnValueOnce("blob:first").mockImplementationOnce(() => { throw new Error("URL allocation failed"); });
    const revoke = vi.fn(), match = vi.fn(async (url: string) => response(new URL(url).pathname));
    const owner = createManagedReaderFontAssets(origin, { match, createObjectURL: create, revokeObjectURL: revoke });
    await expect(owner.prepare(css + "\n" + single(inter.path), new AbortController().signal)).rejects.toThrow("URL allocation failed");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:first"); expect(owner.ready(css)).toBeNull(); owner.dispose();
  });
});
