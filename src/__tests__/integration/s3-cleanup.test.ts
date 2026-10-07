import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";
import { DEFAULT_IMAGE_ADJUSTMENTS } from "@/lib/utils/image-adjustments";

// Opt in with a disposable local database. Never read DATABASE_URL or .env.
const url = process.env.DURTAL_S3_CLEANUP_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln282_test"
  )
    throw new Error("S3 cleanup tests require disposable local sln282_test");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;

// An in-memory bucket. It lists in pages of 2 to exercise continuation.
const bucket = vi.hoisted(() => ({
  objects: new Set<string>(),
  failDelete: new Set<string>(),
}));
vi.mock("@/lib/s3/client", () => ({
  S3_BUCKET: "local-test",
  s3: {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof ListObjectsV2Command) {
        const { Prefix = "", ContinuationToken } = command.input;
        const keys = [...bucket.objects].filter((k) => k.startsWith(Prefix)).sort();
        const start = ContinuationToken ? Number(ContinuationToken) : 0;
        const more = start + 2 < keys.length;
        return {
          Contents: keys.slice(start, start + 2).map((Key) => ({ Key })),
          IsTruncated: more,
          NextContinuationToken: more ? String(start + 2) : undefined,
        };
      }
      if (command instanceof DeleteObjectsCommand) {
        const Errors = [];
        for (const { Key } of command.input.Delete?.Objects ?? []) {
          if (bucket.failDelete.has(Key!)) Errors.push({ Key, Code: "AccessDenied" });
          else bucket.objects.delete(Key!);
        }
        return Errors.length ? { Errors } : {};
      }
      throw new Error("Unexpected S3 command");
    }),
  },
}));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local DB required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", async (original) => ({
  ...(await original<typeof import("@/lib/cache")>()),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));

import { deleteWork } from "@/lib/actions/works";
import { deleteAuthor, mergeAuthors } from "@/lib/actions/authors";
import { deleteEdition } from "@/lib/actions/editions";
import { deleteMedia, bulkDeleteMedia } from "@/lib/actions/media";
import { deleteVenue } from "@/lib/actions/venues";
import { keysInUse } from "@/lib/s3/cleanup";
import { DELETE as deleteComment } from "@/app/api/comments/[commentId]/route";
import { DELETE as deleteAttachment } from "@/app/api/comments/[commentId]/attachments/[attachmentId]/route";

const request = new NextRequest("http://localhost/api/comments", {
  method: "DELETE",
});

function put(key: string) {
  bucket.objects.add(key);
  return key;
}
function under(prefix: string) {
  return [...bucket.objects].filter((key) => key.startsWith(prefix));
}

describe.skipIf(!url)("S3 cleanup on delete, with PostgreSQL", () => {
  const db = testDb!;
  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  });
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await db.execute(
      sql`truncate works, authors, comments, activity_events, gallery_layouts, venues, ebook_files, ebooks, image_adjustments, contribution_types cascade`,
    );
    bucket.objects.clear();
    bucket.failDelete.clear();
    vi.clearAllMocks();
  });

  async function work(title = "Work") {
    const [row] = await db.insert(schema.works).values({ title }).returning();
    return row;
  }
  async function author(name = "Author") {
    const [row] = await db.insert(schema.authors).values({ name }).returning();
    return row;
  }
  /** A processed image: gold full size, thumbnail and original, plus the raw bronze upload. */
  async function image(
    owner: { workId: string } | { authorId: string },
    type = "gallery",
  ) {
    const [kind, id] =
      "workId" in owner ? ["work", owner.workId] : ["author", owner.authorId];
    const fileId = randomUUID();
    const base = `gold/media/${kind}/${id}/${type}/${fileId}`;
    put(`bronze/media/${kind}/${id}/${fileId}.jpg`);
    const [row] = await db
      .insert(schema.media)
      .values({
        ...owner,
        type,
        s3Key: put(`${base}.webp`),
        thumbnailS3Key: put(`${base}_thumb.webp`),
        originalS3Key: put(`${base}_original.webp`),
      })
      .returning();
    return row;
  }
  async function comment(entityType: "work" | "author", entityId: string) {
    const [row] = await db
      .insert(schema.comments)
      .values({ entityType, entityId, contentHtml: "<p>Note</p>" })
      .returning();
    const [attachment] = await db
      .insert(schema.commentAttachments)
      .values({
        commentId: row.id,
        fileName: "scan.pdf",
        fileSize: 10,
        mimeType: "application/pdf",
        s3Key: put(`gold/comments/${entityType}/${entityId}/${row.id}/${randomUUID()}.pdf`),
      })
      .returning();
    await db.insert(schema.activityEvents).values({
      entityType,
      entityId,
      eventKey: `${entityType}.comment_added`,
      metadata: { commentId: row.id },
    });
    return { row, attachment };
  }

  it("deleting a work leaves no object under its prefixes", async () => {
    const w = await work();
    const other = await work("Other");
    const poster = await image({ workId: w.id }, "poster");
    await image({ workId: w.id }, "gallery");
    const [edition] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "Edition" })
      .returning();
    const cover = put(`gold/covers/${edition.id}/cover.webp`);
    const thumb = put(`gold/covers/${edition.id}/thumb.webp`);
    put(`bronze/covers/${edition.id}/original.jpg`);
    await db
      .update(schema.editions)
      .set({ coverS3Key: cover, thumbnailS3Key: thumb })
      .where(eq(schema.editions.id, edition.id));
    const note = await comment("work", w.id);
    await db.insert(schema.galleryLayouts).values({
      entityType: "work",
      entityId: w.id,
      layoutData: {},
    });
    await db.insert(schema.imageAdjustments).values({
      assetKey: poster.s3Key,
      sources: [poster.s3Key],
      settings: DEFAULT_IMAGE_ADJUSTMENTS,
    });
    // Another work's poster stored under this work's folder must survive.
    const borrowed = put(`gold/media/work/${w.id}/poster/${randomUUID()}.webp`);
    await db
      .insert(schema.media)
      .values({ workId: other.id, type: "poster", s3Key: borrowed });
    const unrelated = put(`gold/media/work/${other.id}/poster/x.webp`);

    expect(await deleteWork(w.id)).toEqual({ id: w.id, cleanupPending: false });

    expect(under(`gold/media/work/${w.id}/`)).toEqual([borrowed]);
    expect(under(`bronze/media/work/${w.id}/`)).toEqual([]);
    expect(under(`gold/covers/${edition.id}/`)).toEqual([]);
    expect(under(`bronze/covers/${edition.id}/`)).toEqual([]);
    expect(under(`gold/comments/work/${w.id}/`)).toEqual([]);
    expect(bucket.objects.has(unrelated)).toBe(true);
    expect(await db.select().from(schema.imageAdjustments)).toEqual([]);
    expect(
      await db.select().from(schema.comments).where(eq(schema.comments.id, note.row.id)),
    ).toEqual([]);
    expect(await db.select().from(schema.activityEvents)).toEqual([]);
    expect(await db.select().from(schema.galleryLayouts)).toEqual([]);
  });

  it("counts the evidence keys a source record's payload names as in use (SLN-468)", async () => {
    const w = await work("Evidence");
    const rawKey = `bronze/evidence/${"a".repeat(64)}.raw.gz`;
    const textKey = `bronze/evidence/${"b".repeat(64)}.txt`;
    const payload = { kind: "evidence_page", rawKey, textKey };
    await db.insert(schema.sourceRecords).values({
      entityKind: "book",
      workId: w.id,
      provider: "lrb",
      retrievedAt: new Date(),
      payload,
      payloadHash: "c".repeat(64),
      reviewStatus: "accepted",
    });
    const orphan = `bronze/evidence/${"d".repeat(64)}.txt`;
    expect([...(await keysInUse([rawKey, textKey, orphan]))].sort()).toEqual([rawKey, textKey].sort());
  });

  it("keeps the files of a work that does not exist", async () => {
    const key = put(`gold/media/work/${randomUUID()}/poster/a.webp`);
    // The book-only boundary rejects an unknown work before any cleanup.
    await expect(deleteWork(randomUUID())).rejects.toThrow("Book not found");
    expect(bucket.objects.has(key)).toBe(true);
  });

  it("deleting an author removes its images, photo and comment files", async () => {
    const a = await author();
    await image({ authorId: a.id }, "poster");
    const photo = put(`gold/media/author/${a.id}/photo/p.webp`);
    await db.update(schema.authors).set({ photoS3Key: photo }).where(eq(schema.authors.id, a.id));
    await comment("author", a.id);

    expect(await deleteAuthor(a.id)).toEqual({ id: a.id, cleanupPending: false });
    expect(bucket.objects.size).toBe(0);
    expect(await db.select().from(schema.comments)).toEqual([]);
    expect(await db.select().from(schema.activityEvents)).toEqual([]);
  });

  it("merging moves links, comments and images, then removes files it leaves unused", async () => {
    const source = await author("Lorrain, Jean");
    const target = await author("Jean Lorrain");
    const shared = await work("Shared");
    const only = await work("Only source");
    await db.insert(schema.workAuthors).values([
      { workId: shared.id, authorId: source.id },
      { workId: shared.id, authorId: target.id },
      { workId: only.id, authorId: source.id },
    ]);
    const [edition] = await db
      .insert(schema.editions)
      .values({ workId: only.id, title: "E" })
      .returning();
    await db
      .insert(schema.editionContributors)
      .values({ editionId: edition.id, authorId: source.id, role: "translator" });
    const [kind] = await db
      .insert(schema.contributionTypes)
      .values({ name: "Translator", slug: "translator" })
      .returning();
    await db
      .insert(schema.authorContributionTypes)
      .values({ authorId: source.id, contributionTypeId: kind.id });
    await image({ authorId: source.id }, "poster");
    // Both have a photo: the merge keeps the target's and discards the source's.
    const sourcePhoto = put(`gold/media/author/${source.id}/photo/s.webp`);
    const targetPhoto = put(`gold/media/author/${target.id}/photo/t.webp`);
    await db.update(schema.authors).set({ photoS3Key: sourcePhoto }).where(eq(schema.authors.id, source.id));
    await db.update(schema.authors).set({ photoS3Key: targetPhoto }).where(eq(schema.authors.id, target.id));
    const note = await comment("author", source.id);
    await db.insert(schema.activityEvents).values({
      entityType: "author",
      entityId: source.id,
      eventKey: "author.created",
    });
    await db.insert(schema.galleryLayouts).values({
      entityType: "author",
      entityId: source.id,
      layoutData: {},
    });

    await mergeAuthors(source.id, target.id);

    expect(
      await db.select().from(schema.authors).where(eq(schema.authors.id, source.id)),
    ).toEqual([]);
    const links = await db
      .select({ workId: schema.workAuthors.workId })
      .from(schema.workAuthors)
      .where(eq(schema.workAuthors.authorId, target.id));
    expect(links.map((l) => l.workId).sort()).toEqual([shared.id, only.id].sort());
    expect(
      await db
        .select()
        .from(schema.editionContributors)
        .where(eq(schema.editionContributors.authorId, target.id)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(schema.authorContributionTypes)
        .where(eq(schema.authorContributionTypes.authorId, target.id)),
    ).toHaveLength(1);
    // The comment, its file and its timeline event now belong to the target.
    const [moved] = await db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.id, note.row.id));
    expect(moved.entityId).toBe(target.id);
    expect(bucket.objects.has(note.attachment.s3Key)).toBe(true);
    // The audited merge moves the source's timeline to the target and records
    // itself as a harmonization operation.
    const events = await db.select().from(schema.activityEvents);
    expect(events.every((e) => e.entityId === target.id)).toBe(true);
    expect(events.map((e) => e.eventKey)).toContain("author.comment_added");
    expect(
      await db
        .select({ action: schema.harmonizationOperations.action, entity: schema.harmonizationOperations.entity })
        .from(schema.harmonizationOperations)
        .where(eq(schema.harmonizationOperations.sourceId, source.id)),
    ).toEqual([{ action: "merge", entity: "authors" }]);
    expect(await db.select().from(schema.galleryLayouts)).toEqual([]);
    // Moved images keep their files; the discarded photo is deleted.
    const [moved_image] = await db.select().from(schema.media);
    expect(moved_image.authorId).toBe(target.id);
    expect(bucket.objects.has(moved_image.s3Key)).toBe(true);
    expect(bucket.objects.has(sourcePhoto)).toBe(false);
    expect(bucket.objects.has(targetPhoto)).toBe(true);
  });

  it("deleting an edition removes its cover but keeps every object an e-book still lists", async () => {
    const w = await work();
    const [edition] = await db
      .insert(schema.editions)
      .values({ workId: w.id, title: "E" })
      .returning();
    const cover = put(`gold/covers/${edition.id}/cover.webp`);
    // Objects an e-book names, left under the edition's folder: none may go (SLN-490)
    const file = put(`gold/covers/${edition.id}/book.epub`);
    const manifest = put(`gold/covers/${edition.id}/manifest.json`);
    const fileCover = put(`gold/covers/${edition.id}/cover-400.webp`);
    const ebookCover = put(`gold/covers/${edition.id}/cover-240.webp`);
    await db
      .update(schema.editions)
      .set({ coverS3Key: cover })
      .where(eq(schema.editions.id, edition.id));
    const [ebook] = await db
      .insert(schema.ebooks)
      .values({ title: "E", importSource: "folder", coverKey: ebookCover })
      .returning();
    await db.insert(schema.ebookFiles).values({
      ebookId: ebook.id,
      sha256: "a".repeat(64),
      format: "epub",
      sizeBytes: 1,
      contentType: "application/epub+zip",
      s3Key: file,
      status: "stored",
      manifestKey: manifest,
      coverKey: fileCover,
    });

    expect(await deleteEdition(edition.id)).toEqual({ id: edition.id, cleanupPending: false });
    expect([...bucket.objects].sort()).toEqual([file, manifest, fileCover, ebookCover].sort());
  });

  it("deleting a comment removes its files and its timeline event only", async () => {
    const w = await work();
    const gone = await comment("work", w.id);
    const kept = await comment("work", w.id);

    const response = await deleteComment(request, {
      params: Promise.resolve({ commentId: gone.row.id }),
    });
    expect(response.status).toBe(200);
    expect([...bucket.objects]).toEqual([kept.attachment.s3Key]);
    const events = await db.select().from(schema.activityEvents);
    expect(events.map((e) => (e.metadata as { commentId: string }).commentId)).toEqual([
      kept.row.id,
    ]);
  });

  it("deletes an attachment only through its own comment", async () => {
    const w = await work();
    const a = await comment("work", w.id);
    const b = await comment("work", w.id);

    const wrong = await deleteAttachment(request, {
      params: Promise.resolve({ commentId: b.row.id, attachmentId: a.attachment.id }),
    });
    expect(wrong.status).toBe(404);
    expect(bucket.objects.has(a.attachment.s3Key)).toBe(true);

    const right = await deleteAttachment(request, {
      params: Promise.resolve({ commentId: a.row.id, attachmentId: a.attachment.id }),
    });
    expect(right.status).toBe(200);
    expect(bucket.objects.has(a.attachment.s3Key)).toBe(false);
  });

  it("deletes the media row even when the bucket refuses, and promotes the next image", async () => {
    const w = await work();
    const first = await image({ workId: w.id }, "gallery");
    await db.update(schema.media).set({ isActive: true }).where(eq(schema.media.id, first.id));
    const second = await image({ workId: w.id }, "gallery");
    bucket.failDelete.add(first.s3Key);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await deleteMedia(first.id);

    log.mockRestore();
    const rows = await db.select().from(schema.media);
    expect(rows.map((r) => [r.id, r.isActive])).toEqual([[second.id, true]]);
    // Only the refused object remains; the thumbnail and original are gone.
    expect(bucket.objects.has(first.s3Key)).toBe(true);
    expect(bucket.objects.has(first.thumbnailS3Key!)).toBe(false);
  });

  it("bulk media delete keeps a file another image still uses", async () => {
    const w = await work();
    const a = await image({ workId: w.id });
    const b = await image({ workId: w.id });
    await db
      .insert(schema.media)
      .values({ workId: w.id, type: "poster", s3Key: a.s3Key });

    await bulkDeleteMedia([a.id, b.id]);

    expect(bucket.objects.has(a.s3Key)).toBe(true);
    expect(bucket.objects.has(a.thumbnailS3Key!)).toBe(false);
    expect(bucket.objects.has(b.s3Key)).toBe(false);
  });

  it("deleting a venue removes its poster", async () => {
    const [venue] = await db
      .insert(schema.venues)
      .values({
        name: "Shop",
        type: "bookshop",
        posterS3Key: put("gold/venues/v/poster.webp"),
        thumbnailS3Key: put("gold/venues/v/thumb.webp"),
      })
      .returning();
    expect(await deleteVenue(venue.id)).toEqual({ id: venue.id, cleanupPending: false });
    expect(bucket.objects.size).toBe(0);
  });

  it("reports pending cleanup and keeps display settings of a file the bucket refused", async () => {
    const a = await author();
    const poster = await image({ authorId: a.id }, "poster");
    await db.insert(schema.imageAdjustments).values({
      assetKey: poster.s3Key,
      sources: [poster.s3Key],
      settings: DEFAULT_IMAGE_ADJUSTMENTS,
    });
    bucket.failDelete.add(poster.s3Key);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await deleteAuthor(a.id)).toEqual({ id: a.id, cleanupPending: true });

    log.mockRestore();
    expect([...bucket.objects]).toEqual([poster.s3Key]);
    expect(await db.select().from(schema.imageAdjustments)).toHaveLength(1);
    expect(await db.select().from(schema.authors)).toEqual([]);
  });
});
