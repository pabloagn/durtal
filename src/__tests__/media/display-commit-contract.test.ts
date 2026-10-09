import { beforeEach, describe, expect, it, vi } from "vitest";
import type { media } from "@/lib/db/schema";

const state = vi.hoisted(() => ({
  failure: null as Error | null,
  results: [] as unknown[],
  planned: [] as unknown[],
  cleanup: vi.fn(),
}));
vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/neon-http");
  const { neon } = await import("@neondatabase/serverless");
  const schema = await import("@/lib/db/schema");
  return {
    db: drizzle({ client: neon("postgresql://test@db.invalid/test"), schema }),
  };
});
vi.mock("@/lib/db/atomic", async () => {
  const { db } = await import("@/lib/db");
  return {
    atomic: async (build: (db: typeof import("@/lib/db").db) => unknown[]) => {
      // Build real Drizzle statements without executing them or reaching a database.
      state.planned = build(db);
      if (state.failure) throw state.failure;
      return state.results;
    },
  };
});
vi.mock("@/lib/s3/cleanup", () => ({ deleteUnusedObjects: state.cleanup }));

import { commitDisplay, type DisplayFiles } from "@/lib/media/display";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustments";
import { STALE_IMAGE_PRESENTATION } from "@/lib/media/presentation-revision";

const row = {
  id: "00000000-0000-0000-0000-000000000333",
  s3Key: "gold/media/fixture/old.webp",
  thumbnailS3Key: "gold/media/fixture/old_thumb.webp",
  uncroppedS3Key: null,
  originalS3Key: "gold/media/fixture/original.webp",
} as typeof media.$inferSelect;
const files: DisplayFiles = {
  s3Key: "gold/media/fixture/new.webp",
  thumbnailS3Key: "gold/media/fixture/new_thumb.webp",
  uncroppedS3Key: row.s3Key,
  appliedCrop: { x: 0, y: 0, zoom: 200 },
  width: 200,
  height: 300,
  created: ["gold/media/fixture/new.webp", "gold/media/fixture/new_thumb.webp"],
};

beforeEach(() => {
  state.failure = null;
  state.results = [];
  state.planned = [];
  state.cleanup.mockReset();
});

describe("guarded display commit result and cleanup boundaries", () => {
  it("discards only newly built derivatives when the transaction rejects a stale revision", async () => {
    state.failure = Object.assign(new Error(STALE_IMAGE_PRESENTATION), {
      code: "P0001",
    });
    await expect(
      commitDisplay(
        row,
        files,
        { brightness: 150 },
        { settings: DEFAULT_IMAGE_ADJUSTMENTS, monochrome: false },
        { revision: "a".repeat(32) },
      ),
    ).rejects.toThrow(STALE_IMAGE_PRESENTATION);
    expect(state.cleanup).toHaveBeenCalledExactlyOnceWith(
      { keys: files.created, prefixes: [] },
      "replaced media files",
    );
    expect(files.created).not.toContain(row.s3Key);
    expect(files.created).not.toContain(row.originalS3Key);
  });
  it("reads the media update and returned revision after the new lock/guard prefix", async () => {
    const updated = { ...row, ...files };
    const revision = "b".repeat(32);
    state.results = [[], [], [], [], [], [updated], [], [{ revision }]];
    expect(
      await commitDisplay(
        row,
        files,
        {},
        { settings: DEFAULT_IMAGE_ADJUSTMENTS, monochrome: false },
        { revision: "a".repeat(32) },
      ),
    ).toEqual({ ...updated, revision });
    expect(state.planned).toHaveLength(8);
    expect(state.cleanup).toHaveBeenCalledExactlyOnceWith(
      { keys: [row.thumbnailS3Key], prefixes: [] },
      "replaced media files",
    );
  });
  it("retains the existing unguarded maintenance return shape after adding shared locks", async () => {
    state.results = [[], [], [], [], [row], []];
    expect(await commitDisplay(row, null, { brightness: 100 })).toEqual(row);
    expect(state.planned).toHaveLength(6);
    expect(state.cleanup).not.toHaveBeenCalled();
  });
});
