import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { Db } from "@/lib/catalogue/work-store";
import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { prepareLinkWrite, linkEbook, type LinkPlan } from "@/lib/ebooks/match/link";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";
import { dataFingerprint, MATCH_TABLES } from "@/lib/ebooks/match/load";
import { MATCH_MODEL } from "@/lib/ebooks/match/model";
import { ebook, at } from "./fixtures";
import type { LoadedMatchCatalogue } from "@/lib/ebooks/match/load";
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Global database forbidden");
      },
    },
  ),
}));
const mocks = vi.hoisted(() => ({
  head: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@/lib/ebooks/storage", () => ({
  headEbookObject: mocks.head,
  getEbookObjectRange: mocks.get,
}));
vi.mock("@/lib/s3/client", async () => ({ S3_BUCKET: "local-test", s3: { send: (await import("../../s3/cover-stage-fixture")).catalogueSend } }));

import {
  planCoverCopy,
  copyPlannedCover,
  discardUnusedCover,
  requireMatchingCover,
} from "@/lib/ebooks/match/covers";
import { publicationFixture } from "../publication-fixture";
import { coverBucket, resetCoverBucket, realCoverBytes } from "../../s3/cover-stage-fixture";
import { PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";
let bytes: Buffer;
let hash: string;
const identity = { operationId: "matching-operation", targetDatabase: "disposable" };
function source() {
  const file = publicationFixture(),
    cover = file.metadata.medallion.gold[1];
  cover.key = cover.key.replace("cover-240.webp", "cover-800.webp");
  cover.sha256 = hash;
  cover.size = bytes.length;
  const snapshot = {
    rows: {
      ebook_files: [
        {
          id: "file",
          ebook_id: "book",
          sha256: file.sha256,
          format: file.format,
          size_bytes: file.sizeBytes,
          s3_key: file.s3Key,
          status: file.status,
          drm: null,
          metadata: file.metadata,
          manifest_key: file.manifestKey,
          cover_key: cover.key,
        },
      ],
    },
  } as unknown as Pick<LoadedMatchCatalogue, "rows">;
  return { snapshot, key: cover.key };
}
beforeEach(async () => {
  vi.clearAllMocks();
  resetCoverBucket();
  bytes = await realCoverBytes();
  hash = createHash("sha256").update(bytes).digest("hex");
  mocks.head.mockResolvedValue({
    size: bytes.length,
    sha256: hash,
    metadataSha256: hash,
  });
  mocks.get.mockImplementation(async () => ({
    length: bytes.length,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  }));
});
describe("validated ebook cover copy", () => {
  it("binds source checksum and allocates separate keys for repeated attempts", async () => {
    const s = source(),
      a = planCoverCopy(s.snapshot, "book", "edition", s.key, identity)!,
      b = planCoverCopy(s.snapshot, "book", "edition", s.key, identity)!;
    expect(a.sourceSha256).toBe(hash);
    expect(a.coverKey).not.toBe(b.coverKey);
    expect(await copyPlannedCover(a)).toMatchObject({
      coverKey: a.coverKey,
      thumbnailKey: a.thumbnailKey,
    });
    expect(coverBucket.calls.filter((c): c is PutObjectCommand => c instanceof PutObjectCommand).map(c => c.input.Key)).toEqual([
      a.coverKey,
      a.thumbnailKey,
    ]);
    expect(mocks.get).toHaveBeenCalledWith(s.key, 0, bytes.length - 1);
  });
  it("refuses another ebook, an unrecorded key and malformed publication evidence", () => {
    const s = source();
    expect(() => planCoverCopy(s.snapshot, "other", "edition", s.key, identity)).toThrow(
      "validated ebook",
    );
    expect(() =>
      planCoverCopy(s.snapshot, "book", "edition", s.key.replace("800", "400"), identity),
    ).toThrow("validated ebook");
    s.snapshot.rows.ebook_files[0].metadata = { medallion: { gold: [null] } };
    expect(() => planCoverCopy(s.snapshot, "book", "edition", s.key, identity)).toThrow(
      "validated ebook",
    );
  });
  it.each(["checksum", "size", "bytes"] as const)(
    "refuses changed %s before any asset upload",
    async (kind) => {
      const s = source(),
        plan = planCoverCopy(s.snapshot, "book", "edition", s.key, identity)!;
      if (kind === "checksum")
        mocks.head.mockResolvedValue({
          size: bytes.length,
          sha256: "a".repeat(64),
        });
      if (kind === "size")
        mocks.head.mockResolvedValue({ size: 21 * 1024 * 1024, sha256: hash });
      if (kind === "bytes")
        mocks.get.mockResolvedValue({
          length: bytes.length,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.alloc(bytes.length));
              controller.close();
            },
          }),
        });
      await expect(copyPlannedCover(plan)).rejects.toThrow();
      expect(coverBucket.calls).toEqual([]);
    },
  );
  it("retains every attempt, including no-edition-ref and failed-read cases", async () => {
    const s = source(),
      plan = planCoverCopy(s.snapshot, "book", "edition", s.key, identity)!;
    await discardUnusedCover(
      { execute: async () => [{ used: true }] } as unknown as Db,
      plan,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await discardUnusedCover(
      { execute: async () => [] } as unknown as Db,
      plan,
    );
    expect(mocks.remove).not.toHaveBeenCalled();
    await discardUnusedCover(
      { execute: async () => [{ used: false }] } as unknown as Db,
      plan,
    );
    await discardUnusedCover({ execute: async () => { throw new Error("failed follow-up read"); } } as unknown as Db, plan);
    expect(coverBucket.calls.some(c => c instanceof DeleteObjectCommand || c instanceof DeleteObjectsCommand)).toBe(false);
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("binds verified pair to reserved source/owner/operation and rejects existing-edition effects", async () => {
    const s = source(), plan = planCoverCopy(s.snapshot, "book", "edition", s.key, identity)!;
    requireMatchingCover(s.snapshot, "book", "edition", s.key, identity, plan.allocation, false);
    const cover = await copyPlannedCover(plan);
    requireMatchingCover(s.snapshot, "book", "edition", s.key, identity, cover, true);
    expect(() => requireMatchingCover(s.snapshot, "book", "edition", null, identity, cover, true)).toThrow("Existing-edition");
    expect(() => requireMatchingCover(s.snapshot, "book", "edition", s.key, { ...identity, operationId: "other" }, cover, true)).toThrow("verified");
    expect(() => requireMatchingCover(s.snapshot, "book", "edition", s.key, { ...identity, targetDatabase: "other" }, plan.allocation, false)).toThrow("changed");
    const before = new Map([...coverBucket.objects].map(([key, bytes]) => [key, Buffer.from(bytes)]));
    const recovery = await discardUnusedCover({ execute: async () => [{ used: false }] } as unknown as Db, plan);
    expect(recovery.cleanupPending).toBe(true); expect(coverBucket.objects).toEqual(before);
  });

  it("reserves before any PUT, prohibits reserved publication, persists verified hashes and retains bytes after lost DB acknowledgement", async () => {
    const s = source();
    const plan: LinkPlan = {
      ...identity, version: 1, runId: "run", planSha256: "", kind: "link", mode: "ingestion", createdAt: at,
      modelFingerprint: dataFingerprint(MATCH_MODEL),
      snapshot: { catalogueFingerprint: "catalogue", inputFingerprint: "input", rows: {
        ...Object.fromEntries(MATCH_TABLES.map(table => [table, []])), ...s.snapshot.rows,
        ebooks: [{ id: "book" }], ebook_match_candidates: [], instances: [],
        locations: [{ id: "digital", type: "digital", is_active: true }],
      } },
      ebook: ebook({ id: "book" }),
      effect: { workId: "work", rule: "new_edition", editionId: null, instanceId: null, movedFromEditionId: null,
        newEdition: { title: "Nadja", subtitle: null, language: "en", isbn13: null, publisher: null, publicationYear: null, metadataSource: "ebook", coverSourceKey: s.key },
        newCopy: { locationId: "digital", format: "epub", fileSizeBytes: 1000, status: "available" },
        missing: [], ambiguities: [], ready: true, text: "New edition" },
      choices: { ebookId: "book", workId: "work", method: "manual" }, editionId: "edition", instanceId: "copy",
      instanceHistoryId: "history", activityId: "activity", editionActivityId: "edition-activity",
    };
    plan.planSha256 = hashMatchingPlan(plan);
    const coverPlan = planCoverCopy(plan.snapshot, "book", "edition", s.key, plan)!;
    const reserved = await prepareLinkWrite(plan, plan.targetDatabase, { coverReservation: coverPlan.allocation });
    expect(reserved.receipt.coverStage?.state).toBe("reserved"); expect(coverBucket.calls).toEqual([]);
    expect(() => reserved.queries(drizzle.mock() as unknown as Db)).toThrow("complete verification");
    const verified = await copyPlannedCover(coverPlan);
    const prepared = await prepareLinkWrite(plan, plan.targetDatabase, { coverReservation: coverPlan.allocation, preparedCover: verified });
    expect(prepared.receipt).toMatchObject({ operationId: plan.operationId, coverStage: { state: "verified", cover: verified.cover, thumbnail: verified.thumbnail } });
    const last = prepared.queries(drizzle.mock() as unknown as Db).at(-1)! as { getSQL(): SQL };
    const sql = new PgDialect().sqlToQuery(last.getSQL());
    expect(sql.params.some(p => typeof p === "string" && p.includes(verified.cover.sha256) && p.includes(verified.thumbnail.sha256))).toBe(true);
    resetCoverBucket();
    const conn = Object.assign(drizzle.mock(), { batch: async () => { throw new Error("committed, acknowledgement lost"); } }) as unknown as Db;
    await expect(linkEbook(conn, plan, plan.targetDatabase, { beforeWrite: async receipt => {
      expect(coverBucket.calls).toEqual([]); expect(receipt.coverStage?.state).toBe("reserved");
    } })).rejects.toThrow("acknowledgement lost");
    expect(coverBucket.objects.size).toBe(2);
    expect(coverBucket.calls.some(c => c instanceof DeleteObjectCommand || c instanceof DeleteObjectsCommand)).toBe(false);
  });

});
