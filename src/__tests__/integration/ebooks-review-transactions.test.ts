import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql, type SQL } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
import { ebookFileKey } from "@/lib/ebooks/keys";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { applyEbookReview, prepareEbookReview, undoEbookReview, type ReviewContext } from "@/lib/ebooks/review/service";
import { readReviewBeforeOn, readReviewReceiptOn, prepareReviewAtomicWrite } from "@/lib/ebooks/review/store";
import { reviewPayloadHash, reviewRequestHash, reviewUndoOperationId } from "@/lib/ebooks/review/receipts";
import { REVIEW_RECEIPT_EVENTS } from "@/lib/ebooks/review/receipts";
import { reviewTimestampIsValidSql, reviewTimestampSql } from "@/lib/ebooks/review/store-sql";
import { planAccessionOn, accessionEbooks } from "@/lib/ebooks/match/accession";
import { withReadOnlyPlanningConnection } from "@/lib/enrichment/read-only-session";
import { reviewOperationSchema } from "@/lib/validations/ebook-review";
import type { MatchOperationIdentity } from "@/lib/ebooks/match/types";
import { getEbookReview } from "@/lib/ebooks/review/queries";
import { reviewNullableUuidSql } from "@/lib/ebooks/review/store-sql";
import { resultRows } from "@/lib/harmonization/store";
import { prepareEbookReviewSelection, applyEbookReviewSelection, undoEbookReviewSelection } from "@/lib/ebooks/review/bulk";
import { prepareWorkStatusReview, applyWorkStatusReview, undoWorkStatusReview } from "@/lib/ebooks/review/work-service";
import { readWorkReviewBeforeOn, readWorkReviewReceiptOn } from "@/lib/ebooks/review/work-store";
import { inspectReviewUnlinkOn } from "@/lib/ebooks/review/unlink-inspection";
import { prepareEbookUnlinkReview, applyEbookUnlinkReview } from "@/lib/ebooks/review/unlink-service";
import { planLinkOn, linkEbook } from "@/lib/ebooks/match/link";
import { planRegisteredMatchingOn, labelMatchingDocument } from "@/lib/ebooks/match/command";
import { planApprovedGroupsOn, applyApprovedGroups } from "@/lib/ebooks/match/apply-groups";

// Opt-in SOURCE fixture only. Future root-authorized test:local creates this
// disposable database; guarded beforeAll applies only repository-journaled
// migrations. Approved generated 495 schema must be landed before that run.
// No DATABASE_URL fallback, private/manual migration proposal or remote service.
const url = process.env.DURTAL_EBOOK_REVIEW_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln496_ebook_review")
    throw new Error("Review fixtures require disposable local sln496_ebook_review");
}
const client = url ? postgres(url, { prepare: false, max: 5, onnotice: () => {} }) : null;
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() {
  throw new Error("Review fixture must use its supplied connection");
} }) }));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(),
  CACHE_TAGS: { works: "works", editions: "editions", activity: "activity", authors: "authors", series: "series" } }));

// Exercises atomicOn's batch branch with the SAME queries in one real PG
// transaction. This is driver-construction parity, not a claim about live Neon.
function batchDriver(database: Db): Db {
  return new Proxy(database, { get(target, property, receiver) {
    if (property === "batch") return (queries: unknown[]) => database.transaction(async (tx) => {
      const results: unknown[] = [];
      for (const query of queries) {
        if (!query || typeof (query as { getSQL?: unknown }).getSQL !== "function")
          throw new Error("Expected a real Drizzle query");
        results.push(await tx.execute((query as { getSQL(): SQL }).getSQL()));
      }
      return results;
    });
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}

describe.skipIf(!url)("review store on disposable PostgreSQL", () => {
  const c = client!;
  const database = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  let ebookId: string, workId: string, editionId: string, locationId: string;
  const context = (driver: "transaction" | "batch"): ReviewContext => ({
    channel: "api", planningUrl: url!, targetDatabase: databaseFingerprint(url!),
    writeDb: driver === "batch" ? batchDriver(database) : database,
  });
  beforeAll(async () => {
    // test:local creates an empty, uniquely named DB for this suite. Follow the
    // same guarded migration convention as the other isolated integration suites.
    await migrate(drizzle(c, { schema }), { migrationsFolder: "src/lib/db/migrations" });
    const [ready] = await c`select to_regclass('public.ebook_match_candidates') is not null as candidates,
      to_regprocedure('public.harmonization_assert(boolean,text)') is not null as assertions`;
    if (!ready.candidates || !ready.assertions)
      throw new Error("Approved generated matching schema/assertions must be journaled before review fixture execution");
  }, 60_000);
  afterAll(async () => { await client?.end(); });
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    await c`delete from ebook_files`;
    await c`delete from ebooks`;
    await c`delete from instances`;
    await c`delete from editions`;
    await c`delete from works where kind='book'`;
    // Audit rows survive ebook deletion intentionally; this is a dedicated DB.
    await c`delete from activity_events`;
    ebookId = randomUUID(); workId = randomUUID(); editionId = randomUUID(); locationId = randomUUID();
    await c`insert into locations(id,name,type) values(${locationId},'Review fixture','digital')`;
    await c`insert into app_settings(id,ebook_location_id) values(true,${locationId})
      on conflict(id) do update set ebook_location_id=excluded.ebook_location_id`;
    await c`insert into works(id,title,kind,original_language) values(${workId},'Nadja','book','en')`;
    await c`insert into editions(id,work_id,title,language) values(${editionId},${workId},'Nadja','en')`;
    await c`insert into ebooks(id,title,language,import_source,updated_at)
      values(${ebookId},'Nadja','en','folder','2020-01-01T00:00:00.123456Z')`;
    const hash = "a".repeat(64);
    // Actual canonical legacy key + stored status goes through core's real
    // availability loader. No fabricated native/publication capability.
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status)
      values(${randomUUID()},${ebookId},${hash},'epub',1000,'application/epub+zip',${ebookFileKey(hash, "epub")},'stored')`;
  });
  const prepareLink = (ctx: ReviewContext) => prepareEbookReview({ action: "link", ebookId, workId,
    choice: { kind: "add_copy", editionId }, locationId, newCopyDraft: { notes: "Review copy" } }, ctx);
  const row = async () => (await c`select to_jsonb(e) as value from ebooks e where id=${ebookId}`)[0]?.value;
  const ledger = async () => (await c`select id from activity_events
    where event_key in (${REVIEW_RECEIPT_EVENTS.ebookDecision},${REVIEW_RECEIPT_EVENTS.ebookUndo}) order by id`);
  const workLedger = async () => (await c`select to_jsonb(a) as row from activity_events a
    where event_key in (${REVIEW_RECEIPT_EVENTS.workDecision},${REVIEW_RECEIPT_EVENTS.workUndo}) order by id`);
  const catalogueCounts = async () => (await c`select
    (select count(*)::int from instances) as copies,
    (select count(*)::int from editions) as editions,
    (select count(*)::int from works) as works,
    (select count(*)::int from authors) as authors,
    (select count(*)::int from instance_status_history) as copy_history,
    (select count(*)::int from work_status_history) as work_history,
    (select count(*)::int from activity_events) as activity`)[0];
  const identityOf = (value: MatchOperationIdentity) => reviewOperationSchema.parse({
    version: value.version, operationId: value.operationId, runId: value.runId,
    targetDatabase: value.targetDatabase, planSha256: value.planSha256,
  });
  const nativeLink = async (ctx: ReviewContext) => {
    const plan = await withReadOnlyPlanningConnection(url!, (conn) => planLinkOn(conn,
      { ebookId, workId, editionId, locationId, method: "manual" },
      { runId: randomUUID(), targetDatabase: ctx.targetDatabase }), { isolationLevel: "repeatable read" });
    await linkEbook(ctx.writeDb, plan, ctx.targetDatabase);
    return identityOf(plan);
  };
  const nativeAutomaticLink = async (ctx: ReviewContext) => {
    // Actual controlled fixture ISBN/title establish the right label. Use the
    // real scoped sample/calibration/group boundary, never patch a native
    // manual receipt into an automatic receipt or inject an approved plan.
    await c`update editions set isbn_13='9780307476463' where id=${editionId}`;
    await c`update ebooks set isbns=ARRAY['9780307476463']::text[] where id=${ebookId}`;
    const prepared = await withReadOnlyPlanningConnection(url!, async (conn) => {
      const document = await planRegisteredMatchingOn(conn, ctx.targetDatabase, [ebookId]);
      expect(document.approval.plan.sample).toHaveLength(1);
      expect(document.approval.plan.sample[0]).toMatchObject({ ebookId, tier: "exact", autoLink: true });
      const approved = labelMatchingDocument(document, document.approval.plan.sample.map((sample) => ({
        ebookId: sample.ebookId, fingerprint: sample.fingerprint, tier: sample.tier!, label: "right" as const,
      })));
      const planned = await planApprovedGroupsOn(conn, approved.approval, approved.registered,
        { runId: approved.runId, targetDatabase: ctx.targetDatabase });
      if (planned.kind !== "planned") throw new Error("Actual automatic fixture group did not produce a write");
      expect(planned.plan.links).toHaveLength(1);
      return planned.plan;
    }, { isolationLevel: "repeatable read" });
    const written = await applyApprovedGroups(ctx.writeDb, prepared, ctx.targetDatabase);
    expect(written.linked).toBe(1); expect(written.receipts).toHaveLength(1);
    return identityOf(written.receipts[0]);
  };

  it.each([
    ["0001-01-01T00:00:00Z", true, "0001-01-01T00:00:00.000000Z"],
    ["9999-12-31T23:59:59.999999Z", true, "9999-12-31T23:59:59.999999Z"],
    ["4000-01-01 BC", false, null], ["0001-01-01 BC", false, null],
    ["10000-01-01T00:00:00Z", false, null], ["infinity", false, null], ["-infinity", false, null],
  ] as const)("represents actual timestamp %s losslessly or refuses it", async (value, valid, text) => {
    const result = resultRows<{ valid: boolean; value: string | null }>(await database.execute(sql`
      select ${reviewTimestampIsValidSql(sql`${value}::timestamptz`)} as valid,
      ${reviewTimestampSql(sql`${value}::timestamptz`)} as value`));
    expect(result[0]).toMatchObject({ valid, value: text });
  });
  it.each([
    [null, true], ["00000000-0000-0000-0000-000000000000", true],
    ["ffffffff-ffff-ffff-ffff-ffffffffffff", true],
    ["11111111-1111-8111-b111-111111111111", true],
    ["11111111-1111-0111-8111-111111111111", false],
    ["11111111-1111-4111-0111-111111111111", false],
  ] as const)("matches nullable strict UUID semantics on actual PostgreSQL value %s", async (value, valid) => {
    const result = resultRows<{ valid: boolean }>(await database.execute(sql`
      select ${reviewNullableUuidSql(sql`${value}::uuid`)} as valid`));
    expect(result[0]).toMatchObject({ valid });
  });
  it("refuses unsupported candidate timestamp normalization during protected preparation", async () => {
    await c`insert into ebook_match_candidates(ebook_id,rank,work_id,edition_id,edition_rule,
      probability,weight_bits,reasons,model_version,created_at)
      values(${ebookId},1,${workId},${editionId},'isbn_edition',0.99,10,'[]',1,'4000-01-01 BC')`;
    await expect(withReadOnlyPlanningConnection(url!, (conn) => readReviewBeforeOn(conn, ebookId),
      { isolationLevel: "repeatable read" })).rejects.toMatchObject({ code: "invalid_receipt" });
  });
  it("refuses a present audit row whose timestamp cannot be losslessly guarded for replay", async () => {
    const ctx = context("transaction"), prepared = await prepareEbookReview({ action: "keep", ebookId }, ctx);
    await applyEbookReview(prepared.request, prepared.previewToken, ctx);
    await c`update activity_events set created_at='4000-01-01 BC'::timestamptz where id=${prepared.request.operation.operationId}`;
    await expect(applyEbookReview(prepared.request, "0".repeat(64), ctx)).rejects.toMatchObject({ code: "operation_collision" });
    expect(await ledger()).toHaveLength(1);
  });

  describe.each(["transaction", "batch"] as const)("%s driver", (driver) => {
    it("inspects the actual fresh-unlink core cleanup and retains a later edited copy without writing", async () => {
      const ctx = context(driver), link = await prepareLink(ctx);
      await applyEbookReview(link.request, link.previewToken, ctx);
      const [linked] = await c`select instance_id from ebooks where id=${ebookId}`;
      await c`update instances set notes='Human edit',updated_at=updated_at+interval '1 microsecond' where id=${linked.instance_id}`;
      const before = await row(), counts = await catalogueCounts();
      const inspection = await withReadOnlyPlanningConnection(url!, (conn) =>
        inspectReviewUnlinkOn(conn, { ebookId, mode: "unlink" }, ctx.targetDatabase), { isolationLevel: "repeatable read" });
      expect(inspection.preview.keptCopy).toBe(true);
      expect(inspection.preview.retained).toEqual(expect.arrayContaining([expect.objectContaining({ table: "instances", id: linked.instance_id })]));
      expect(inspection.policy.originalMatchingOperation.operationId).toBe(inspection.receipt.operationId);
      expect(await row()).toEqual(before); expect(await catalogueCounts()).toEqual(counts); expect(await ledger()).toHaveLength(1);
    });
    it("unlinks an actual native link without an original review, retains a changed copy and replays after target/cache loss", async () => {
      const ctx = context(driver), originalMatchingOperation = await nativeLink(ctx);
      expect(await ledger()).toHaveLength(0);
      const [linked] = await c`select instance_id from ebooks where id=${ebookId}`;
      await c`update ebooks set title='Human metadata edit' where id=${ebookId}`;
      await c`update instances set notes='Human copy edit',updated_at=updated_at+interval '1 microsecond' where id=${linked.instance_id}`;
      const copies = await c`select to_jsonb(i) as row from instances i where id=${linked.instance_id}`;
      const files = await c`select to_jsonb(f) as row from ebook_files f where ebook_id=${ebookId} order by id`;
      const before = await readReviewBeforeOn(database, ebookId);
      const preview = await prepareEbookUnlinkReview({ ebookId, mode: "unlink", originalMatchingOperation }, ctx);
      expect(preview.preview.keptCopy).toBe(true);
      const transport = { request: preview.request, previewToken: preview.previewToken };
      const result = await applyEbookUnlinkReview(transport, ctx);
      const receipt = await readReviewReceiptOn(database, result.operation.operationId);
      expect(receipt!.receipt).toMatchObject({ action: "unlink", originalOperation: null,
        eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision, before: before!.snapshot,
        operation: preview.request.operation, requestHash: reviewRequestHash(preview.request), effectHash: preview.request.effectHash });
      expect(receipt!.receipt.after).toEqual((await readReviewBeforeOn(database, ebookId))!.snapshot);
      expect(receipt!.receipt.after.updatedAt > before!.snapshot.updatedAt).toBe(true);
      expect(result).toMatchObject({ keptCopy: true, undo: { available: false, originalOperation: null } });
      expect((await row()).title).toBe("Human metadata edit");
      expect((await row()).link_written).toBeNull(); expect((await row()).match_method).toBeNull();
      expect(await c`select to_jsonb(i) as row from instances i where id=${linked.instance_id}`).toEqual(copies);
      expect(await c`select to_jsonb(f) as row from ebook_files f where ebook_id=${ebookId} order by id`).toEqual(files);
      expect(await ledger()).toEqual([{ id: result.operation.operationId }]);
      expect(await applyEbookUnlinkReview({ ...transport, previewToken: "0".repeat(64) }, ctx)).toEqual(result);
      await c`delete from ebook_files where ebook_id=${ebookId}`;
      await c`delete from ebooks where id=${ebookId}`;
      expect(await applyEbookUnlinkReview({ ...transport, previewToken: "0".repeat(64) }, ctx)).toEqual(result);
      expect(await readReviewReceiptOn(database, result.operation.operationId)).toEqual(receipt);
      expect(await ledger()).toEqual([{ id: result.operation.operationId }]);
    });
    it("refuses a manual link as automatic Undo and a later metadata edit after a fresh unlink preview", async () => {
      const ctx = context(driver), originalMatchingOperation = await nativeLink(ctx);
      await expect(prepareEbookUnlinkReview({ ebookId, mode: "automatic_undo", originalMatchingOperation }, ctx))
        .rejects.toMatchObject({ code: "stale_review" });
      const preview = await prepareEbookUnlinkReview({ ebookId, mode: "unlink", originalMatchingOperation }, ctx);
      // No timestamp advancement: the full raw snapshot must still refuse.
      await c`update ebooks set title='Changed after visible preview' where id=${ebookId}`;
      const before = await row(), counts = await catalogueCounts();
      await expect(applyEbookUnlinkReview({ request: preview.request, previewToken: preview.previewToken }, ctx)).rejects.toThrow();
      expect(await row()).toEqual(before); expect(await catalogueCounts()).toEqual(counts); expect(await ledger()).toHaveLength(0);
    });
    it("undoes an unchanged actual calibrated automatic link as a new original-null decision", async () => {
      const ctx = context(driver), originalMatchingOperation = await nativeAutomaticLink(ctx);
      expect(await ledger()).toHaveLength(0);
      const before = await readReviewBeforeOn(database, ebookId);
      const preview = await prepareEbookUnlinkReview({ ebookId, mode: "automatic_undo", originalMatchingOperation }, ctx);
      expect(preview.preview.mode).toBe("automatic_undo");
      const result = await applyEbookUnlinkReview({ request: preview.request, previewToken: preview.previewToken }, ctx);
      const receipt = await readReviewReceiptOn(database, result.operation.operationId);
      expect(result.operation.operationId).not.toBe(originalMatchingOperation.operationId);
      expect(receipt!.receipt).toMatchObject({ action: "unlink", originalOperation: null,
        before: before!.snapshot, operation: preview.request.operation,
        requestHash: reviewRequestHash(preview.request), effectHash: preview.request.effectHash });
      expect(receipt!.receipt.after).toEqual((await readReviewBeforeOn(database, ebookId))!.snapshot);
      expect(receipt!.receipt.after.updatedAt > before!.snapshot.updatedAt).toBe(true);
      expect(await ledger()).toEqual([{ id: result.operation.operationId }]);
    });
    it("refuses every later eBook edit for actual automatic Undo while a fresh unlink can bind it", async () => {
      const ctx = context(driver), originalMatchingOperation = await nativeAutomaticLink(ctx);
      await c`update ebooks set title='Later automatic-link metadata' where id=${ebookId}`;
      const before = await row(), counts = await catalogueCounts();
      await expect(prepareEbookUnlinkReview({ ebookId, mode: "automatic_undo", originalMatchingOperation }, ctx))
        .rejects.toMatchObject({ code: "stale_review" });
      expect(await row()).toEqual(before); expect(await catalogueCounts()).toEqual(counts); expect(await ledger()).toHaveLength(0);
      const preview = await prepareEbookUnlinkReview({ ebookId, mode: "unlink", originalMatchingOperation }, ctx);
      await applyEbookUnlinkReview({ request: preview.request, previewToken: preview.previewToken }, ctx);
      expect((await row()).title).toBe("Later automatic-link metadata"); expect(await ledger()).toHaveLength(1);
    });
    it("rolls back real unlink, catalogue cleanup and the new decision receipt when an audit trigger changes metadata", async () => {
      const ctx = context(driver), originalMatchingOperation = await nativeLink(ctx);
      const preview = await prepareEbookUnlinkReview({ ebookId, mode: "unlink", originalMatchingOperation }, ctx);
      const before = await row(), counts = await catalogueCounts();
      await c`create or replace function sln496_unlink_corrupt_final() returns trigger language plpgsql as $$
        begin
          if new.metadata #>> '{extra,ebookReview,action}'='unlink' then
            update ebooks set title='Trigger corruption' where id=new.entity_id;
          end if;
          return new;
        end $$`;
      await c`create trigger sln496_unlink_corrupt_final after insert on activity_events
        for each row execute function sln496_unlink_corrupt_final()`;
      try {
        await expect(applyEbookUnlinkReview({ request: preview.request, previewToken: preview.previewToken }, ctx)).rejects.toThrow();
        expect(await row()).toEqual(before); expect(await catalogueCounts()).toEqual(counts);
        expect(await ledger()).toHaveLength(0);
      } finally {
        await c`drop trigger if exists sln496_unlink_corrupt_final on activity_events`;
        await c`drop function if exists sln496_unlink_corrupt_final()`;
      }
    });
    it("projects actual nonready accession/link effects to sanitized fields without issuing a write", async () => {
      const ctx = context(driver);
      await expect(prepareEbookReview({ action: "accession", ebookId }, ctx)).rejects.toMatchObject({
        code: "preparation_required", issues: expect.arrayContaining([expect.objectContaining({ ebookId, field: "authors", code: "author" })]),
      });
      await c`delete from ebook_files`;
      await expect(prepareLink(ctx)).rejects.toMatchObject({ code: "preparation_required",
        issues: expect.arrayContaining([expect.objectContaining({ ebookId, field: "file", code: "verified_file" })]) });
      expect(await ledger()).toHaveLength(0); expect((await row()).match_state).toBe("pending");
    });
    it("changes only work status/history, compensates once with a forward version and replays after target loss", async () => {
      const ctx = context(driver), link = await prepareLink(ctx);
      await applyEbookReview(link.request, link.previewToken, ctx);
      const ebookAudit = await readReviewReceiptOn(database, link.request.operation.operationId);
      expect(ebookAudit).not.toBeNull();
      const dependencies = await c`select to_jsonb(i) as row from instances i order by id`;
      const ebook = await row();
      const before = await readWorkReviewBeforeOn(database, workId);
      const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId }, ctx);
      const transport = { request: prepared.request, previewToken: prepared.previewToken };
      const result = await applyWorkStatusReview(transport, ctx);
      expect(result.catalogueStatus).toBe("accessioned");
      const original = await readWorkReviewReceiptOn(database, result.operation.operationId);
      const decisions = await workLedger();
      expect(decisions).toHaveLength(1);
      expect(decisions[0].row).toMatchObject({ id: result.operation.operationId, entity_type: "work",
        entity_id: workId, event_key: REVIEW_RECEIPT_EVENTS.workDecision });
      expect(decisions[0].row.metadata.extra.ebookReview).toEqual(original!.receipt);
      expect(original!.receipt.before).toEqual(before!.stamp);
      expect(original!.receipt.after.updatedAt > before!.stamp.updatedAt).toBe(true);
      expect(original!.receipt.after.dependencyFingerprint).toBe(before!.stamp.dependencyFingerprint);
      const undoRequest = { workId, originalOperation: result.operation };
      const undone = await undoWorkStatusReview(undoRequest, ctx);
      expect(undone.catalogueStatus).toBe("tracked");
      const compensation = await readWorkReviewReceiptOn(database, undone.operation.operationId);
      const workAudits = await workLedger();
      expect(workAudits).toHaveLength(2);
      expect(workAudits.map(({ row }) => row)).toEqual(expect.arrayContaining([
        decisions[0].row, expect.objectContaining({ id: undone.operation.operationId, entity_type: "work",
          entity_id: workId, event_key: REVIEW_RECEIPT_EVENTS.workUndo,
          metadata: compensation!.row.metadata }),
      ]));
      expect(compensation!.receipt.before).toEqual(original!.receipt.after);
      expect(compensation!.receipt.after.updatedAt > original!.receipt.after.updatedAt).toBe(true);
      expect(await c`select to_jsonb(i) as row from instances i order by id`).toEqual(dependencies);
      expect(await row()).toEqual(ebook);
      const histories = await c`select to_jsonb(h) as row from work_status_history h where work_id=${workId} order by changed_at,id`;
      expect(await undoWorkStatusReview(undoRequest, ctx)).toEqual(undone);
      expect(await c`select to_jsonb(h) as row from work_status_history h where work_id=${workId} order by changed_at,id`).toEqual(histories);
      await c`delete from ebook_files`;
      await c`delete from ebooks`;
      await c`delete from instances`;
      await c`delete from works where id=${workId}`;
      expect(await applyWorkStatusReview({ ...transport, previewToken: "0".repeat(64) }, ctx)).toEqual(result);
      expect(await undoWorkStatusReview(undoRequest, ctx)).toEqual(undone);
      expect(await workLedger()).toEqual(workAudits);
      expect((await ledger()).map(({ id }) => id)).toEqual([link.request.operation.operationId]);
      expect(await readReviewReceiptOn(database, link.request.operation.operationId)).toEqual(ebookAudit);
    });

    it.each(["history", "holding", "order", "work"] as const)("refuses work Undo after a later %s dependency change", async (change) => {
      const ctx = context(driver), link = await prepareLink(ctx);
      await applyEbookReview(link.request, link.previewToken, ctx);
      const ebookAudit = await readReviewReceiptOn(database, link.request.operation.operationId);
      expect(ebookAudit).not.toBeNull();
      const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId }, ctx);
      const result = await applyWorkStatusReview({ request: prepared.request, previewToken: prepared.previewToken }, ctx);
      const workAudits = await workLedger();
      expect(workAudits).toHaveLength(1);
      expect(workAudits[0].row).toMatchObject({ id: result.operation.operationId, entity_type: "work",
        entity_id: workId, event_key: REVIEW_RECEIPT_EVENTS.workDecision });
      if (change === "history") await c`insert into work_status_history(work_id,from_status,to_status,notes)
        values(${workId},'accessioned','accessioned','A later history correction')`;
      if (change === "holding") await c`update instances set notes='Edited later' where edition_id=${editionId}`;
      if (change === "order") await c`insert into orders(work_id,acquisition_method,order_date)
        values(${workId},'digital_purchase','2026-10-10')`;
      if (change === "work") await c`update works set notes='Edited without advancing the timestamp' where id=${workId}`;
      const [before] = await c`select to_jsonb(w) as row from works w where id=${workId}`;
      await expect(undoWorkStatusReview({ workId, originalOperation: result.operation }, ctx)).rejects.toMatchObject({ code: "stale_review" });
      expect((await c`select to_jsonb(w) as row from works w where id=${workId}`)[0]).toEqual(before);
      expect(await workLedger()).toEqual(workAudits);
      expect((await ledger()).map(({ id }) => id)).toEqual([link.request.operation.operationId]);
      expect(await readReviewReceiptOn(database, link.request.operation.operationId)).toEqual(ebookAudit);
    });

    it("rolls back work status and history when an audit trigger corrupts the actual status receipt", async () => {
      const ctx = context(driver), link = await prepareLink(ctx);
      await applyEbookReview(link.request, link.previewToken, ctx);
      const ebookAudit = await readReviewReceiptOn(database, link.request.operation.operationId);
      expect(ebookAudit).not.toBeNull();
      expect(await workLedger()).toEqual([]);
      const prepared = await prepareWorkStatusReview({ action: "mark_accessioned", workId }, ctx);
      const before = await readWorkReviewBeforeOn(database, workId), fault = await c.reserve();
      try {
        await fault`create or replace function pg_temp.sln496_corrupt_work_review() returns trigger language plpgsql as $$
          begin
            if new.event_key='ebook.review.catalogue_status.v1' then
              new.metadata=jsonb_set(new.metadata,'{extra,ebookReview,outcome,message}','"Corrupted work receipt"'::jsonb);
            end if;
            return new;
          end $$`;
        await fault`create trigger sln496_work_review_fault before insert on activity_events
          for each row execute function pg_temp.sln496_corrupt_work_review()`;
      } finally { fault.release(); }
      try {
        await expect(applyWorkStatusReview({ request: prepared.request, previewToken: prepared.previewToken }, ctx))
          .rejects.toMatchObject({ code: "invalid_receipt" });
        expect(await readWorkReviewBeforeOn(database, workId)).toEqual(before);
        expect(await workLedger()).toEqual([]);
        expect((await ledger()).map(({ id }) => id)).toEqual([link.request.operation.operationId]);
        expect(await readReviewReceiptOn(database, link.request.operation.operationId)).toEqual(ebookAudit);
      } finally { await c`drop trigger sln496_work_review_fault on activity_events`; }
    });

    it("commits a public accession selection, resolves a lost response and replays the entire set after target/cache loss", async () => {
      const otherId = randomUUID(), hash = "b".repeat(64);
      await c`insert into ebooks(id,title,language,import_source,updated_at)
        values(${otherId},'Other public bulk book','en','folder','2020-01-01T00:00:00.123456Z')`;
      await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status)
        values(${randomUUID()},${otherId},${hash},'epub',1000,'application/epub+zip',${ebookFileKey(hash, "epub")},'stored')`;
      const ids = [ebookId, otherId], ctx = context(driver);
      const prepared = await prepareEbookReviewSelection({ intents: ids.map((id) => ({
        action: "accession", ebookId: id, authors: [{ name: "Public bulk author" }], language: "en" })) }, ctx);
      expect(prepared.preparedCount).toBe(2); expect(prepared.deferredIntents).toEqual([]);
      let lost = false, atomics = 0;
      const method = driver === "batch" ? "batch" : "transaction";
      const writeDb = new Proxy(ctx.writeDb, { get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === method) return async (...args: unknown[]) => {
          atomics++;
          const result = await Reflect.apply(value, target, args);
          if (!lost) { lost = true; throw new Error("Simulated response loss AFTER real atomic commit"); }
          return result;
        };
        return typeof value === "function" ? value.bind(target) : value;
      } });
      const result = await applyEbookReviewSelection({ requests: prepared.requests, previewToken: prepared.previewToken }, { ...ctx, writeDb });
      expect(result.outcomes.map((row) => row.ebookId)).toEqual(ids);
      expect(atomics).toBe(2); // One writer; one guarded receipt-set replay.
      expect(await ledger()).toHaveLength(2);
      const rows = await c`select match_state,link_written from ebooks order by id`;
      expect(rows.every((row) => row.match_state === 'linked' && row.link_written?.after)).toBe(true);
      await c`delete from ebook_files`;
      await c`delete from ebooks`;
      expect(await applyEbookReviewSelection({ requests: prepared.requests, previewToken: "0".repeat(64) }, ctx)).toEqual(result);
      expect(await ledger()).toHaveLength(2);
    });

    it("returns every durable public selection Undo outcome without replacing its original identities on retry", async () => {
      const otherId = randomUUID();
      await c`insert into ebooks(id,title,language,import_source,updated_at)
        values(${otherId},'Other undo book','en','folder','2020-01-01T00:00:00.123456Z')`;
      const ctx = context(driver), originals = [];
      for (const id of [ebookId, otherId]) {
        const prepared = await prepareEbookReview({ action: "keep", ebookId: id }, ctx);
        const outcome = await applyEbookReview(prepared.request, prepared.previewToken, ctx);
        originals.push({ ebookId: id, originalOperation: outcome.operation });
      }
      const result = await undoEbookReviewSelection({ requests: originals }, ctx);
      expect(result.stopped).toBe(false); expect(result.rows.every((row) => row.status === "committed")).toBe(true);
      expect(await ledger()).toHaveLength(4);
      const after = await c`select to_jsonb(e) as row from ebooks e order by id`;
      expect(await undoEbookReviewSelection({ requests: originals }, ctx)).toEqual(result);
      expect(await c`select to_jsonb(e) as row from ebooks e order by id`).toEqual(after);
      expect(await ledger()).toHaveLength(4);
    });

    it.each(["11111111-1111-0111-8111-111111111111", "11111111-1111-4111-0111-111111111111"])(
      "rolls back default-selected PostgreSQL-valid but schema-invalid copy %s before commit", async (copyId) => {
        await c`insert into instances(id,edition_id,location_id) values(${copyId},${editionId},${locationId})`;
        await c`insert into ebook_match_candidates(ebook_id,rank,work_id,edition_id,instance_id,edition_rule,
          probability,weight_bits,margin_bits,reasons,model_version)
          values(${ebookId},1,${workId},${editionId},${copyId},'fill_copy',0.99,10,5,'[]',1)`;
        const review = await getEbookReview(url!, ebookId), candidate = review.candidates[0];
        expect(candidate.eligible).toBe(true); // Actual core effect, no explicit client copy UUID.
        const ctx = context(driver), prepared = await prepareEbookReview({ action: "accept", ebookId,
          rank: 1, candidateHash: candidate.candidateHash }, ctx);
        const before = await row(), counts = await catalogueCounts();
        const [copy] = await c`select to_jsonb(i) as value from instances i where id=${copyId}`;
        await expect(applyEbookReview(prepared.request, prepared.previewToken, ctx)).rejects.toMatchObject({ code: "invalid_receipt" });
        expect(await row()).toEqual(before);
        expect(await catalogueCounts()).toEqual(counts);
        expect((await c`select to_jsonb(i) as value from instances i where id=${copyId}`)[0].value).toEqual(copy.value);
        expect(await ledger()).toHaveLength(0);
      });

    it.each(["4000-01-01 BC", "infinity", "-infinity", "10000-01-01T00:00:00Z"])(
      "rolls back a core mutation whose actual final version is %s", async (value) => {
        const ctx = context(driver), prepared = await prepareLink(ctx), before = await row(), counts = await catalogueCounts();
        const fault = await c.reserve();
        try {
          await fault`create or replace function pg_temp.sln496_bad_version() returns trigger language plpgsql as $$
            begin
              if new.match_state = 'linked' then new.updated_at := TG_ARGV[0]::timestamptz; end if;
              return new;
            end $$`;
          // Fixed test matrix only; SQL quote escaping retains an exact literal.
          await fault.unsafe("create trigger sln496_version_fault before update on ebooks for each row execute function pg_temp.sln496_bad_version('" + value.replace(/'/g, "''") + "')");
        } finally { fault.release(); }
        try {
          await expect(applyEbookReview(prepared.request, prepared.previewToken, ctx)).rejects.toMatchObject({ code: "invalid_receipt" });
          expect(await row()).toEqual(before);
          expect(await catalogueCounts()).toEqual(counts);
          expect(await ledger()).toHaveLength(0);
        } finally { await c`drop trigger sln496_version_fault on ebooks`; }
      });

    it.each(["corrupt", "delete", "ebook"] as const)(
      "rolls back two real accession entries if the later receipt insert changes the earlier %s evidence", async (mode) => {
        const otherId = randomUUID(), hash = "b".repeat(64), ctx = context(driver);
        await c`insert into ebooks(id,title,language,import_source,updated_at)
          values(${otherId},'Other fixture book','en','folder','2020-01-01T00:00:00.123456Z')`;
        await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status)
          values(${randomUUID()},${otherId},${hash},'epub',1000,'application/epub+zip',${ebookFileKey(hash, "epub")},'stored')`;
        const ids = [ebookId, otherId];
        const envelope = await withReadOnlyPlanningConnection(url!, async (conn) => {
          const beforeReads = await Promise.all(ids.map((id) => readReviewBeforeOn(conn, id)));
          if (beforeReads.some((before) => !before)) throw new Error("Expected actual before rows");
          const choice = { authors: [{ name: "Review fixture author" }], language: "en", isbn13: null };
          const plan = await planAccessionOn(conn, ids, { runId: randomUUID(), targetDatabase: ctx.targetDatabase },
            new Map(ids.map((id) => [id, choice])));
          const effectHash = reviewPayloadHash(plan.entries.map((entry) => entry.effect));
          const requests = plan.entries.map((entry) => {
            const before = beforeReads.find((read) => read!.ebookId === entry.effect.ebookId)!;
            return { action: "accession" as const, ebookId: before.ebookId, ...choice,
              operation: identityOf(entry.receipt), effectHash,
              stamp: { updatedAt: before.snapshot.updatedAt, matchFingerprint: before.snapshot.matchFingerprint } };
          });
          const aligned = requests.map((request) => beforeReads.find((read) => read!.ebookId === request.ebookId)!);
          const seeds = requests.map((request, index) => ({
            version: 1 as const, operation: request.operation, requestHash: reviewRequestHash(request), effectHash,
            entityType: "ebook" as const, entityId: request.ebookId, eventKey: REVIEW_RECEIPT_EVENTS.ebookDecision,
            action: "accession" as const, originalOperation: null, before: aligned[index].snapshot,
            outcome: { message: "Accessioned fixture book.", keptCopy: false },
          }));
          return { plan, requests, seeds, beforeReads: aligned };
        }, { isolationLevel: "repeatable read" });
        const prepared = prepareReviewAtomicWrite({
          binding: { coreWriter: "accession", coreOperation: identityOf(envelope.plan), ebookIds: ids,
            reviewOperations: envelope.requests.map((request) => request.operation), purpose: "decision" },
          requests: envelope.requests, seeds: envelope.seeds, beforeReads: envelope.beforeReads,
          frozenEnvelopeHash: reviewPayloadHash(envelope),
        });
        const before = await c`select to_jsonb(e) as value from ebooks e order by id`, counts = await catalogueCounts();
        const fault = await c.reserve();
        try {
          await fault`create or replace function pg_temp.sln496_cross_receipt() returns trigger language plpgsql as $$
            declare earlier uuid; earlier_ebook uuid;
            begin
              if new.event_key = 'ebook.review.decision.v1' then
                select id, entity_id into earlier, earlier_ebook from activity_events
                  where event_key='ebook.review.decision.v1' and id<>new.id limit 1;
                if earlier is not null then
                  if TG_ARGV[0]='corrupt' then
                    update activity_events set metadata=jsonb_set(metadata,'{extra,ebookReview,outcome,message}','"corrupted earlier"'::jsonb) where id=earlier;
                  elsif TG_ARGV[0]='delete' then delete from activity_events where id=earlier;
                  else update ebooks set match_fingerprint=repeat('f',64) where id=earlier_ebook;
                  end if;
                end if;
              end if;
              return new;
            end $$`;
          await fault.unsafe("create trigger sln496_cross_fault after insert on activity_events for each row execute function pg_temp.sln496_cross_receipt('" + mode + "')");
        } finally { fault.release(); }
        try {
          await expect(accessionEbooks(ctx.writeDb, envelope.plan, ctx.targetDatabase,
            { atomicExtension: prepared.extension })).rejects.toThrow();
          expect(await c`select to_jsonb(e) as value from ebooks e order by id`).toEqual(before);
          expect(await catalogueCounts()).toEqual(counts);
          expect(await ledger()).toHaveLength(0);
        } finally { await c`drop trigger sln496_cross_fault on activity_events`; }
      });

    it.each(["keep", "exclude"] as const)("restores %s through actual classification compensation without repeating Undo", async (action) => {
      const ctx = context(driver), prepared = await prepareEbookReview({ action, ebookId,
        ...(action === "exclude" ? { reason: "other" } : {}) }, ctx);
      await applyEbookReview(prepared.request, prepared.previewToken, ctx);
      const original = await readReviewReceiptOn(database, prepared.request.operation.operationId);
      if (!original) throw new Error("Expected actual original decision");
      const request = { ebookId, originalOperation: original.receipt.operation };
      const result = await undoEbookReview(request, ctx);
      const stored = await readReviewReceiptOn(database, result.operation.operationId);
      expect(stored!.receipt.before).toEqual(original.receipt.after);
      expect(stored!.receipt.after.matchState).toBe("pending");
      expect(stored!.receipt.after.updatedAt > original.receipt.after.updatedAt).toBe(true);
      expect(stored!.receipt.after.exclusionReason).toBeNull();
      const after = await row();
      expect(await undoEbookReview(request, ctx)).toEqual(result);
      expect(await row()).toEqual(after);
      expect(await ledger()).toHaveLength(2);
    });

    it("commits concurrent confirmation once and replays after cache loss and target deletion", async () => {
      const ctx = context(driver), prepared = await prepareEbookReview({ action: "keep", ebookId }, ctx);
      const results = await Promise.all([
        applyEbookReview(prepared.request, prepared.previewToken, ctx),
        applyEbookReview(prepared.request, prepared.previewToken, ctx),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(await ledger()).toHaveLength(1);
      const stored = await readReviewReceiptOn(database, prepared.request.operation.operationId);
      expect(stored?.receipt.after.matchState).toBe("standalone");
      await c`delete from ebook_files where ebook_id=${ebookId}`;
      await c`delete from ebooks where id=${ebookId}`;
      expect(await applyEbookReview(prepared.request, "0".repeat(64), ctx)).toEqual(results[0]);
      expect(await ledger()).toHaveLength(1);
    });

    it("rolls back core copy/link/history and receipt when the stored receipt is corrupted before final assertion", async () => {
      const ctx = context(driver), prepared = await prepareLink(ctx), before = await row();
      const counts = async () => (await c`select (select count(*)::int from instances) as copies,
        (select count(*)::int from activity_events) as activity,
        (select count(*)::int from instance_status_history) as copy_history,
        (select count(*)::int from work_status_history) as work_history`)[0];
      const initialCounts = await counts();
      // Test-owned fault injection, never product DDL. Function lives for this
      // pool session; the trigger is removed even when the expected write fails.
      const fault = await c.reserve();
      try {
        await fault`create or replace function pg_temp.sln496_corrupt_review() returns trigger language plpgsql as $$
        begin
          if new.event_key = 'ebook.review.decision.v1' then
            new.metadata = jsonb_set(new.metadata, '{extra,ebookReview,after,updatedAt}', '"2000-01-01T00:00:00.000000Z"'::jsonb);
          end if;
          return new;
        end $$`;
        await fault`create trigger sln496_review_fault before insert on activity_events
        for each row execute function pg_temp.sln496_corrupt_review()`;
      } finally { fault.release(); }
      try {
        await expect(applyEbookReview(prepared.request, prepared.previewToken, ctx)).rejects.toMatchObject({ code: "invalid_receipt" });
        expect(await row()).toEqual(before);
        expect(await counts()).toEqual(initialCounts);
        expect(await ledger()).toHaveLength(0);
      } finally { await c`drop trigger sln496_review_fault on activity_events`; }
    });

    it("keeps a later-edited owned copy and commits concurrent Undo once with a strictly later DB version", async () => {
      const ctx = context(driver), prepared = await prepareLink(ctx);
      await applyEbookReview(prepared.request, prepared.previewToken, ctx);
      const original = await readReviewReceiptOn(database, prepared.request.operation.operationId);
      if (!original?.receipt.after.instanceId) throw new Error("Expected actual committed copy");
      const copyId = original.receipt.after.instanceId;
      await c`update instances set notes='Owner edited later',updated_at=clock_timestamp() where id=${copyId}`;
      const request = { ebookId, originalOperation: original.receipt.operation };
      const results = await Promise.all([undoEbookReview(request, ctx), undoEbookReview(request, ctx)]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0].keptCopy).toBe(true);
      expect((await c`select notes from instances where id=${copyId}`)[0].notes).toBe("Owner edited later");
      const compensation = await readReviewReceiptOn(database, reviewUndoOperationId(original.receipt.operation));
      expect(compensation?.receipt.after.matchState).toBe("pending");
      expect(compensation!.receipt.after.updatedAt > original.receipt.after.updatedAt).toBe(true);
      expect(compensation!.receipt.before).toEqual(original.receipt.after);
      expect(await ledger()).toHaveLength(2);
      const after = await row();
      expect(await undoEbookReview(request, ctx)).toEqual(results[0]);
      expect(await row()).toEqual(after);
      expect(await ledger()).toHaveLength(2);
    });

    it("rejects a one-microsecond stale version without writing a receipt or catalogue copy", async () => {
      const ctx = context(driver), prepared = await prepareLink(ctx);
      await c`update ebooks set updated_at=updated_at+interval '1 microsecond' where id=${ebookId}`;
      const changed = await row();
      await expect(applyEbookReview(prepared.request, prepared.previewToken, ctx)).rejects.toMatchObject({ code: "stale_review" });
      expect(await row()).toEqual(changed);
      expect(await c`select id from instances`).toHaveLength(0);
      expect(await ledger()).toHaveLength(0);
    });

    it("advances compensation beyond an actual stored version ahead of the database clock", async () => {
      // Only JS Date is changed. SQL clock_timestamp and network timers are real.
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2099-01-01T00:00:00Z"));
      const ctx = context(driver), prepared = await prepareLink(ctx);
      await applyEbookReview(prepared.request, prepared.previewToken, ctx);
      const original = await readReviewReceiptOn(database, prepared.request.operation.operationId);
      if (!original) throw new Error("Expected real receipt");
      expect(original.receipt.after.updatedAt.startsWith("2099-")).toBe(true);
      vi.useRealTimers();
      await undoEbookReview({ ebookId, originalOperation: original.receipt.operation }, ctx);
      const compensation = await readReviewReceiptOn(database, reviewUndoOperationId(original.receipt.operation));
      expect(compensation!.receipt.after.updatedAt > original.receipt.after.updatedAt).toBe(true);
      expect(compensation!.receipt.after.updatedAt.startsWith("2099-")).toBe(true);
    });
  });

  it("hashes complete real candidate row text with UTC6/numeric/Unicode evidence identically in SQL and JS", async () => {
    await c`insert into ebook_match_candidates(ebook_id,rank,work_id,edition_id,edition_rule,
      probability,weight_bits,margin_bits,reasons,model_version,created_at)
      values(${ebookId},1,${workId},${editionId},'isbn_edition',0.987654321,1.23456789,4.56789123,
        ${JSON.stringify([{ code: "fixture", text: "é 𝄞 quote\" line\n \u0001 separator\u2028" }])}::jsonb,1,'2026-10-10T12:30:45.123456+02:00')`;
    const before = await readReviewBeforeOn(database, ebookId);
    if (!before) throw new Error("Expected candidate snapshot");
    expect(before.snapshot.candidatesHash).toBe(reviewPayloadHash(before.candidateSnapshotTexts));
    expect(before.candidateSnapshotTexts[0]).toContain("2026-10-10T10:30:45.123456Z");
    await c`update ebook_match_candidates set weight_bits=weight_bits+0.00001 where ebook_id=${ebookId}`;
    const changed = await readReviewBeforeOn(database, ebookId);
    expect(changed!.snapshot.candidatesHash).not.toBe(before.snapshot.candidatesHash);
    expect(changed!.snapshot.candidatesHash).toBe(reviewPayloadHash(changed!.candidateSnapshotTexts));
  });
});
