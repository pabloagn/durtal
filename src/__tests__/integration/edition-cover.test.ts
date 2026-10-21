import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
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
vi.mock("@/lib/net/safe-fetch", async (original) => ({
  ...(await original<typeof import("@/lib/net/safe-fetch")>()),
  safeFetchImage: vi.fn(),
}));
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
  editionCoverChoices,
  restoreSavedEditionCover,
} from "@/lib/catalogue/edition-cover";
import { showBookCover, restoreOwnCover, getEditionCoverPresentation, saveEditionCoverPresentation } from "@/lib/actions/edition-cover";
import { POST } from "@/app/api/editions/[id]/cover/route";
import { POST as saveForm } from "@/app/api/editions/form/route";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustments";
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
    // An image only by its name: SVG, TIFF or BMP bytes sent as a PNG are refused unread
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#a31"/></svg>';
    const disguised = new File([svg], "cover.png", { type: "image/png" });
    const kept = (await row(first.id)).coverS3Key;
    expect((await upload(first.id, disguised)).status).toBe(422);
    expect((await row(first.id)).coverS3Key).toBe(kept);

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
  it("restores a committed earlier choice after replacement and reload, without a client-held key", async () => {
      const { first } = await book();
      const old = await withOwnCover(first.id);
      await replaceEditionCover(first.id, {
        kind: "file",
        bytes: await realCoverBytes("#aa3311"),
      });
      const choices = await editionCoverChoices(first.id);
      expect(choices.history).toHaveLength(2);
      const earlier = choices.history.find(
        (item) => item.coverS3Key === old.coverKey,
      )!;
      await restoreSavedEditionCover(first.id, earlier.id, choices.revision);
      expect((await row(first.id)).coverS3Key).toBe(old.coverKey);
      await switchToBookCover(first.id);
      const reloaded = await editionCoverChoices(first.id);
      expect(reloaded.current.coverS3Key).toBeNull();
      expect(reloaded.history).toHaveLength(2);
      await restoreSavedEditionCover(first.id, earlier.id, reloaded.revision);
      expect((await row(first.id)).coverS3Key).toBe(old.coverKey);
      expect(deletes()).toEqual([]);
    });

    it("refuses unpublished keys, another edition's history and stale history restores", async () => {
      const { first, second } = await book();
      const other = await withOwnCover(second.id);
      const unpublished = await mintCover(first.id);
      await expect(
        restoreEditionCover(first.id, {
          coverS3Key: unpublished.coverKey,
          thumbnailS3Key: unpublished.thumbnailKey,
          coverSourceUrl: null,
        }),
      ).rejects.toThrow("can no longer be put back");
      const foreign = (await editionCoverChoices(second.id)).history.find(
        (cover) => cover.coverS3Key === other.coverKey,
      )!;
      const before = await editionCoverChoices(first.id);
      await expect(
        restoreSavedEditionCover(first.id, foreign.id, before.revision),
      ).rejects.toThrow("can no longer be put back");
      await withOwnCover(first.id);
      const selected = await editionCoverChoices(first.id);
      await db
        .update(schema.editions)
        .set({ title: "Changed elsewhere" })
        .where(eq(schema.editions.id, first.id));
      await expect(
        restoreSavedEditionCover(
          first.id,
          selected.history[0].id,
          selected.revision,
        ),
      ).rejects.toThrow(COVER_CHANGED);
    });

    it("records only committed publications and captures URL-form edits too", async () => {
      const { first } = await book();
      const initial = await withOwnCover(first.id);
      await expect(
        client!.begin(async (tx) => {
          await tx.unsafe("update editions set cover_s3_key='not-committed',thumbnail_s3_key=null where id=$1", [first.id]);
          throw new Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      const choices = await editionCoverChoices(first.id);
      expect(choices.history.map((choice) => choice.coverS3Key)).toEqual([
        initial.coverKey,
      ]);
      const bytes = await realCoverBytes("#cc9922");
      const form = new FormData();
      form.set("id", first.id);
      form.set("values", JSON.stringify({ title: "Edited together" }));
      form.set(
        "file",
        new File([new Uint8Array(bytes)], "cover.png", { type: "image/png" }),
      );
      expect(
        (
          await saveForm(
            new NextRequest("http://localhost/api/editions/form", {
              method: "POST",
              body: form,
            }),
          )
        ).status,
      ).toBe(200);
      expect((await row(first.id)).title).toBe("Edited together");
      expect((await editionCoverChoices(first.id)).history).toHaveLength(2);
    });

    async function poster(workId: string) {
      const key = `gold/media/work/${workId}/poster.webp`;
      coverBucket.objects.set(key, await realCoverBytes("#cc9922"));
      const [item] = await db
        .insert(schema.media)
        .values({
          workId,
          type: "poster",
          s3Key: key,
          thumbnailS3Key: key,
          cropX: 35,
          cropY: 55,
          cropZoom: 120,
          brightness: 110,
          contrast: 105,
        })
        .returning();
      return item;
    }
    const framed = {
      cropX: 40,
      cropY: 55,
      cropZoom: 160,
      turn: 0,
      straighten: 0,
    };

    it("opens and cancels inherited adjustments without writing; Save detaches only this edition", async () => {
      const { work, first, second } = await book();
      const parent = await poster(work.id);
      const parentBytes = Buffer.from(coverBucket.objects.get(parent.s3Key)!);
      const before = await row(first.id),
        sibling = await row(second.id);
      const presentation = await getEditionCoverPresentation(first.id);
      expect(await row(first.id)).toEqual(before);
      expect((await editionCoverChoices(first.id)).history).toEqual([]);
      expect(presentation.crop).toMatchObject({ cropX: 35, cropZoom: 120 });
      expect(presentation.preview).toContain("w=800");
      const saved = await saveEditionCoverPresentation(
        first.id,
        {
          settings: { ...presentation.settings, brightness: 145 },
          crop: framed,
        },
        presentation.revision,
      );
      expect(saved.assetKey).toMatch(
        new RegExp(`^gold/media/edition/${first.id}/`),
      );
      expect(await row(second.id)).toEqual(sibling);
      expect(
        (
          await db
            .select()
            .from(schema.media)
            .where(eq(schema.media.id, parent.id))
        )[0],
      ).toEqual(parent);
      expect(coverBucket.objects.get(parent.s3Key)).toEqual(parentBytes);
      const reopened = await getEditionCoverPresentation(first.id);
      expect(reopened.settings.brightness).toBe(145);
      expect(reopened.crop).toEqual(framed);
      const history = (await editionCoverChoices(first.id)).history[0];
      expect(history.originalS3Key).toMatch(
        new RegExp(`^gold/media/edition/${first.id}/`),
      );
      // Removing parent assets later cannot break the edition's independent original.
      coverBucket.objects.delete(parent.s3Key);
      await saveEditionCoverPresentation(
        first.id,
        {
          settings: DEFAULT_IMAGE_ADJUSTMENTS,
          crop: { cropX: 50, cropY: 50, cropZoom: 100, turn: 0, straighten: 0 },
        },
        reopened.revision,
      );
      expect((await editionCoverChoices(first.id)).history).toHaveLength(2);
      expect(deletes()).toEqual([]);
    });

    it("refuses changed parent artwork and rolls back history when adjustment publication fails", async () => {
      const { work, first } = await book();
      const parent = await poster(work.id);
      const old = await getEditionCoverPresentation(first.id);
      await db
        .update(schema.media)
        .set({ brightness: 90 })
        .where(eq(schema.media.id, parent.id));
      await expect(
        saveEditionCoverPresentation(
          first.id,
          { settings: old.settings, crop: framed },
          old.revision,
        ),
      ).rejects.toThrow(COVER_CHANGED);
      expect((await row(first.id)).coverS3Key).toBeNull();
      const fresh = await getEditionCoverPresentation(first.id);
      await db.execute(
        sql`create function reject_cover_test() returns trigger language plpgsql as $$begin raise exception 'injected write failure'; end$$`,
      );
      await db.execute(
        sql`create trigger reject_cover_test before insert on image_adjustments for each row execute function reject_cover_test()`,
      );
      await expect(
        saveEditionCoverPresentation(
          first.id,
          { settings: fresh.settings, crop: framed },
          fresh.revision,
        ),
      ).rejects.toThrow();
      expect((await row(first.id)).coverS3Key).toBeNull();
      expect((await editionCoverChoices(first.id)).history).toEqual([]);
      expect(deletes()).toEqual([]);
    });

    it("creates a new edition with its file in one transaction and refuses unreadable files without an edition", async () => {
      const { work } = await book();
      const form = (bytes: Uint8Array, title: string) => {
        const body = new FormData();
        body.set("values", JSON.stringify({ workId: work.id, title }));
        body.set("file", new File([new Uint8Array(bytes)], "cover.png", { type: "image/png" }));
        return new NextRequest("http://localhost/api/editions/form", {
          method: "POST",
          body,
        });
      };
      const response = await saveForm(
        form(new Uint8Array(await realCoverBytes()), "New file edition"),
      );
      expect(response.status).toBe(200);
      const saved = await response.json();
      expect((await row(saved.id)).coverS3Key).toBeTruthy();
      expect((await editionCoverChoices(saved.id)).history).toHaveLength(1);
      expect(
        (
          await saveForm(
            form(new Uint8Array([1, 2, 3]), "Invalid file edition"),
          )
        ).status,
      ).toBe(422);
      expect(
        await db
          .select()
          .from(schema.editions)
          .where(eq(schema.editions.title, "Invalid file edition")),
      ).toEqual([]);
    });
  },
);
