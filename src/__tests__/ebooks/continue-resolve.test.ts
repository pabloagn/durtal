import { describe, expect, it, vi } from "vitest";
import type {
  DurtalLocator,
  ReaderEngine,
  ResolveResult,
} from "@/lib/reader/engine";
import { continueTarget } from "@/lib/ebooks/continue-target";
import { resolveContinueAnchor } from "@/lib/ebooks/continue-resolve";
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
