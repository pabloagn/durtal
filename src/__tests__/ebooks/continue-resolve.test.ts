import { describe, expect, it, vi } from "vitest";
import type {
  BookSource,
  OpenOptions,
  DurtalLocator,
  ReaderEngine,
  ResolveResult,
} from "@/lib/reader/engine";
import { continueTarget } from "@/lib/ebooks/continue-target";
import { openReaderForContinue, resolveContinueAnchor } from "@/lib/ebooks/continue-resolve";
import { ebookFileKey } from "@/lib/ebooks/keys";

const oldHash = "ab".repeat(32);
const newHash = "cd".repeat(32);
const anchor = {
  deviceId: "local",
  deviceLabel: "Mac · Safari",
  fileId: "old",
  chapter: "Chapter 4",
  clientUpdatedAt: "2026-10-09T10:00:00Z",
  locator: {
    v: 1 as const,
    fileHash: oldHash,
    href: "ch4.xhtml",
    sectionIndex: 3,
    progression: 0.2,
    totalProgression: 0.44,
    cfi: "epubcfi(/6/8!/4/2)",
    text: {
      before: "Context",
      highlight: "The paragraph I was reading",
      after: "following",
    },
  },
};
const old = {
  id: "old",
  ebookId: "book",
  sha256: oldHash,
  sizeBytes: 200,
  s3Key: ebookFileKey(oldHash, "epub"),
  format: "epub",
  status: "replaced",
  drm: null,
  createdAt: "2026-10-09T09:00:00Z",
};
const replacement = {
  ...old,
  id: "new",
  sha256: newHash,
  s3Key: ebookFileKey(newHash, "epub"),
  status: "stored",
};
const descriptor = continueTarget({
  ebookId: "book",
  excluded: false,
  deviceId: "local",
  preferredFileId: "new",
  files: [old, replacement],
  positions: [anchor],
})!;

function engine(result: ResolveResult) {
  let current: DurtalLocator | null = {
    ...anchor.locator,
    fileHash: newHash,
    totalProgression: 0,
  };
  const api = {
    resolve: vi.fn<ReaderEngine["resolve"]>().mockResolvedValue(result),
    goTo: vi.fn<ReaderEngine["goTo"]>().mockImplementation(async (target) => {
      if ("fraction" in target)
        current = {
          ...anchor.locator,
          fileHash: newHash,
          totalProgression: target.fraction,
        };
      else if ("v" in target) current = target;
    }),
    currentLocator: vi
      .fn<ReaderEngine["currentLocator"]>()
      .mockImplementation(() => current),
  };
  return api;
}

describe("Continue historical-anchor resolution", () => {
  it("hands the original CFI/hash/quote to the engine and reports its inserted-paragraph landing", async () => {
    const healed = {
      ...anchor.locator,
      fileHash: newHash,
      cfi: "epubcfi(/6/8!/4/4)",
      totalProgression: 0.46,
    };
    const api = engine({ status: "healed", locator: healed });
    const landing = await resolveContinueAnchor(descriptor, api);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator);
    expect(api.resolve.mock.calls[0][0].fileHash).toBe(oldHash);
    expect(api.goTo).toHaveBeenCalledWith(healed);
    expect(landing).toMatchObject({
      status: "healed",
      percent: 46,
      sourceHash: oldHash,
      sourceFileId: "old",
      targetFileId: "new",
      clientUpdatedAt: anchor.clientUpdatedAt,
    });
    expect(anchor.locator.fileHash).toBe(oldHash);
  });
  it("uses safe source progression when quote resolution fails, preserving its clock", async () => {
    const api = engine({ status: "failed", locator: null });
    const landing = await resolveContinueAnchor(descriptor, api);
    expect(api.goTo).toHaveBeenCalledWith({ fraction: 0.44 });
    expect(landing).toMatchObject({
      status: "approximate",
      percent: 44,
      clientUpdatedAt: anchor.clientUpdatedAt,
    });
  });
  it("keeps local intent and the newer remote anchor during cross-format projection", async () => {
    const remote = {
      ...anchor,
      deviceId: "remote",
      fileId: "new",
      clientUpdatedAt: "2026-10-09T11:00:00Z",
      locator: { ...anchor.locator, fileHash: newHash, totalProgression: 0.6 },
    };
    const input = continueTarget({
      ebookId: "book",
      excluded: false,
      deviceId: "local",
      preferredFileId: "new",
      files: [old, replacement],
      positions: [remote, anchor],
    })!;
    const api = engine({
      status: "approximate",
      locator: { ...anchor.locator, fileHash: newHash },
    });
    const landing = await resolveContinueAnchor(input, api);
    expect(landing!.clientUpdatedAt).toBe(anchor.clientUpdatedAt);
    expect(input.newestOtherAnchor).toBe(remote);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator);
  });
  it("refuses a differently opened target and never returns another file's percentage", async () => {
    const api = engine({
      status: "healed",
      locator: { ...anchor.locator, fileHash: newHash },
    });
    api.currentLocator.mockReturnValue({
      ...anchor.locator,
      fileHash: "ef".repeat(32),
    });
    await expect(resolveContinueAnchor(descriptor, api)).rejects.toThrow(
      "different file",
    );
    expect(api.resolve).not.toHaveBeenCalled();
  });
  it("does not claim success without a valid observed target landing", async () => {
    const api = engine({ status: "failed", locator: null });
    api.currentLocator.mockReturnValue(null);
    await expect(resolveContinueAnchor(descriptor, api)).rejects.toThrow(
      "could not be resumed",
    );
  });
  it("does not silently accept an ignored fallback that leaves saved 44% at zero", async () => {
    const api = engine({ status: "failed", locator: null });
    api.goTo.mockResolvedValue(undefined);
    await expect(resolveContinueAnchor(descriptor, api)).rejects.toThrow(
      "could not be resumed",
    );
  });
  it("performs no engine operation for Read without a saved position", async () => {
    const api = engine({ status: "failed", locator: null });
    expect(
      await resolveContinueAnchor({ ...descriptor, anchor: null }, api),
    ).toBeNull();
    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.goTo).not.toHaveBeenCalled();
  });
});

const sameFile = { target: { id: old.id, sha256: oldHash }, anchor };
const source: BookSource = {
  ebookId: "book", fileId: old.id, format: "epub", size: old.sizeBytes, sha256: oldHash,
  url: "https://cdn.invalid/book.epub", fallbackUrl: "/api/ebooks/files/old",
};
const options: Omit<OpenOptions, "at"> = { container: {} as HTMLElement, presentation: {} as OpenOptions["presentation"] };
function initialEngine(openResult: ResolveResult | null = { status: "exact", locator: anchor.locator }) {
  let current: DurtalLocator | null = { ...anchor.locator, totalProgression: 0, cfi: "epubcfi(/6/2!/4/2)" };
  const rendered: (string | undefined)[] = [];
  const api = {
    open: vi.fn<ReaderEngine["open"]>().mockImplementation(async (_source, request) => {
      current = { ...current!, fileHash: _source.sha256 };
      if (request.at && "v" in request.at && openResult?.locator && openResult.status !== "failed") current = request.at;
      rendered.push(current?.cfi);
      return { resolved: openResult };
    }),
    resolve: vi.fn<ReaderEngine["resolve"]>().mockResolvedValue({ status: "exact", locator: anchor.locator }),
    goTo: vi.fn<ReaderEngine["goTo"]>().mockImplementation(async target => {
      if ("v" in target) current = target;
      else if ("fraction" in target) current = { ...anchor.locator, totalProgression: target.fraction };
    }),
    currentLocator: vi.fn<ReaderEngine["currentLocator"]>().mockImplementation(() => current),
  };
  return { api, rendered };
}
describe("initial saved-CFI opening", () => {
  it("renders the requested saved place first and reuses only its bound exact open result", async () => {
    const { api, rendered } = initialEngine();
    const original = JSON.stringify(anchor);
    const opened = await openReaderForContinue(sameFile, api, source, options);
    const landing = await resolveContinueAnchor(sameFile, api, opened);
    expect(api.open).toHaveBeenCalledOnce();
    expect(api.open.mock.calls[0][1].at).toBe(anchor.locator);
    expect(rendered).toEqual([anchor.locator.cfi]);
    expect(api.resolve).not.toHaveBeenCalled(); expect(api.goTo).not.toHaveBeenCalled();
    expect(landing).toMatchObject({ status: "exact", locator: anchor.locator, percent: 44,
      sourceFileId: old.id, sourceHash: oldHash, targetFileId: old.id, clientUpdatedAt: anchor.clientUpdatedAt });
    expect(JSON.stringify(anchor)).toBe(original);
  });
  it("uses the observed canonical landing rather than overwriting it with an old viewport range", async () => {
    const { api } = initialEngine();
    const opened = await openReaderForContinue(sameFile, api, source, options);
    const canonical = { ...anchor.locator, cfi: "epubcfi(/6/8!/4,/2/1:0,/4/1:64)", totalProgression: .441 };
    api.currentLocator.mockReturnValue(canonical);
    expect((await resolveContinueAnchor(sameFile, api, opened))?.locator).toBe(canonical);
    expect(api.goTo).not.toHaveBeenCalled();
  });
  it("keeps cross-file projection on the original resolve/navigation path and preserves source provenance", async () => {
    const { api } = initialEngine(null);
    const newSource = { ...source, fileId: replacement.id, sha256: newHash };
    const healed = { ...anchor.locator, fileHash: newHash, cfi: "epubcfi(/6/8!/4/4)" };
    api.resolve.mockResolvedValue({ status: "healed", locator: healed });
    const opened = await openReaderForContinue(descriptor, api, newSource, options);
    expect(opened).toBeUndefined(); expect(api.open.mock.calls[0][1]).toBe(options);
    const landing = await resolveContinueAnchor(descriptor, api, opened);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator); expect(api.goTo).toHaveBeenCalledWith(healed);
    expect(landing).toMatchObject({ sourceHash: oldHash, sourceFileId: "old", targetFileId: "new", clientUpdatedAt: anchor.clientUpdatedAt });
  });
  it("restores through the original resolver if an engine returns no initial resolution", async () => {
    const { api } = initialEngine(null);
    const opened = await openReaderForContinue(sameFile, api, source, options);
    expect(api.currentLocator()?.totalProgression).toBe(0);
    const landing = await resolveContinueAnchor(sameFile, api, opened);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator); expect(api.goTo).toHaveBeenCalledWith(anchor.locator);
    expect(landing?.locator).toBe(anchor.locator);
  });
  it("retains fractional fallback and its original clock when initial resolution fails", async () => {
    const { api } = initialEngine({ status: "failed", locator: null });
    api.resolve.mockResolvedValue({ status: "failed", locator: null });
    const opened = await openReaderForContinue(sameFile, api, source, options);
    const landing = await resolveContinueAnchor(sameFile, api, opened);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator); expect(api.goTo).toHaveBeenCalledWith({ fraction: .44 });
    expect(landing).toMatchObject({ status: "approximate", percent: 44, clientUpdatedAt: anchor.clientUpdatedAt });
  });
  it("does not turn healed/approximate or mismatched exact results into a skipped restore", async () => {
    for (const result of [
      { status: "healed" as const, locator: anchor.locator },
      { status: "approximate" as const, locator: anchor.locator },
      { status: "exact" as const, locator: { ...anchor.locator, cfi: "epubcfi(/6/8!/4/4)" } },
      { status: "exact" as const, locator: { ...anchor.locator, fileHash: newHash } },
    ]) {
      const { api } = initialEngine(result);
      const opened = await openReaderForContinue(sameFile, api, source, options);
      await resolveContinueAnchor(sameFile, api, opened);
      expect(api.resolve).toHaveBeenCalledWith(anchor.locator); expect(api.goTo).toHaveBeenCalledWith(anchor.locator);
    }
  });
  it("refuses to reuse an open receipt for a different anchor request", async () => {
    const { api } = initialEngine();
    const opened = await openReaderForContinue(sameFile, api, source, options);
    const newer = { ...sameFile, anchor: { ...anchor, clientUpdatedAt: "2026-10-09T11:00:00Z" } };
    const landing = await resolveContinueAnchor(newer, api, opened);
    expect(api.resolve).toHaveBeenCalledWith(anchor.locator); expect(api.goTo).toHaveBeenCalledWith(anchor.locator);
    expect(landing?.clientUpdatedAt).toBe(newer.anchor.clientUpdatedAt);
  });
  it("rejects a missing or foreign observed landing even after exact initial resolution", async () => {
    for (const current of [null, { ...anchor.locator, fileHash: newHash }]) {
      const { api } = initialEngine();
      const opened = await openReaderForContinue(sameFile, api, source, options);
      api.currentLocator.mockReturnValue(current);
      await expect(resolveContinueAnchor(sameFile, api, opened)).rejects.toThrow();
      expect(api.goTo).not.toHaveBeenCalled();
    }
  });
  it("propagates cancelled opening without a retry, fallback navigation, or publication receipt", async () => {
    const { api } = initialEngine();
    const cancelled = new DOMException("Cancelled", "AbortError");
    api.open.mockRejectedValue(cancelled);
    await expect(openReaderForContinue(sameFile, api, source, options)).rejects.toBe(cancelled);
    expect(api.open).toHaveBeenCalledOnce(); expect(api.resolve).not.toHaveBeenCalled(); expect(api.goTo).not.toHaveBeenCalled();
  });
  it("opens normally without at for no anchor, no CFI, invalid source binding, or non-EPUB input", async () => {
    for (const [input, bytes] of [
      [{ ...sameFile, anchor: null }, source],
      [{ ...sameFile, anchor: { ...anchor, locator: { ...anchor.locator, cfi: undefined } } }, source],
      [sameFile, { ...source, fileId: "different" }],
      [sameFile, { ...source, sha256: newHash }],
      [sameFile, { ...source, format: "pdf" as const }],
      [{ ...sameFile, anchor: { ...anchor, locator: { ...anchor.locator, totalProgression: NaN } } }, source],
    ] as const) {
      const { api } = initialEngine(null);
      expect(await openReaderForContinue(input, api, bytes, options)).toBeUndefined();
      expect(api.open.mock.calls[0][1]).toBe(options);
    }
  });
});
