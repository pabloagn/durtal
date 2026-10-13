import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Never use DATABASE_URL or load env files: this suite resets only its own local DB.
const url = process.env.DURTAL_EDITION_COVER_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln638_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln638_test"
  )
    throw new Error("Edition cover tests require disposable local sln638_test");
}
const client = url ? postgres(url, { prepare: false, max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), cached: (fn: unknown) => fn, CACHE_TAGS: {} }));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/net/safe-fetch", () => ({ safeFetchImage: vi.fn() }));
vi.mock("@/lib/s3/client", async () => ({
  S3_BUCKET: "local-test",
  s3: { send: (await import("../s3/cover-stage-fixture")).catalogueSend },
}));

import {
  replaceEditionCover,
  switchToBookCover,
  restoreEditionCover,
  isRestorableCover,
  COVER_CHANGED,
  COVER_UNREADABLE,
} from "@/lib/catalogue/edition-cover";
import { showBookCover, restoreOwnCover } from "@/lib/actions/edition-cover";
import { POST } from "@/app/api/editions/[id]/cover/route";
import { safeFetchImage } from "@/lib/net/safe-fetch";
import { recordActivity } from "@/lib/activity/record";
import { coverBucket, resetCoverBucket, realCoverBytes, mintCover } from "../s3/cover-stage-fixture";

const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!url)("an edition's own cover with PostgreSQL (SLN-638)", () => {
  const db = testDb!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln638_test");
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln638_test", { emptyLocations: true });
    resetCoverBucket();
    vi.clearAllMocks();
  }, 30000);

  async function book() {
    const [work] = await db
      .insert(schema.works)
      .values({ title: "The Book", catalogueStatus: "accessioned" })
      .returning();
    const [first, second] = await db
      .insert(schema.editions)
      .values([
        { workId: work.id, title: "First edition" },
        { workId: work.id, title: "Second edition" },
      ])
      .returning();
    return { work, first, second };
  }
  async function row(id: string) {
    return (await db.select().from(schema.editions).where(eq(schema.editions.id, id)))[0];
  }
  /** An own cover already published on the edition, as a match save leaves it */
  async function withOwnCover(editionId: string, background = "#224466") {
    const stage = await mintCover(editionId, "https://example.com/old.jpg", background);
    await db
      .update(schema.editions)
      .set({
        coverS3Key: stage.coverKey,
        thumbnailS3Key: stage.thumbnailKey,
        coverSourceUrl: "https://example.com/old.jpg",
        coverPalette: stage.palette,
      })
      .where(eq(schema.editions.id, editionId));
    return stage;
  }
  const deletes = () =>
    coverBucket.calls.filter((c) => c instanceof DeleteObjectCommand || c instanceof DeleteObjectsCommand);
  function upload(id: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return POST(new NextRequest(`http://localhost/api/editions/${id}/cover`, { method: "POST", body }), {
      params: Promise.resolve({ id }),
    });
  }

  it("stores a chosen file as the edition's own cover, leaving the old one stored and the sibling as it was", async () => {
    const { first, second } = await book();
    const old = await withOwnCover(first.id);
    const before = await row(second.id);

    const { previous } = await replaceEditionCover(first.id, { kind: "file", bytes: await realCoverBytes("#aa3311") });

    const after = await row(first.id);
    expect(after.coverS3Key).toMatch(new RegExp(`^gold/media/edition/${first.id}/`));
    expect(after.coverS3Key).not.toBe(old.coverKey);
    expect(after.thumbnailS3Key).not.toBe(old.thumbnailKey);
    expect(coverBucket.objects.has(after.coverS3Key!)).toBe(true);
    expect(coverBucket.objects.has(after.thumbnailS3Key!)).toBe(true);
    expect(after.coverSourceUrl).toBeNull();
    expect(after.coverPalette).not.toBeNull();
    expect(previous).toEqual({
      coverS3Key: old.coverKey,
      thumbnailS3Key: old.thumbnailKey,
      coverSourceUrl: "https://example.com/old.jpg",
    });
    // The old bytes stay stored, nothing is deleted, and the sibling is untouched
    expect(coverBucket.objects.has(old.coverKey)).toBe(true);
    expect(deletes()).toEqual([]);
    expect(await row(second.id)).toEqual(before);
    expect(recordActivity).toHaveBeenCalledWith("work", first.workId, "work.edition_updated", { targetId: first.id });
  });

  it("stores an image address through the safe fetch and keeps the address", async () => {
    const { first } = await book();
    vi.mocked(safeFetchImage).mockResolvedValue({ buffer: await realCoverBytes(), contentType: "image/png" } as never);

    await replaceEditionCover(first.id, { kind: "url", url: "https://example.com/new.png" });

    expect(safeFetchImage).toHaveBeenCalledWith("https://example.com/new.png", { allowHttp: true });
    const after = await row(first.id);
    expect(after.coverS3Key).toMatch(new RegExp(`^gold/media/edition/${first.id}/`));
    expect(after.coverSourceUrl).toBe("https://example.com/new.png");
  });

  it("refuses an image it cannot read and leaves the edition as it was", async () => {
    const { first } = await book();
    await withOwnCover(first.id);
    const before = await row(first.id);

    await expect(
      replaceEditionCover(first.id, { kind: "file", bytes: Buffer.from("not an image") }),
    ).rejects.toThrow(COVER_UNREADABLE);
    vi.mocked(safeFetchImage).mockRejectedValue(new Error("404"));
    await expect(
      replaceEditionCover(first.id, { kind: "url", url: "https://example.com/gone.png" }),
    ).rejects.toThrow(COVER_UNREADABLE);

    expect(await row(first.id)).toEqual(before);
    expect(deletes()).toEqual([]);
  });

  it("refuses when the edition changed while the image was stored, keeping both covers' bytes", async () => {
    const { first } = await book();
    const old = await withOwnCover(first.id);
    vi.mocked(safeFetchImage).mockImplementation(async () => {
      await db.update(schema.editions).set({ title: "Renamed meanwhile" }).where(eq(schema.editions.id, first.id));
      return { buffer: await realCoverBytes("#00aa00"), contentType: "image/png" } as never;
    });

    await expect(
      replaceEditionCover(first.id, { kind: "url", url: "https://example.com/race.png" }),
    ).rejects.toThrow(COVER_CHANGED);

    const after = await row(first.id);
    expect([after.title, after.coverS3Key, after.thumbnailS3Key]).toEqual([
      "Renamed meanwhile",
      old.coverKey,
      old.thumbnailKey,
    ]);
    expect(coverBucket.objects.has(old.coverKey)).toBe(true);
    expect(deletes()).toEqual([]);
  });

  it("switches to the book's cover and puts the edition's own cover back", async () => {
    const { first, second } = await book();
    const old = await withOwnCover(first.id);
    await withOwnCover(second.id, "#553311");
    const sibling = await row(second.id);

    const { previous, restorable } = await showBookCover(first.id);
    expect(restorable).toBe(true);
    let after = await row(first.id);
    expect([after.coverS3Key, after.thumbnailS3Key, after.coverSourceUrl, after.coverPalette, after.coverColorBucket])
      .toEqual([null, null, null, null, null]);
    expect(coverBucket.objects.has(old.coverKey)).toBe(true);
    expect(await row(second.id)).toEqual(sibling);

    // A second switch has nothing to replace
    expect(await showBookCover(first.id)).toEqual({ previous: null, restorable: false });

    await restoreOwnCover(first.id, previous!);
    after = await row(first.id);
    expect([after.coverS3Key, after.thumbnailS3Key, after.coverSourceUrl]).toEqual([
      old.coverKey,
      old.thumbnailKey,
      "https://example.com/old.jpg",
    ]);
    expect(after.coverPalette).not.toBeNull();
    expect(deletes()).toEqual([]);
  });

  it("puts back only the edition's own stored images, and only while it shows the book's cover", async () => {
    const { first, second } = await book();
    const own = await withOwnCover(first.id);
    const other = await mintCover(second.id);
    const cover = { coverS3Key: own.coverKey, thumbnailS3Key: own.thumbnailKey, coverSourceUrl: null };

    // Still showing its own cover: nothing to put back over
    await expect(restoreEditionCover(first.id, cover)).rejects.toThrow(COVER_CHANGED);
    await switchToBookCover(first.id);

    for (const foreign of [
      { ...cover, coverS3Key: other.coverKey },
      { ...cover, thumbnailS3Key: `gold/media/work/${first.workId}/poster.webp` },
      { ...cover, coverS3Key: `gold/media/edition/${first.id}/../${second.id}/cover.webp` },
      { coverS3Key: null, thumbnailS3Key: null, coverSourceUrl: null },
    ]) {
      expect(isRestorableCover(first.id, foreign)).toBe(false);
      await expect(restoreEditionCover(first.id, foreign)).rejects.toThrow("can no longer be put back");
    }
    // The action's schema refuses anything but the three keys
    await expect(restoreOwnCover(first.id, { ...cover, extra: 1 } as never)).rejects.toThrow();

    // Bytes no longer stored
    coverBucket.objects.delete(own.thumbnailKey);
    await expect(restoreEditionCover(first.id, cover)).rejects.toThrow("can no longer be put back");
    expect((await row(first.id)).coverS3Key).toBeNull();
  });

  it("reports a foreign own cover as not restorable when switching", async () => {
    const { first, second } = await book();
    const other = await withOwnCover(second.id);
    // A shared key copied from another edition, as an old import may have left it
    await db
      .update(schema.editions)
      .set({ coverS3Key: other.coverKey, thumbnailS3Key: other.thumbnailKey })
      .where(eq(schema.editions.id, first.id));

    const result = await showBookCover(first.id);
    expect(result.restorable).toBe(false);
    expect(result.previous?.coverS3Key).toBe(other.coverKey);
    expect((await row(second.id)).coverS3Key).toBe(other.coverKey);
  });

  it("answers the cover route with the right status for each outcome", async () => {
    const { first } = await book();
    const png = new File([new Uint8Array(await realCoverBytes())], "cover.png", { type: "image/png" });

    const saved = await upload(first.id, png);
    expect(saved.status).toBe(200);
    expect((await row(first.id)).coverS3Key).toMatch(new RegExp(`^gold/media/edition/${first.id}/`));

    expect((await upload("not-a-uuid", png)).status).toBe(400);
    expect((await upload(MISSING, png)).status).toBe(404);
    expect((await upload(first.id, new File(["<svg/>"], "cover.svg", { type: "image/svg+xml" }))).status).toBe(400);
    expect((await upload(first.id, new File([], "empty.png", { type: "image/png" }))).status).toBe(400);
    expect((await upload(first.id, new File(["junk"], "junk.png", { type: "image/png" }))).status).toBe(422);

    const json = (body: unknown) =>
      POST(
        new NextRequest(`http://localhost/api/editions/${first.id}/cover`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: first.id }) },
      );
    expect((await json({ imageUrl: "not a url" })).status).toBe(400);
    expect((await json({ imageUrl: "https://example.com/a.png", entityId: "x" })).status).toBe(400);
    vi.mocked(safeFetchImage).mockResolvedValue({ buffer: await realCoverBytes("#334455"), contentType: "image/png" } as never);
    expect((await json({ imageUrl: "https://example.com/a.png" })).status).toBe(200);
    expect((await row(first.id)).coverSourceUrl).toBe("https://example.com/a.png");
  });
});
