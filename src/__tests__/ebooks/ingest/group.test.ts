import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseName, groupFiles, walkRoots } from "@/lib/ebooks/ingest/group";
import { planIngest } from "@/lib/ebooks/ingest/plan";
import type { Db } from "@/lib/catalogue/work-store";
import { makeEpub, makePdf, makeSidecarOpf } from "../../fixtures/ebook-builders";

/* SLN-494: which files a run looks at, and which belong to one e-book */

let dir: string;
const put = (relative: string, data: string | Uint8Array) => {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
  return file;
};
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ingest-group-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** An empty catalogue: what the plan reads when nothing is stored yet */
const emptyCatalogue = { select: () => ({ from: () => Object.assign(Promise.resolve([]), { where: async () => [] }) }) } as unknown as Db;
const target = { database: "test", bucket: "durtal-ebooks", prefix: "", preview: true };

describe("walkRoots", () => {
  it("skips hidden files, .DS_Store, sidecars, cover.jpg and symlinks out of the roots", async () => {
    put("a/Nadja.epub", "x");
    put("a/.DS_Store", "x");
    put("a/.hidden.epub", "x");
    put("a/cover.jpg", "x");
    put("a/metadata.opf", "<package/>");
    const outside = mkdtempSync(path.join(tmpdir(), "ingest-outside-"));
    writeFileSync(path.join(outside, "far.epub"), "x");
    symlinkSync(path.join(outside, "far.epub"), path.join(dir, "a", "link.epub"));
    symlinkSync(path.join(dir, "a", "Nadja.epub"), path.join(dir, "inside.epub"));
    try {
      const { files, sidecars } = await walkRoots([dir]);
      expect(files.map((f) => path.relative(dir, f.path)).sort()).toEqual(["a/Nadja.epub", "inside.epub"]);
      expect([...sidecars.keys()]).toEqual([path.join(dir, "a")]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("leaves out what --exclude names", async () => {
    put("keep/one.epub", "x");
    put("drafts/two.epub", "x");
    const { files } = await walkRoots([dir], { exclude: ["drafts/**"] });
    expect(files.map((f) => path.relative(dir, f.path))).toEqual(["keep/one.epub"]);
  });
});

describe("groupFiles", () => {
  const file = (p: string, sha: string, sidecar = false) => ({ path: path.join(dir, p), folder: path.dirname(path.join(dir, p)), name: path.basename(p), sha256: sha, sidecar });

  it("makes a sidecar folder one e-book, whatever the names", () => {
    const { groups } = groupFiles([file("s/Book.epub", "1".repeat(64), true), file("s/Other name.pdf", "2".repeat(64), true)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ sidecar: true, paths: [path.join(dir, "s/Book.epub"), path.join(dir, "s/Other name.pdf")] });
  });

  it("groups same base names in one folder, and nothing else", () => {
    const { groups } = groupFiles([file("f/Nadja.epub", "1".repeat(64)), file("f/Nadja.pdf", "2".repeat(64)), file("f/Arcane 17.epub", "3".repeat(64)), file("g/Nadja.epub", "4".repeat(64))]);
    expect(groups.map((g) => g.paths.map((p) => path.relative(dir, p)))).toEqual([["f/Arcane 17.epub"], ["f/Nadja.epub", "f/Nadja.pdf"], ["g/Nadja.epub"]]);
    expect(baseName("Nadja.kepub.epub")).toBe("nadja");
  });

  it("stores the same bytes once, the path in a sidecar folder first", () => {
    const { groups, duplicates } = groupFiles([file("a/copy.epub", "9".repeat(64)), file("z/book.epub", "9".repeat(64), true)]);
    expect(groups.flatMap((g) => g.paths)).toEqual([path.join(dir, "z/book.epub")]);
    expect(duplicates.get(path.join(dir, "a/copy.epub"))).toBe(path.join(dir, "z/book.epub"));
  });
});

describe("what the plan takes", () => {
  it("leaves text files outside a sidecar folder unless --include-text", async () => {
    put("loose/notes.txt", "Some notes, plain words.");
    put("sidecar/notes.txt", "Some other notes.");
    put("sidecar/metadata.opf", makeSidecarOpf({ title: "Notes", author: "Anna Vale", uuid: "7f3c1a52-1111-4a8e-9c1e-1a2b3c4d5e6f" }));
    put("loose/book.epub", makeEpub());
    put("loose/book.pdf", makePdf());
    const cacheDir = path.join(dir, ".cache");
    const plan = await planIngest([dir], { database: emptyCatalogue, host: "test", cacheDir, target });
    const outcome = (p: string) => plan.items.find((i) => i.path === path.join(dir, p));
    expect(outcome("loose/notes.txt")).toMatchObject({ outcome: "ignored", reason: "Text file, not taken; add --include-text to take it" });
    expect(outcome("sidecar/notes.txt")?.outcome).toBe("new_ebook");
    expect(plan.groups.find((g) => g.paths.includes(path.join(dir, "loose/book.epub")))?.paths).toHaveLength(2);

    const withText = await planIngest([dir], { database: emptyCatalogue, host: "test", cacheDir, target, includeText: true });
    expect(withText.items.find((i) => i.path === path.join(dir, "loose/notes.txt"))?.outcome).toBe("new_ebook");
  }, 60_000);
});
