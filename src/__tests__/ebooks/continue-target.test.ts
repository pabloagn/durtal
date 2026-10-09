import { describe, expect, it } from "vitest";
import {
  continueTarget,
  type ContinueAnchor,
  type ContinueFile,
} from "@/lib/ebooks/continue-target";
import { ebookFileKey } from "@/lib/ebooks/keys";

const ebookId = "book";
const sha = "ab".repeat(32);
const epub: ContinueFile = {
  id: "epub",
  ebookId,
  sha256: sha,
  s3Key: ebookFileKey(sha, "epub"),
  format: "epub",
  status: "stored",
  drm: null,
  createdAt: "2026-10-09T09:00:00Z",
};
const pdfHash = "ef".repeat(32);
const pdf: ContinueFile = {
  ...epub,
  id: "pdf",
  sha256: pdfHash,
  format: "pdf",
  s3Key: ebookFileKey(pdfHash, "pdf"),
};
const local: ContinueAnchor = {
  deviceId: "local",
  deviceLabel: "Mac · Safari",
  fileId: "epub",
  chapter: "Chapter 4",
  clientUpdatedAt: "2026-10-09T10:00:00Z",
  locator: {
    v: 1,
    fileHash: sha,
    href: "chapter4.xhtml",
    sectionIndex: 3,
    progression: 0.2,
    totalProgression: 0.44,
    cfi: "epubcfi(/6/8!/4/2)",
    text: {
      before: "before",
      highlight: "The paragraph I was reading",
      after: "after",
    },
  },
};
const remote: ContinueAnchor = {
  ...local,
  deviceId: "remote",
  deviceLabel: "iPhone · Safari",
  fileId: "pdf",
  clientUpdatedAt: "2026-10-09T11:00:00Z",
  locator: { ...local.locator, fileHash: pdfHash, totalProgression: 0.6 },
};
const input = {
  ebookId,
  excluded: false,
  deviceId: "local",
  preferredFileId: "pdf",
  files: [epub, pdf],
  positions: [remote, local],
};

describe("Continue target and historical anchor", () => {
  it("pins local EPUB 44% while retaining newer remote PDF for the existing offer policy", () => {
    const result = continueTarget(input)!;
    expect(result.href).toBe("/reader/book?file=epub");
    expect(result.anchor).toBe(local);
    expect(result.newestOtherAnchor).toBe(remote);
    expect(result).toMatchObject({
      projection: "same-file",
      savedPercent: 44,
      targetPercent: 44,
    });
  });
  it("keeps Continue independent of a preferred-file change", () => {
    expect(continueTarget({ ...input, preferredFileId: "epub" })!.href).toBe(
      continueTarget(input)!.href,
    );
    const result = continueTarget({ ...input, positions: [] })!;
    expect(result).toMatchObject({
      target: pdf,
      anchor: null,
      projection: "none",
      savedPercent: null,
      targetPercent: null,
    });
  });
  it("uses the newest remote anchor when the device has no local history", () => {
    expect(continueTarget({ ...input, deviceId: "new-device" })).toMatchObject({
      target: pdf,
      anchor: remote,
      localAnchor: null,
      targetPercent: 60,
    });
  });
  it("retains a replaced-only local position and binds it to eligible replacement bytes", () => {
    const old = { ...epub, status: "replaced" };
    const replacement = {
      ...epub,
      id: "new-epub",
      sha256: "cd".repeat(32),
      s3Key: ebookFileKey("cd".repeat(32), "epub"),
    };
    const result = continueTarget({
      ...input,
      preferredFileId: replacement.id,
      files: [old, replacement],
      positions: [local],
    })!;
    expect(result).toMatchObject({
      target: replacement,
      anchor: local,
      projection: "pending-reanchor",
      savedPercent: 44,
      targetPercent: null,
    });
    expect(result.href).toBe("/reader/book?file=new-epub");
    expect(result.anchor!.locator).toBe(local.locator);
    expect(result.anchor!.clientUpdatedAt).toBe(local.clientUpdatedAt);
    expect(result.anchor!.locator.fileHash).toBe(sha);
  });
  it("preserves quote context for inserted-paragraph replacement healing", () => {
    const result = continueTarget({
      ...input,
      files: [{ ...epub, status: "replaced" }, pdf],
    })!;
    expect(result.projection).toBe("pending-reanchor");
    expect(result.anchor!.locator.text).toEqual(local.locator.text);
    expect(result.anchor!.locator.cfi).toBe(local.locator.cfi);
    expect(result.targetPercent).toBeNull();
  });
  it("keeps the local historical anchor and remote offer input during cross-format projection", () => {
    const result = continueTarget({
      ...input,
      files: [{ ...epub, status: "replaced" }, pdf],
    })!;
    expect(result).toMatchObject({
      target: pdf,
      localAnchor: local,
      newestOtherAnchor: remote,
      savedPercent: 44,
      targetPercent: null,
    });
    expect(result.anchor!.clientUpdatedAt).not.toBe(remote.clientUpdatedAt);
  });
  it("orders by client clock rather than arrival order and uses deterministic ties", () => {
    const delayed = {
      ...local,
      clientUpdatedAt: "2026-10-09T09:30:00Z",
      locator: { ...local.locator, totalProgression: 0.1 },
    };
    expect(
      continueTarget({ ...input, positions: [local, delayed] })!.savedPercent,
    ).toBe(44);
    const tied = {
      ...local,
      fileId: "pdf",
      locator: { ...local.locator, fileHash: pdfHash },
    };
    expect(
      continueTarget({ ...input, positions: [tied, local] })!.anchor!.fileId,
    ).toBe("epub");
    expect(
      continueTarget({ ...input, positions: [local, tied] })!.anchor!.fileId,
    ).toBe("epub");
  });
  it("refuses foreign-book and mismatched-hash anchors without discarding valid history", () => {
    const foreign = { ...epub, id: "foreign", ebookId: "another-book" };
    const invalid = { ...remote, fileId: "foreign" };
    const wrongHash = {
      ...remote,
      locator: { ...remote.locator, fileHash: "ff".repeat(32) },
    };
    expect(
      continueTarget({
        ...input,
        files: [foreign, epub],
        positions: [invalid, wrongHash, local],
      })!.anchor,
    ).toBe(local);
  });
  it("ignores invalid timestamps and progression", () => {
    const positions = [
      { ...remote, clientUpdatedAt: "not-a-time" },
      {
        ...remote,
        locator: { ...remote.locator, totalProgression: Number.NaN },
      },
      { ...remote, locator: { ...remote.locator, totalProgression: 1.1 } },
      local,
    ];
    expect(continueTarget({ ...input, positions })!.anchor).toBe(local);
  });
  it.each(["missing", "quarantined", "replaced"])(
    "never opens %s bytes",
    (status) => {
      expect(
        continueTarget({
          ...input,
          files: [{ ...epub, status }],
          positions: [local],
        }),
      ).toBeNull();
    },
  );
  it("returns no action for excluded, protected-only or empty ebooks", () => {
    expect(continueTarget({ ...input, excluded: true })).toBeNull();
    expect(
      continueTarget({ ...input, files: [{ ...epub, drm: "kindle" }] }),
    ).toBeNull();
    expect(continueTarget({ ...input, files: [] })).toBeNull();
  });
  it("falls back to format preference with stable creation/id ties without mutating inputs", () => {
    const files = Object.freeze([pdf, { ...epub, id: "z-epub" }, epub]);
    const positions = Object.freeze([remote, local]);
    expect(
      continueTarget({ ...input, preferredFileId: null, positions: [], files })!
        .target.id,
    ).toBe("epub");
    continueTarget({ ...input, files, positions });
    expect(files.map((file) => file.id)).toEqual(["pdf", "z-epub", "epub"]);
    expect(positions[0]).toBe(remote);
  });
});
