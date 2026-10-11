import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { databaseErrorCode } from "@/lib/db/errors";
import { planLink, linkEbook, linkUndoEntry } from "@/lib/ebooks/match/link";
import { planUndoLink, undoLink } from "@/lib/ebooks/match/undo";
import type { Db } from "@/lib/catalogue/work-store";
import { bookHoldings } from "@/lib/catalogue/holdings";
import { readExistingCopyStampOn } from "@/lib/ebooks/match/existing-copy";
import { planSuggestionsForWorkOn, persistWorkSuggestions } from "@/lib/ebooks/match/work-suggestions";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { prepareMatchAtomicExtension } from "@/lib/ebooks/match/review-extension";
import { sql } from "drizzle-orm";
import { loadMatchCatalogue } from "@/lib/ebooks/match/load";
import { planGroupMatching } from "@/lib/ebooks/match/groups";
import { scoreCalibration } from "@/lib/ebooks/match/calibration";
import { planApprovedGroupsOn, applyApprovedGroups } from "@/lib/ebooks/match/apply-groups";
import { planAccessionOn, accessionEbooks } from "@/lib/ebooks/match/accession";
import { matchFingerprint } from "@/lib/ebooks/match/keys";
import type { LinkReceipt } from "@/lib/ebooks/match/link";
import { reserveUndoLog, appendUndoLog, readUndoLog } from "@/lib/books/undo-file";
import { publicationFixture } from "../ebooks/publication-fixture";
import { coverBucket, resetCoverBucket, realCoverBytes } from "../s3/cover-stage-fixture";
import { PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from "@aws-sdk/client-s3";

const sourceStorage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("@/lib/ebooks/storage", () => ({
  headEbookObject: async (key: string) => {
    const buffer = sourceStorage.objects.get(key);
    if (!buffer) throw new Error(`Unexpected source HEAD ${key}`);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    return { size: buffer.length, sha256, metadataSha256: sha256 };
  },
  getEbookObjectRange: async (key: string) => {
    const buffer = sourceStorage.objects.get(key);
    if (!buffer) throw new Error(`Unexpected source GET ${key}`);
    return { length: buffer.length, body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from(buffer)); controller.close(); },
    }) };
  },
}));
vi.mock("@/lib/s3/client", async () => ({ S3_BUCKET: "local-test",
  s3: { send: (await import("../s3/cover-stage-fixture")).catalogueSend } }));
vi.mock("@/lib/enrichment/queue", () => ({ BULK_ACCESSION_PRIORITY: 200,
  queueNewBookEnrichment: async () => ({ ok: true, jobs: [] }) }));

const url = process.env.DURTAL_EBOOK_MATCH_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln495_ebook_match"
  )
    throw new Error(
      "Ebook matching tests require disposable local sln495_ebook_match",
    );
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error("Matcher must use its explicitly supplied connection");
      },
    },
  ),
}));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe.skipIf(!url)("ebook matching on disposable PostgreSQL", () => {
  const c = client!;
  const database = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  let workId: string,
    otherWorkId: string,
    editionId: string,
    otherEditionId: string,
    instanceId: string,
    ebookId: string;
  beforeAll(async () => {
    await migrate(drizzle(c, { schema }), {
      migrationsFolder: "src/lib/db/migrations",
    });
    const [row] =
      await c`select to_regclass('public.ebook_match_candidates')::text as present`;
    if (!row.present)
      throw new Error(
        "Root-approved generated 0082 required before this database suite; manual proposals are never applied by tests",
      );
  }, 60_000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    await c`delete from instances`;
    await c`delete from editions`;
    await c`delete from works where kind='book'`;
    workId = randomUUID();
    otherWorkId = randomUUID();
    editionId = randomUUID();
    otherEditionId = randomUUID();
    instanceId = randomUUID();
    ebookId = randomUUID();
    const locationId = randomUUID();
    await c`insert into locations(id,name,type) values(${locationId},'Matcher test','digital')`;
    await c`insert into works(id,title,kind,original_language) values(${workId},'Nadja','book','en'),(${otherWorkId},'Other','book','en')`;
    await c`insert into editions(id,work_id,title,language) values(${editionId},${workId},'Nadja','en'),(${otherEditionId},${otherWorkId},'Other','en')`;
    await c`insert into instances(id,edition_id,location_id) values(${instanceId},${editionId},${locationId})`;
    await c`insert into ebooks(id,title,import_source,match_tier) values(${ebookId},'Nadja','folder','strong')`;
    const file = publicationFixture();
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status,metadata,manifest_key)
      values(${randomUUID()},${ebookId},${file.sha256},${file.format},${file.sizeBytes},'application/epub+zip',${file.s3Key},'stored',${c.json(file.metadata)},${file.manifestKey})`;
  });
  const insertCandidate = (
    conn: postgres.Sql | postgres.TransactionSql,
    selectedWork = workId,
    selectedEdition: string | null = editionId,
    selectedInstance: string | null = instanceId,
  ) =>
    (conn as postgres.Sql)`insert into ebook_match_candidates(ebook_id,rank,work_id,edition_id,instance_id,edition_rule,probability,weight_bits,margin_bits,reasons,model_version)
      values(${ebookId},1,${selectedWork},${selectedEdition},${selectedInstance},'fill_copy',0.99,10,5,'[]',1)`;
  const expectInvalidated = async () => {
    const [row] =
      await c`select match_tier,(select count(*)::int from ebook_match_candidates where ebook_id=${ebookId}) as candidates from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ match_tier: null, candidates: 0 });
  };
  const waitForLock = async (pid: number) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] =
        await c`select wait_event_type from pg_stat_activity where pid=${pid}`;
      if (row?.wait_event_type === "Lock") return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error(
      "Expected the concurrent candidate/parent statement to wait for a lock",
    );
  };
  it.each([
    ["groups", "later_pair"], ["groups", "commit"], ["groups", "ack"], ["groups", "success"],
    ["accession", "later_pair"], ["accession", "commit"], ["accession", "ack"], ["accession", "success"],
  ] as const)("reconciles %s disk reservations with real committed cover receipts on %s", async (writer, failure) => {
    resetCoverBucket(); sourceStorage.objects.clear();
    // Both targets require a new edition. Two unrelated editions share the old
    // pair, so a failed or uncertain publication must preserve their pointers.
    await c`delete from instances`;
    await c`delete from editions`;
    const siblingId = randomUUID(), personId = randomUUID(), secondId = randomUUID();
    const locationId = randomUUID(), personName = `Cover Fixture ${personId}`;
    await c`insert into locations(id,name,type,is_active) values(${locationId},'Combined cover fixture','digital',true)`;
    await c`insert into app_settings(id,ebook_location_id) values(true,${locationId}) on conflict(id) do update set ebook_location_id=excluded.ebook_location_id`;
    await c`insert into authors(id,name) values(${personId},${personName})`;
    await c`update works set title='Arcane Letters' where id=${otherWorkId}`;
    await c`insert into work_authors(work_id,author_id,role) values(${workId},${personId},'author'),(${otherWorkId},${personId},'author')`;
    const oldCover = 'gold/covers/retained-shared/cover.webp', oldThumb = 'gold/covers/retained-shared/thumb.webp';
    const oldBytes = await realCoverBytes('#557799');
    coverBucket.objects.set(oldCover, Buffer.from(oldBytes)); coverBucket.objects.set(oldThumb, Buffer.from(oldBytes));
    await c`insert into works(id,title,kind,original_language) values(${siblingId},'Retained sibling','book','en')`;
    await c`insert into editions(id,work_id,title,language,cover_s3_key,thumbnail_s3_key)
      values(${editionId},${siblingId},'Retained sibling A','en',${oldCover},${oldThumb}),
        (${otherEditionId},${siblingId},'Retained sibling B','en',${oldCover},${oldThumb})`;
    await c`update ebooks set authors=array[${personName}],language='en',match_tier=null where id=${ebookId}`;
    await c`insert into ebooks(id,title,authors,language,import_source) values(${secondId},'Arcane Letters',array[${personName}],'en','folder')`;
    await c`delete from ebook_files`;
    for (const [i, id] of [ebookId, secondId].entries()) {
      const file = publicationFixture('epub', (i ? 'ac' : 'ab').repeat(32));
      const buffer = await realCoverBytes(i ? '#663311' : '#224466');
      const cover = file.metadata.medallion.gold[1];
      cover.key = cover.key.replace('cover-240.webp','cover-800.webp');
      cover.sha256 = createHash('sha256').update(buffer).digest('hex'); cover.size = buffer.length;
      sourceStorage.objects.set(cover.key, Buffer.from(buffer));
      await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status,metadata,manifest_key,cover_key)
        values(${randomUUID()},${id},${file.sha256},${file.format},${file.sizeBytes},'application/epub+zip',${file.s3Key},'stored',${c.json(file.metadata)},${file.manifestKey},${cover.key})`;
    }
    const loaded = await loadMatchCatalogue(database), inputs = loaded.catalogue.source.ebooks;
    expect(inputs).toHaveLength(2);
    expect(inputs.every(input => input.files[0].availability === 'native' && input.files[0].coverKey)).toBe(true);
    const identity = { runId: randomUUID(), targetDatabase: 'disposable', now: new Date().toISOString() };
    const candidate = await (async () => {
      if (writer === 'accession') return { kind: 'accession' as const,
        plan: await planAccessionOn(database, [ebookId, secondId], identity,
          new Map(inputs.map(input => [input.id, { authors: [{ id: personId }] }]))) };
      const plan = await planGroupMatching(database, inputs.map(input => ({
        groupKey: `registered:${input.id}`, metadataFingerprint: matchFingerprint(input),
        existingEbookId: input.id, ebook: input,
      })), 'e'.repeat(64));
      expect(plan.results.every(result => result.autoLink)).toBe(true);
      const precision = scoreCalibration(plan.binding, plan.sample, plan.sample.map(row => ({
        ebookId: row.ebookId, fingerprint: row.fingerprint, tier: row.tier!, label: 'right' as const,
      })));
      const result = await planApprovedGroupsOn(database, { plan, precision }, inputs.map(input => ({
        groupKey: `registered:${input.id}`, ebookId: input.id,
        fileIds: Object.fromEntries(input.files.map(file => [file.sha256, file.id])),
      })), identity);
      if (result.kind !== 'planned') throw new Error('Expected two group links');
      expect(result.plan.links).toHaveLength(2);
      return { kind: 'groups' as const, plan: result.plan };
    })();
    const siblingBefore = await c`select to_jsonb(e) row from editions e where work_id=${siblingId} order by id`;
    const sourceBefore = new Map([...sourceStorage.objects].map(([key, buffer]) => [key, Buffer.from(buffer)]));
    const directory = await mkdtemp(join(tmpdir(), 'combined-db-cover-reservation-')), disk = join(directory, 'undo.jsonl');
    reserveUndoLog(disk, { version: 1, runId: candidate.plan.runId });
    const reserved: LinkReceipt[] = [];
    let transactions = 0;
    const connection = { transaction: async (run: (tx: Db) => Promise<unknown[]>) => {
      transactions++;
      const result = await drizzle(c, { schema }).transaction(async tx => {
        const result = await run(tx as unknown as Db);
        // Reject after all real SQL statements, including receipt capture, to
        // prove the whole catalogue mutation rolls back together.
        if (failure === 'commit') throw new Error('commit rejected');
        return result;
      });
      // The actual transaction has committed before this transport failure.
      if (failure === 'ack') throw new Error('acknowledgement lost');
      return result;
    } } as unknown as Db;
    const beforeWrite = async (receipt: LinkReceipt) => {
      expect(coverBucket.calls.filter(call => call instanceof PutObjectCommand)).toEqual([]);
      expect(receipt.coverStage?.state).toBe('reserved');
      appendUndoLog(disk, receipt); reserved.push(receipt);
      if (failure === 'later_pair' && reserved.length === 2)
        coverBucket.failBefore.add(receipt.coverStage!.allocation.thumbnailKey);
    };
    try {
      const promise = candidate.kind === 'groups'
        ? applyApprovedGroups(connection, candidate.plan, candidate.plan.targetDatabase, { beforeWrite })
        : accessionEbooks(connection, candidate.plan, candidate.plan.targetDatabase, { beforeWrite });
      if (failure === 'success') await promise;
      else await expect(promise).rejects.toThrow(failure === 'later_pair' ? 'Cover stage verification failed' : failure === 'commit' ? 'commit rejected' : 'acknowledgement lost');
      const entries = readUndoLog<unknown, LinkReceipt>(disk).entries;
      expect(entries).toHaveLength(2);
      expect(new Set(entries.map(entry => entry.operationId)).size).toBe(2);
      expect(entries.every(entry => entry.coverStage?.state === 'reserved')).toBe(true);
      expect(transactions).toBe(failure === 'later_pair' ? 0 : 1);
      const actual = await c`select id,instance_id,match_state,link_written from ebooks order by id`;
      if (failure === 'later_pair' || failure === 'commit') {
        expect(actual.every(row => row.instance_id === null && row.match_state === 'pending' && row.link_written === null)).toBe(true);
        expect((await loadMatchCatalogue(database)).rows).toEqual(loaded.rows);
      } else {
        expect(actual.every(row => row.instance_id && row.match_state === 'linked')).toBe(true);
        for (const entry of entries) {
          const receipt = actual.find(row => row.id === entry.ebookId)!.link_written as LinkReceipt;
          expect(receipt).toMatchObject({ operationId: entry.operationId, runId: entry.runId,
            planSha256: entry.planSha256, editionId: entry.editionId,
            coverArtifacts: entry.coverArtifacts,
            coverStage: { state: 'verified', allocation: entry.coverStage!.allocation } });
          for (const evidence of [receipt.coverStage!.cover!, receipt.coverStage!.thumbnail!]) {
            const buffer = coverBucket.objects.get(evidence.key)!;
            expect(evidence.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
            expect(evidence.size).toBe(buffer.length);
          }
          expect(receipt.after!.edition).toMatchObject({ cover_s3_key: receipt.coverStage!.cover!.key,
            thumbnail_s3_key: receipt.coverStage!.thumbnail!.key });
          expect(receipt.after!.instance).toMatchObject({ id: entry.instanceId, edition_id: entry.editionId });
        }
      }
      expect(coverBucket.objects.size).toBe(failure === 'later_pair' ? 5 : 6);
      expect(await c`select to_jsonb(e) row from editions e where work_id=${siblingId} order by id`).toEqual(siblingBefore);
      expect(coverBucket.objects.get(oldCover)).toEqual(oldBytes); expect(coverBucket.objects.get(oldThumb)).toEqual(oldBytes);
      expect(sourceStorage.objects).toEqual(sourceBefore);
      expect(coverBucket.calls.some(call => call instanceof DeleteObjectCommand || call instanceof DeleteObjectsCommand)).toBe(false);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it("commits a manual fill receipt and undoes only that link without recreating parents", async () => {
    const plan = await planLink(url!, {
      ebookId, workId, instanceId, method: "manual",
    });
    await linkEbook(database, plan, plan.targetDatabase);
    const [linked] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(linked).toMatchObject({ instance_id: instanceId, match_state: "linked" });
    expect(linked.link_written.after).toMatchObject({
      ebook: { id: ebookId, instance_id: instanceId },
      instance: { id: instanceId, edition_id: editionId },
      edition: { id: editionId, work_id: workId },
    });
    const undone = await planUndoLink(url!, linkUndoEntry(plan));
    if (undone.kind !== "planned") throw new Error("Expected own committed undo");
    await undoLink(database, undone.plan, plan.targetDatabase);
    const [pending] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(pending).toMatchObject({ instance_id: null, match_state: "pending", link_written: null });
    expect(await c`select id from instances where id=${instanceId}`).toHaveLength(1);
    expect(await c`select id from editions where id=${editionId}`).toHaveLength(1);
    expect(await planUndoLink(url!, linkUndoEntry(plan))).toMatchObject({ kind: "unchanged" });
  });
  it("atomically edits and links the exact existing copy, then undoes its metadata with a forward version", async () => {
    await c`update instances set notes='Original note', is_signed=true, acquisition_price=12.34,
      updated_at='2026-10-09T12:00:00.123456Z' where id=${instanceId}`;
    const stamp = await readExistingCopyStampOn(database, instanceId);
    expect(stamp.updatedAt).toBe("2026-10-09T12:00:00.123456Z");
    const plan = await planLink(url!, { ebookId, workId, editionId, instanceId, method: "manual",
      existingCopyPatch: { notes: null, acquisitionPrice: "20.00" }, expectedCopyStamp: stamp });
    await linkEbook(database, plan, plan.targetDatabase);
    const [linked] = await c`select link_written from ebooks where id=${ebookId}`;
    expect(linked.link_written.after.instance).toMatchObject({ notes: null, acquisition_price: 20, is_signed: true });
    expect(linked.link_written.metadataProvenance.fields).toEqual(["acquisition_price", "notes"]);
    const beforeUndo = await readExistingCopyStampOn(database, instanceId);
    const undo = await planUndoLink(url!, linkUndoEntry(plan));
    if (undo.kind !== "planned") throw new Error("Expected complete metadata undo");
    await undoLink(database, undo.plan, plan.targetDatabase);
    const [copy] = await c`select to_jsonb(i) row from instances i where id=${instanceId}`;
    expect(copy.row).toMatchObject({ notes: "Original note", acquisition_price: 12.34, is_signed: true,
      edition_id: editionId, format: null, file_size_bytes: null });
    expect((await readExistingCopyStampOn(database, instanceId)).updatedAt > beforeUndo.updatedAt).toBe(true);
  });
  it.each(["metadata", "microsecond"])("refuses concurrent %s edits before link and metadata mutation", async (change) => {
    await c`update instances set notes='Original', updated_at='2026-10-09T12:00:00.123456Z' where id=${instanceId}`;
    const plan = await planLink(url!, { ebookId, workId, editionId, instanceId, method: "manual",
      existingCopyPatch: { notes: "Chosen" }, expectedCopyStamp: await readExistingCopyStampOn(database, instanceId) });
    if (change === "metadata") await c`update instances set notes='Concurrent owner note' where id=${instanceId}`;
    else await c`update instances set updated_at=updated_at+interval '1 microsecond' where id=${instanceId}`;
    const [before] = await c`select to_jsonb(i) row from instances i where id=${instanceId}`;
    await expect(linkEbook(database, plan, plan.targetDatabase)).rejects.toThrow();
    expect((await c`select to_jsonb(i) row from instances i where id=${instanceId}`)[0].row).toEqual(before.row);
    expect((await c`select instance_id,link_written from ebooks where id=${ebookId}`)[0]).toEqual({ instance_id: null, link_written: null });
  });
  it("rolls back the metadata patch, digital fill, link and native receipt when the final trusted suffix fails", async () => {
    const plan = await planLink(url!, { ebookId, workId, editionId, instanceId, method: "manual",
      existingCopyPatch: { notes: "Chosen" }, expectedCopyStamp: await readExistingCopyStampOn(database, instanceId) });
    const [before] = await c`select to_jsonb(i) row from instances i where id=${instanceId}`;
    const extension = prepareMatchAtomicExtension({ coreWriter: "link", coreOperation: plan, ebookIds: [ebookId],
      reviewOperations: [{ version: plan.version, operationId: plan.operationId, runId: plan.runId,
        planSha256: plan.planSha256, targetDatabase: plan.targetDatabase }], purpose: "decision" },
      { extraTables: [], before: () => [], after: (d) => [d.execute(sql`select 1/0`)] });
    await expect(linkEbook(database, plan, plan.targetDatabase, { atomicExtension: extension })).rejects.toThrow();
    expect((await c`select to_jsonb(i) row from instances i where id=${instanceId}`)[0].row).toEqual(before.row);
    expect((await c`select instance_id,link_written from ebooks where id=${ebookId}`)[0]).toEqual({ instance_id: null, link_written: null });
  });
  it("stores actual-model post-create suggestions for one work without a link or accession", async () => {
    const personId = randomUUID(), name = `Suggestion author ${personId}`;
    await c`insert into authors(id,name) values(${personId},${name})`;
    await c`insert into work_authors(work_id,author_id,role) values(${workId},${personId},'author')`;
    await c`update ebooks set authors=${[name]}, language='en' where id=${ebookId}`;
    const target = databaseFingerprint(url!);
    const plan = await planSuggestionsForWorkOn(database, workId, { targetDatabase: target });
    expect(plan.results.some(result => result.candidates.some(candidate => candidate.workId === workId))).toBe(true);
    const before = await c`select to_jsonb(i) row from instances i order by id`;
    const outcome = await persistWorkSuggestions(database, plan, target);
    const [stored] = await c`select count(*)::int count from ebook_match_candidates c join ebooks e on e.id=c.ebook_id
      where c.work_id=${workId} and c.model_version=${plan.results[0].modelVersion} and e.match_state='pending' and e.instance_id is null`;
    expect(outcome).toEqual({ workId, suggestionCount: stored.count, status: "ready" });
    expect(stored.count).toBeGreaterThan(0);
    expect(await c`select to_jsonb(i) row from instances i order by id`).toEqual(before);
    expect((await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`)[0])
      .toEqual({ instance_id: null, match_state: "pending", link_written: null });
  });
  it("rejects stale catalogue evidence inside the writer transaction", async () => {
    const plan = await planLink(url!, { ebookId, workId, instanceId, method: "manual" });
    await c`update works set title='Owner changed title' where id=${workId}`;
    await expect(linkEbook(database, plan, plan.targetDatabase)).rejects.toThrow();
    const [row] = await c`select instance_id,match_state,link_written from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ instance_id: null, match_state: "pending", link_written: null });
  });
  it("adds a digital holding without receiving a physical order or changing partial ownership lifecycle", async () => {
    const physicalLocation = randomUUID(), orderId = randomUUID();
    await c`insert into locations(id,name,type) values(${physicalLocation},'Physical shelf','physical')`;
    await c`insert into instances(id,edition_id,location_id,status) values(${randomUUID()},${editionId},${physicalLocation},'available')`;
    await c`update works set catalogue_status='on_order' where id=${workId}`;
    await c`insert into orders(id,work_id,edition_id,acquisition_method,status,order_date,destination_location_id) values(${orderId},${workId},${editionId},'online_order','placed','2026-10-09',${physicalLocation})`;
    const [before] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    const [destination] = await c`select location_id from instances where id=${instanceId}`;
    const plan = await planLink(url!, {
      ebookId, workId, editionId, method: "manual", locationId: String(destination.location_id),
    });
    await linkEbook(database, plan, plan.targetDatabase);
    const copies = await database.query.instances.findMany({
      where: (row, { eq }) => eq(row.editionId, editionId),
      with: { location: true },
    });
    expect(bookHoldings("on_order", copies.map((row) => ({
      ...row, location: { ...row.location,
        type: row.location.type === "digital" ? "digital" as const : "physical" as const },
    })))).toMatchObject({
      personallyOwned: true, totalActive: 3, physicalCount: 1, digitalCount: 2,
      lifecycle: { isPartiallyHeld: true, isInconsistent: false },
    });
    const [after] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    expect(after.row).toEqual(before.row);
    const [book] = await c`select catalogue_status from works where id=${workId}`;
    expect(book.catalogue_status).toBe("on_order");
    const undo = await planUndoLink(url!, linkUndoEntry(plan));
    if (undo.kind !== "planned") throw new Error("Expected undo");
    await undoLink(database, undo.plan, plan.targetDatabase);
    const [remaining] = await c`select count(*)::int as n from instances where edition_id=${editionId}`;
    expect(remaining.n).toBe(2);
    const [order] = await c`select to_jsonb(o) as row from orders o where id=${orderId}`;
    expect(order.row).toEqual(before.row);
  });
  it("prevents two separately planned operations from filling the same copy", async () => {
    const otherEbookId = randomUUID();
    await c`insert into ebooks(id,title,import_source) values(${otherEbookId},'Nadja','folder')`;
    const secondFile = publicationFixture("epub", "ac".repeat(32));
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status,metadata,manifest_key)
      values(${randomUUID()},${otherEbookId},${secondFile.sha256},${secondFile.format},${secondFile.sizeBytes},'application/epub+zip',${secondFile.s3Key},'stored',${c.json(secondFile.metadata)},${secondFile.manifestKey})`;
    const first = await planLink(url!, { ebookId, workId, instanceId, method: "manual" });
    const second = await planLink(url!, { ebookId: otherEbookId, workId, instanceId, method: "manual" });
    const results = await Promise.allSettled([
      linkEbook(database, first, first.targetDatabase),
      linkEbook(database, second, second.targetDatabase),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [count] = await c`select count(*)::int as n from ebooks where instance_id=${instanceId}`;
    expect(count.n).toBe(1);
  });
  it("preserves its newly created copy when a future FK table references it", async () => {
    const plan = await planLink(url!, { ebookId, workId, editionId, method: "manual", locationId: String((await c`select location_id from instances where id=${instanceId}`)[0].location_id) });
    await linkEbook(database, plan, plan.targetDatabase);
    await c`create table matching_future_dependency(id uuid primary key, instance_id uuid not null references instances(id) on delete cascade)`;
    try {
      await c`insert into matching_future_dependency(id,instance_id) values(${randomUUID()},${plan.instanceId})`;
      const undone = await planUndoLink(url!, linkUndoEntry(plan));
      if (undone.kind !== "planned") throw new Error("Expected undo plan");
      expect(undone.plan.cleanup.deleted.instances).toEqual([]);
      await undoLink(database, undone.plan, plan.targetDatabase);
      expect(await c`select id from instances where id=${plan.instanceId}`).toHaveLength(1);
      expect(await c`select id from matching_future_dependency`).toHaveLength(1);
    } finally {
      await c`drop table matching_future_dependency`;
    }
  });
  it("rejects a copy without its edition and cross-work/edition references", async () => {
    await expect(insertCandidate(c, workId, null)).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
    await expect(insertCandidate(c, otherWorkId)).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
    await expect(
      insertCandidate(c, otherWorkId, otherEditionId),
    ).rejects.toSatisfy(
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
  });
  it.each(["edition", "copy"])(
    "invalidates candidates when their %s is reparented",
    async (parent) => {
      await insertCandidate(c);
      if (parent === "edition")
        await c`update editions set work_id=${otherWorkId} where id=${editionId}`;
      else
        await c`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "invalidates candidates before deleting their %s",
    async (parent) => {
      await insertCandidate(c);
      if (parent === "edition")
        await c`delete from editions where id=${editionId}`;
      else await c`delete from instances where id=${instanceId}`;
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "serializes candidate insertion before concurrent %s reparenting",
    async (parent) => {
      const inserted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const insertion = c.begin(async (tx) => {
        await insertCandidate(tx);
        inserted.resolve();
        await release.promise;
      });
      await inserted.promise;
      const reparent = c.begin(async (tx) => {
        const [backend] =
          await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
        pid = backend.pid;
        started.resolve();
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`update editions set work_id=${otherWorkId} where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
      });
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await Promise.all([insertion, reparent]);
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "rejects stale candidate insertion behind concurrent %s reparenting",
    async (parent) => {
      const changed = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const reparent = c.begin(async (tx) => {
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`update editions set work_id=${otherWorkId} where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`update instances set edition_id=${otherEditionId} where id=${instanceId}`;
        changed.resolve();
        await release.promise;
      });
      await changed.promise;
      const insertion = c
        .begin(async (tx) => {
          const [backend] =
            await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
          pid = backend.pid;
          started.resolve();
          await insertCandidate(tx);
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await reparent;
      expect(databaseErrorCode(await insertion)).toBe("23514");
    },
  );
  it.each(["edition", "copy"])(
    "serializes candidate insertion before concurrent %s deletion",
    async (parent) => {
      const inserted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const insertion = c.begin(async (tx) => {
        await insertCandidate(tx);
        inserted.resolve();
        await release.promise;
      });
      await inserted.promise;
      const deletion = c.begin(async (tx) => {
        const [backend] =
          await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
        pid = backend.pid;
        started.resolve();
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`delete from editions where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`delete from instances where id=${instanceId}`;
      });
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await Promise.all([insertion, deletion]);
      await expectInvalidated();
    },
  );
  it.each(["edition", "copy"])(
    "rejects stale candidate insertion behind concurrent %s deletion",
    async (parent) => {
      const deleted = deferred(),
        release = deferred(),
        started = deferred();
      let pid = 0;
      const deletion = c.begin(async (tx) => {
        if (parent === "edition")
          await (tx as unknown as postgres.Sql)`delete from editions where id=${editionId}`;
        else
          await (tx as unknown as postgres.Sql)`delete from instances where id=${instanceId}`;
        deleted.resolve();
        await release.promise;
      });
      await deleted.promise;
      const insertion = c
        .begin(async (tx) => {
          const [backend] =
            await (tx as unknown as postgres.Sql)`select pg_backend_pid() as pid`;
          pid = backend.pid;
          started.resolve();
          await insertCandidate(tx);
        })
        .then(
          () => null,
          (error: unknown) => error,
        );
      try {
        await started.promise;
        await waitForLock(pid);
      } finally {
        release.resolve();
      }
      await deletion;
      expect(databaseErrorCode(await insertion)).toBe("23514");
    },
  );
  it.each(["NaN", "Infinity", "-Infinity", "-0.1", "1.1"])(
    "rejects invalid stored probability %s",
    async (value) => {
      await expect(
        c`update ebooks set match_probability=${value}::real where id=${ebookId}`,
      ).rejects.toSatisfy(
        (error: unknown) => databaseErrorCode(error) === "23514",
      );
    },
  );
  it("clears duplicate review tier when its target disappears", async () => {
    const target = randomUUID();
    await c`insert into ebooks(id,title,import_source) values(${target},'Duplicate target','folder')`;
    await c`update ebooks set match_tier='duplicate',duplicate_of_id=${target} where id=${ebookId}`;
    await c`delete from ebooks where id=${target}`;
    const [row] =
      await c`select match_tier,duplicate_of_id from ebooks where id=${ebookId}`;
    expect(row).toMatchObject({ match_tier: null, duplicate_of_id: null });
  });
});
