import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
const send = vi.hoisted(() =>
  vi.fn(async (command: unknown) =>
    command instanceof ListObjectsV2Command
      ? { Contents: [{ Key: `${command.input.Prefix}a.webp` }], IsTruncated: false }
      : { Errors: [] },
  ),
);
const execute = vi.hoisted(() => vi.fn(async () => ({ rows: [] as { k: string }[] })));
vi.mock("@/lib/s3/client", () => ({ s3: { send }, S3_BUCKET: "local-test" }));
vi.mock("@/lib/db", () => ({ db: { execute } }));
import { cleanupCollectionArtwork } from "@/lib/s3/collection-cleanup";
import { previewDeleteMany, previewList } from "@/lib/s3/preview-dir";

/* The preview's S3 folder answers the delete cleanup's listing and batch
   delete (SLN-549), so a preview delete removes its files and says nothing
   is left; without the folder the cleanup still goes to the S3 client. */

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";

function folderWith(keys: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "durtal-s3-"));
  for (const key of keys) {
    mkdirSync(dirname(join(dir, key)), { recursive: true });
    writeFileSync(join(dir, key), "x");
  }
  return dir;
}

afterEach(() => {
  delete process.env.DURTAL_PREVIEW_S3_DIR;
  send.mockClear();
  execute.mockReset();
  execute.mockImplementation(async () => ({ rows: [] }));
});

describe("the preview's S3 folder under the delete cleanup", () => {
  it("lists the keys that start with a prefix, as S3 does", async () => {
    const dir = folderWith([
      `gold/media/collection/${id}/a.webp`,
      `gold/media/collection/${id}/thumbs/a.webp`,
      `gold/media/collection/${id}/b.webp`,
      `gold/media/collection/${other}/c.webp`,
      `ebooks/files/${id}/book.epub`,
    ]);
    try {
      expect(await previewList(dir, `gold/media/collection/${id}/`)).toEqual([
        `gold/media/collection/${id}/a.webp`,
        `gold/media/collection/${id}/b.webp`,
        `gold/media/collection/${id}/thumbs/a.webp`,
      ]);
      expect(await previewList(dir, `gold/media/collection/${id}/a`)).toEqual([`gold/media/collection/${id}/a.webp`]);
      expect(await previewList(dir, `bronze/media/collection/${id}/`)).toEqual([]);
      await expect(previewList(dir, "../")).rejects.toThrow(/leaves the preview folder/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("batch-deletes as DeleteObjects answers: a missing key is deleted, a refused one is an error", async () => {
    const dir = folderWith(["gold/a.webp"]);
    try {
      const { Errors } = await previewDeleteMany(dir, ["gold/a.webp", "gold/missing.webp", "../outside.webp"]);
      expect(Errors.map((e) => e.Key)).toEqual(["../outside.webp"]);
      expect(existsSync(join(dir, "gold/a.webp"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("removes a deleted collection's unused files and reports nothing left", async () => {
    const kept = `gold/media/collection/${id}/kept.webp`;
    const dir = folderWith([
      `gold/media/collection/${id}/cover.webp`,
      `gold/media/collection/${id}/cover-thumb.webp`,
      `bronze/media/collection/${id}/upload.jpg`,
      kept,
      `gold/media/collection/${other}/cover.webp`,
    ]);
    // A row elsewhere still stores one key: it stays
    execute.mockImplementation(async () => ({ rows: [{ k: kept }] }));
    try {
      process.env.DURTAL_PREVIEW_S3_DIR = dir;
      expect(await cleanupCollectionArtwork(id, [`gold/media/collection/${id}/cover.webp`])).toBe(false);
      expect(await previewList(dir, "")).toEqual([kept, `gold/media/collection/${other}/cover.webp`]);
      expect(send).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists and deletes through the S3 client without the folder", async () => {
    expect(await cleanupCollectionArtwork(id, [])).toBe(false);
    const commands = send.mock.calls.map(([command]) => command);
    expect(commands.filter((c) => c instanceof ListObjectsV2Command)).toHaveLength(2);
    const deletes = commands.filter((c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand);
    expect(deletes.flatMap((c) => c.input.Delete?.Objects?.map((o) => o.Key))).toEqual([
      `gold/media/collection/${id}/a.webp`,
      `bronze/media/collection/${id}/a.webp`,
    ]);
  });
});
