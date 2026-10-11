import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "@/lib/catalogue/work-store";
import { drizzle } from "drizzle-orm/postgres-js";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { prepareLinkWrite, linkEbook, type LinkPlan } from "@/lib/ebooks/match/link";
import { hashMatchingPlan } from "@/lib/ebooks/match/plan";
import { dataFingerprint, MATCH_TABLES, matchFileFromStoredRow } from "@/lib/ebooks/match/load";
import { MATCH_MODEL } from "@/lib/ebooks/match/model";
import { ebook, at, catalogue, work, edition, copy, author } from "./fixtures";
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
  loaded: null as unknown,
}));
vi.mock("@/lib/ebooks/match/load", async (importActual) => ({
  ...(await importActual<object>()), loadMatchCatalogue: async () => mocks.loaded,
}));
vi.mock("@/lib/enrichment/queue", () => ({ BULK_ACCESSION_PRIORITY: 200,
  queueNewBookEnrichment: async () => ({ ok: true, jobs: [] }) }));
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
import { planGroupMatching } from "@/lib/ebooks/match/groups";
import { planApprovedGroupsOn, applyApprovedGroups } from "@/lib/ebooks/match/apply-groups";
import { scoreCalibration } from "@/lib/ebooks/match/calibration";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import { accessionEbooks, planAccessionOn } from "@/lib/ebooks/match/accession";
import { type LinkReceipt } from "@/lib/ebooks/match/link";
import { editionEffect } from "@/lib/ebooks/match/editions";
import { reserveUndoLog, appendUndoLog, readUndoLog } from "@/lib/books/undo-file";
import { prepareMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";
import { sql } from "drizzle-orm";
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

/** These cases exercise the real planners, cover renderer, disk reservation and
 * atomic query builder. The batch boundary is fake; the disposable PostgreSQL
 * suite separately checks the actual committed link_written rows. */
async function combinedByteFixture() {
  const person = author({ id: randomUUID() }), locationId = randomUUID();
  const sourceObjects = new Map<string, Buffer>();
  const files = await Promise.all(["Nadja", "Arcane Letters"].map(async (title, i) => {
    const file = publicationFixture("epub", (i ? "ac" : "ab").repeat(32));
    const cover = file.metadata.medallion.gold[1];
    const buffer = await realCoverBytes(i ? "#663311" : "#224466");
    cover.key = cover.key.replace("cover-240.webp", "cover-800.webp");
    cover.sha256 = createHash("sha256").update(buffer).digest("hex");
    cover.size = buffer.length;
    sourceObjects.set(cover.key, Buffer.from(buffer));
    const ebookId = randomUUID();
    const raw = { id: randomUUID(), ebook_id: ebookId, sha256: file.sha256,
      format: file.format, size_bytes: file.sizeBytes, content_type: "application/epub+zip",
      s3_key: file.s3Key, status: file.status, drm: null, metadata: file.metadata,
      manifest_key: file.manifestKey, cover_key: cover.key };
    const input = ebook({ id: ebookId, title, files: [matchFileFromStoredRow(raw)] });
    expect(input.files[0]).toMatchObject({ availability: "native", coverKey: cover.key });
    return { raw, input, work: work({ id: randomUUID(), title, authors: [person] }) };
  }));
  const loaded: LoadedMatchCatalogue = {
    catalogue: catalogue({ works: files.map(f => f.work), ebooks: files.map(f => f.input),
      authors: [person], ebookLocationId: locationId, digitalLocationIds: [locationId] }),
    rows: { ...Object.fromEntries(MATCH_TABLES.map(table => [table, []])),
      authors: [{ id: person.id, name: person.name }],
      works: files.map(f => ({ id: f.work.id, title: f.work.title })),
      locations: [{ id: locationId, type: "digital", is_active: true }],
      ebooks: files.map(f => ({ id: f.input.id, title: f.input.title, match_state: "pending",
        instance_id: null, updated_at: at, link_written: null })),
      ebook_files: files.map(f => f.raw),
    } as unknown as LoadedMatchCatalogue["rows"],
    catalogueFingerprint: "c".repeat(64), inputFingerprint: "d".repeat(64),
  };
  mocks.head.mockImplementation(async (key: string) => {
    const buffer = sourceObjects.get(key);
    if (!buffer) throw new Error(`Unexpected source HEAD ${key}`);
    const digest = createHash("sha256").update(buffer).digest("hex");
    return { size: buffer.length, sha256: digest, metadataSha256: digest };
  });
  mocks.get.mockImplementation(async (key: string) => {
    const buffer = sourceObjects.get(key);
    if (!buffer) throw new Error(`Unexpected source GET ${key}`);
    return { length: buffer.length, body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from(buffer)); controller.close(); },
    }) };
  });
  return { loaded, files, sourceObjects };
}
async function combinedPlan(writer: "groups" | "accession", fixture: Awaited<ReturnType<typeof combinedByteFixture>>) {
  const { loaded, files } = fixture;
  const planning = Object.assign(drizzle.mock(), {
    select: () => ({ from: () => ({ where: async () => [] }) }),
  }) as unknown as Db;
  const identity = { runId: randomUUID(), targetDatabase: "disposable", now: at };
  if (writer === "accession") {
    mocks.loaded = { ...loaded, catalogue: catalogue({ ...loaded.catalogue.source, works: [] }),
      rows: { ...loaded.rows, works: [] } };
    return { kind: "accession" as const, plan: await planAccessionOn(planning, files.map(f => f.input.id), identity) };
  }
  mocks.loaded = { ...loaded, catalogue: catalogue({ ...loaded.catalogue.source, ebooks: [] }),
    rows: { ...loaded.rows, ebooks: [], ebook_files: [] } };
  const plan = await planGroupMatching(planning, files.map((f, i) => ({
    groupKey: `combined:${i}`, metadataFingerprint: matchFingerprint(f.input),
    existingEbookId: null, ebook: f.input,
  })), "e".repeat(64));
  expect(plan.results.every(result => result.autoLink)).toBe(true);
  const precision = scoreCalibration(plan.binding, plan.sample, plan.sample.map(row => ({
    ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: "right" as const,
  })));
  mocks.loaded = loaded;
  const result = await planApprovedGroupsOn(planning, { plan, precision }, files.map((f, i) => ({
    groupKey: `combined:${i}`, ebookId: f.input.id,
    fileIds: { [f.raw.sha256]: f.raw.id },
  })), identity);
  if (result.kind !== "planned") throw new Error("Expected two approved group links");
  expect(result.plan.links).toHaveLength(2);
  return { kind: "groups" as const, plan: result.plan };
}
function compiledBatch(queries: unknown[]) {
  const dialect = new PgDialect();
  return queries.map(query => dialect.sqlToQuery((query as { getSQL(): SQL }).getSQL()));
}
function receiptInputs(queries: ReturnType<typeof compiledBatch>): LinkReceipt[] {
  return queries.filter(query => query.sql.includes("returning link_written")).map(query => {
    const receipt = query.params.find(value => typeof value === "string" && value.startsWith("{\"version\":1"));
    if (typeof receipt !== "string") throw new Error("Missing real commitReceiptQuery payload");
    return JSON.parse(receipt) as LinkReceipt;
  });
}
function expectByteEvidence(receipt: LinkReceipt) {
  const stage = receipt.coverStage!;
  expect(stage.state).toBe("verified");
  for (const evidence of [stage.cover!, stage.thumbnail!]) {
    const buffer = coverBucket.objects.get(evidence.key)!;
    expect(buffer).toBeDefined();
    expect(evidence.sha256).toBe(createHash("sha256").update(buffer).digest("hex"));
    expect(evidence.size).toBe(buffer.length);
  }
}

describe.each(["groups", "accession"] as const)("combined %s cover and matching writer", writer => {
  it.each(["later_pair", "commit", "ack", "success"] as const)("reserves every pair once before PUT and preserves old bytes on %s", async failure => {
    const fixture = await combinedByteFixture(), candidate = await combinedPlan(writer, fixture);
    const oldBytes = new Map([["gold/covers/old/cover.webp", Buffer.from(bytes)], ["gold/covers/old/thumb.webp", Buffer.from(bytes)]]);
    for (const [key, buffer] of oldBytes) coverBucket.objects.set(key, Buffer.from(buffer));
    const sourceBefore = new Map([...fixture.sourceObjects].map(([key, buffer]) => [key, Buffer.from(buffer)]));
    const directory = await mkdtemp(join(tmpdir(), "combined-cover-reservation-"));
    const disk = join(directory, "undo.jsonl");
    reserveUndoLog(disk, { version: 1, runId: candidate.plan.runId });
    let queries: ReturnType<typeof compiledBatch> = [], batchCalls = 0, reservations = 0;
    const beforeWrite = vi.fn(async (receipt: LinkReceipt) => {
      expect(coverBucket.calls.filter(call => call instanceof PutObjectCommand)).toEqual([]);
      expect(receipt.coverStage?.state).toBe("reserved");
      expect(Object.isFrozen(receipt)).toBe(true);
      appendUndoLog(disk, receipt);
      reservations++;
      if (failure === "later_pair" && reservations === 2)
        coverBucket.failBefore.add(receipt.coverStage!.allocation.thumbnailKey);
    });
    const conn = Object.assign(drizzle.mock(), { batch: async (batch: unknown[]) => {
      batchCalls++;
      queries = compiledBatch(batch);
      expect(beforeWrite).toHaveBeenCalledTimes(2);
      expect(receiptInputs(queries)).toHaveLength(2);
      receiptInputs(queries).forEach(expectByteEvidence);
      if (failure === "commit") throw new Error("commit rejected");
      if (failure === "ack") throw new Error("acknowledgement lost");
      return queries.map(query => query.sql.includes("combined_review_final") ? [{ final: true }] : []);
    } }) as unknown as Db;
    const extension = candidate.kind === "accession" ? prepareMatchAtomicExtension({
      coreWriter: "accession", coreOperation: candidate.plan,
      ebookIds: candidate.plan.entries.map(entry => entry.effect.ebookId),
      reviewOperations: candidate.plan.entries.map(entry => ({ version: 1 as const,
        operationId: entry.receipt.operationId, runId: entry.receipt.runId,
        planSha256: entry.receipt.planSha256, targetDatabase: entry.receipt.targetDatabase })),
      purpose: "decision",
    }, { extraTables: ["activity_events"],
      before: d => [d.execute(sql`select 'combined_review_before'`)],
      after: d => [d.execute(sql`select 'combined_review_final'`)],
    }) : undefined;
    try {
      const promise = candidate.kind === "groups"
        ? applyApprovedGroups(conn, candidate.plan, candidate.plan.targetDatabase, { beforeWrite })
        : accessionEbooks(conn, candidate.plan, candidate.plan.targetDatabase, { beforeWrite, atomicExtension: extension });
      if (failure === "success") {
        const result = await promise;
        result.receipts.forEach(expectByteEvidence);
        if (candidate.kind === "accession") expect(result.result.at(-1)).toEqual([{ final: true }]);
      } else await expect(promise).rejects.toThrow(failure === "later_pair" ? "Cover stage verification failed" : failure === "commit" ? "commit rejected" : "acknowledgement lost");
      const entries = readUndoLog<unknown, LinkReceipt>(disk).entries;
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map(entry => entry.operationId)).size).toBe(2);
      expect(entries.every(entry => entry.coverStage?.state === "reserved")).toBe(true);
      expect(batchCalls).toBe(failure === "later_pair" ? 0 : 1);
      expect(coverBucket.objects.size).toBe(failure === "later_pair" ? 5 : 6);
      expect(coverBucket.calls.filter(call => call instanceof PutObjectCommand)).toHaveLength(4);
      for (const reserved of entries) {
        const written = receiptInputs(queries).find(receipt => receipt.operationId === reserved.operationId);
        if (failure !== "later_pair") {
          expect(written).toMatchObject({ ebookId: reserved.ebookId, editionId: reserved.editionId,
            planSha256: reserved.planSha256, coverStage: { allocation: reserved.coverStage!.allocation } });
          expectByteEvidence(written!);
        }
      }
      if (candidate.kind === "accession" && batchCalls) {
        const before = queries.findIndex(query => query.sql.includes("combined_review_before"));
        const firstMutation = queries.findIndex(query => query.sql.startsWith("delete from \"ebook_match_candidates\""));
        const lastReceipt = queries.findLastIndex(query => query.sql.includes("returning link_written"));
        expect(before).toBeGreaterThan(0);
        expect(firstMutation).toBeGreaterThan(before);
        expect(lastReceipt).toBe(queries.length - 2);
        expect(queries.at(-1)?.sql).toContain("combined_review_final");
      }
      for (const [key, buffer] of oldBytes) expect(coverBucket.objects.get(key)).toEqual(buffer);
      expect(fixture.sourceObjects).toEqual(sourceBefore);
      expect(coverBucket.calls.some(call => call instanceof DeleteObjectCommand || call instanceof DeleteObjectsCommand)).toBe(false);
      expect(mocks.remove).not.toHaveBeenCalled();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

describe("existing-edition cover preservation", () => {
  it("keeps a distinct checksum's canonical folders and rejects mixed-folder publication evidence", () => {
    const file = publicationFixture("epub", "ac".repeat(32));
    const cover = file.metadata.medallion.gold[1];
    cover.key = cover.key.replace("cover-240.webp", "cover-800.webp");
    const raw = { id: randomUUID(), ebook_id: randomUUID(), sha256: file.sha256,
      format: file.format, size_bytes: file.sizeBytes, content_type: "application/epub+zip",
      s3_key: file.s3Key, status: file.status, drm: null, metadata: file.metadata,
      manifest_key: file.manifestKey, cover_key: cover.key };
    expect(matchFileFromStoredRow(raw)).toMatchObject({ availability: "native", coverKey: cover.key });
    for (const field of ["source", "bronze", "silver", "cover", "manifest"] as const) {
      const altered = { ...raw, metadata: { medallion: { ...file.metadata.medallion,
        bronze: { ...file.metadata.medallion.bronze }, silver: { ...file.metadata.medallion.silver },
        validation: { ...file.metadata.medallion.validation },
        gold: file.metadata.medallion.gold.map(object => ({ ...object })),
      } } };
      expect(matchFileFromStoredRow(altered)).toMatchObject({ availability: "native", coverKey: cover.key });
      if (field === "source") altered.s3_key = altered.s3_key.replace("/ac/", "/ab/");
      else if (field === "bronze" || field === "silver")
        altered.metadata.medallion[field].key = altered.metadata.medallion[field].key.replace("/ac/", "/ab/");
      else if (field === "cover")
        altered.metadata.medallion.gold[1].key = altered.metadata.medallion.gold[1].key.replace("/ac/", "/ab/");
      else altered.metadata.medallion.gold[2].key = altered.metadata.medallion.gold[2].key.replace("/ac/", "/ab/");
      expect(matchFileFromStoredRow(altered)).toMatchObject({ availability: "blocked", coverKey: null });
    }
    expect(coverBucket.calls).toEqual([]);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each(["fill", "move", "placeholder"] as const)("performs no cover PUT or DELETE for a real %s effect", async route => {
    const fixture = await combinedByteFixture(), { loaded, files } = fixture;
    const selected = files[0], parentId = selected.work.id;
    const original = edition({ id: randomUUID(), workId: parentId, metadataSource: "phantom_canon" });
    const identified = edition({ id: randomUUID(), workId: parentId, isbn13: "9780306406157" });
    const waiting = copy({ id: randomUUID(), editionId: original.id, locationId: loaded.catalogue.source.ebookLocationId! });
    const input = { ...selected.input, isbns: route === "move" ? [identified.isbn13!] : [] };
    const editions = route === "move" ? [original, identified] : [original];
    const copies = route === "placeholder" ? [] : [waiting];
    const indexed = catalogue({ ...loaded.catalogue.source, ebooks: [input], works: [work({ ...selected.work, editions, copies })] });
    const effect = editionEffect(input, indexed.byWorkId.get(parentId)!, indexed);
    expect(effect.ready).toBe(true);
    expect(effect.newEdition).toBeNull();
    expect(effect.movedFromEditionId).toBe(route === "move" ? original.id : null);
    if (route === "placeholder") expect(effect.filledCopy).toBeUndefined();
    else expect(effect.filledCopy).toMatchObject({ format: "epub", fileSizeBytes: 200 });
    const oldCover = "gold/covers/shared/cover.webp", oldThumb = "gold/covers/shared/thumb.webp";
    coverBucket.objects.set(oldCover, Buffer.from(bytes)); coverBucket.objects.set(oldThumb, Buffer.from(bytes));
    const rows = { ...loaded.rows, ebooks: loaded.rows.ebooks.filter(row => row.id === input.id),
      instances: copies.map(item => ({ id: item.id, edition_id: item.editionId, location_id: item.locationId,
        status: "available", format: null, file_size_bytes: null, updated_at: at })),
      editions: editions.map(item => ({ id: item.id, work_id: parentId, cover_s3_key: oldCover, thumbnail_s3_key: oldThumb })),
    };
    const pointers = JSON.stringify(rows.editions), buffers = new Map([...coverBucket.objects].map(([key, value]) => [key, Buffer.from(value)]));
    const plan: LinkPlan = { version: 1, operationId: randomUUID(), runId: randomUUID(), planSha256: "",
      targetDatabase: "disposable", kind: "link", mode: "ingestion", createdAt: at,
      modelFingerprint: dataFingerprint(MATCH_MODEL), snapshot: { rows,
        catalogueFingerprint: loaded.catalogueFingerprint, inputFingerprint: loaded.inputFingerprint }, ebook: input, effect,
      choices: { ebookId: input.id, workId: parentId, method: "manual" },
      editionId: effect.editionId!, instanceId: effect.instanceId ?? randomUUID(),
      instanceHistoryId: effect.newCopy ? randomUUID() : null,
      activityId: effect.newCopy ? randomUUID() : null, editionActivityId: null,
    };
    plan.planSha256 = hashMatchingPlan(plan);
    let written: ReturnType<typeof compiledBatch> = [];
    const conn = Object.assign(drizzle.mock(), { batch: async (queries: unknown[]) => { written = compiledBatch(queries); return []; } }) as unknown as Db;
    await linkEbook(conn, plan, plan.targetDatabase);
    expect(receiptInputs(written)[0].coverStage).toBeUndefined();
    expect(written.some(query => query.sql.includes("returning link_written"))).toBe(true);
    expect(written.some(query => /^update "editions"/.test(query.sql))).toBe(false);
    expect(coverBucket.calls).toEqual([]);
    expect(mocks.head).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
    expect(coverBucket.objects).toEqual(buffers);
    expect(JSON.stringify(rows.editions)).toBe(pointers);
  });
});
