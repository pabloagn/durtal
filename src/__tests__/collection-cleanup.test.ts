import { describe, it, expect, vi, beforeEach } from "vitest";
import { ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
const mocks = vi.hoisted(() => ({ send: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/s3/client", () => ({
  s3: { send: mocks.send },
  S3_BUCKET: "local-test",
}));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));
import { cleanupCollectionArtwork } from "@/lib/s3/collection-cleanup";
const id = "10000000-0000-4000-8000-000000000001";
const own = `gold/media/collection/${id}/poster/a.webp`;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue([]);
});
describe("collection artwork deletion boundaries", () => {
  it("never deletes borrowed book artwork or keys outside its collection namespace", async () => {
    mocks.send.mockImplementation(async (command) =>
      command instanceof ListObjectsV2Command
        ? { Contents: [{ Key: "gold/covers/another-book/cover.webp" }] }
        : {},
    );
    expect(
      await cleanupCollectionArtwork(id, [
        "gold/covers/another-book/cover.webp",
      ]),
    ).toBe(false);
    expect(
      mocks.send.mock.calls.every(([c]) => c instanceof ListObjectsV2Command),
    ).toBe(true);
  });
  it("preserves an owned key still referenced by another record", async () => {
    mocks.send.mockResolvedValue({ Contents: [] });
    mocks.execute.mockResolvedValue([{ k: own }]);
    expect(await cleanupCollectionArtwork(id, [own])).toBe(false);
    expect(
      mocks.send.mock.calls.some(([c]) => c instanceof DeleteObjectsCommand),
    ).toBe(false);
  });
  it("lists paginated objects and deletes only unreferenced assets", async () => {
    mocks.send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        if (
          command.input.Prefix?.startsWith("gold") &&
          !command.input.ContinuationToken
        )
          return {
            Contents: [{ Key: own }],
            IsTruncated: true,
            NextContinuationToken: "next",
          };
        return { Contents: [] };
      }
      return {};
    });
    expect(await cleanupCollectionArtwork(id, [])).toBe(false);
    const deletes = mocks.send.mock.calls.filter(
      ([c]) => c instanceof DeleteObjectsCommand,
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].input.Delete.Objects).toEqual([{ Key: own }]);
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it("reports partial S3 failure without deleting settings for failed objects", async () => {
    mocks.send.mockImplementation(async (command) =>
      command instanceof ListObjectsV2Command
        ? { Contents: [] }
        : { Errors: [{ Key: own, Code: "AccessDenied" }] },
    );
    expect(await cleanupCollectionArtwork(id, [own])).toBe(true);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("reports connection failures instead of pretending cleanup succeeded", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.send.mockRejectedValue(new Error("offline"));
    expect(await cleanupCollectionArtwork(id, [own])).toBe(true);
    log.mockRestore();
  });
});
