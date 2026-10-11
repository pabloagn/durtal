import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/catalogue/work-store";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }) }));
import { prepareUploadAtomicExtension } from "@/lib/ebooks/upload/atomic-extension";
import { readUploadControlSnapshotsOn, readUploadTargetSnapshotOn, uploadTableSnapshotSql, UPLOAD_READER_TABLES } from "@/lib/ebooks/upload/atomic-snapshots";
import { registerGroup, registrationPlanSha256 } from "@/lib/ebooks/ingest/register";
import { reviewPayloadHash } from "@/lib/ebooks/review/receipts";
import { databaseFingerprint } from "@/lib/ebooks/ingest/command";
import { planMatchingOn } from "@/lib/ebooks/match/plan";
import { persistClassification } from "@/lib/ebooks/match/classification";
import { planDecisionOn, applyDecision } from "@/lib/ebooks/match/decisions";
import { planLinkOn, linkEbook } from "@/lib/ebooks/match/link";
import { planAccessionOn, accessionEbooks } from "@/lib/ebooks/match/accession";
import type { MatchOperationIdentity } from "@/lib/ebooks/match/types";
import { uploadAtomicScenario, id } from "../ebooks/upload/atomic-fixture";

// A separate root grant must supply a fresh local PG16 and the actual complete
// reviewed migration chain through upload/reader/quote dependencies. No fixture
// fabricates tables, snapshots, journals or a SQL-only migration bootstrap.
const url = process.env.DURTAL_EBOOK_UPLOAD_ATOMIC_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln495_ebook_upload_atomic")
    throw new Error("Upload atomic tests require fresh disposable local sln495_ebook_upload_atomic");
}
const client = url ? postgres(url, { prepare: false, max: 2, onnotice: () => {} }) : null;
describe.skipIf(!url)("canonical upload effects on actual PostgreSQL", () => {
  const c = client!, conn = (client ? drizzle(client, { schema }) : null) as unknown as Db;
  beforeAll(async () => {
    await migrate(drizzle(c, { schema }), { migrationsFolder: "src/lib/db/migrations" });
    const [required] = await c`select to_regclass('public.ebook_upload_operations') is not null
      and to_regclass('public.ebook_annotation_retired_ids') is not null
      and to_regclass('public.ebook_annotation_cursors') is not null
      and exists(select 1 from information_schema.columns where table_schema='public'
        and table_name='reading_notes' and column_name='ebook_annotation_id') as present`;
    expect(required.present, "Actual reviewed upload/annotation/quote migrations are required").toBe(true);
  });
  afterAll(async () => { await c.end(); });
  async function fixture(offset: number, sha256?: string, options: { newBook?: boolean; cursor?: boolean } = {}) {
    const s = uploadAtomicScenario(offset, sha256), b = s.binding, j = b.job.rawSnapshot;
    b.databaseFingerprint = databaseFingerprint(url!);
    s.operation.targetDatabase = b.databaseFingerprint;
    b.command.targetFingerprint = reviewPayloadHash({ namespace: "durtal.upload.target.v1", database: b.databaseFingerprint });
    b.command.rawSnapshot.target_fingerprint = b.command.targetFingerprint;
    j.target_fingerprint = b.command.targetFingerprint;
    (j.receipt as { request: { targetFingerprint: string } }).request.targetFingerprint = b.command.targetFingerprint;
    const batchId = id(offset + 30), batchKey = id(offset + 31);
    if (!options.newBook) await c`insert into ebooks(id,title,import_source,match_state) values(${s.r.ebookId},'Nadja','upload','pending')`;
    if (options.cursor) await c.begin(async (t) => {
      await t.unsafe("select public.durtal_annotation_lock_book($1::uuid)", [s.r.ebookId]);
    });
    await c`insert into ebook_ingest_runs(id,kind,tool_version) values(${s.operation.runId},'upload',2)`;
    await c`insert into ebook_ingest_items(id,run_id,source_path,size_bytes,sha256,format,state)
      values(${String(j.ingest_item_id)},${s.operation.runId},${s.r.items[0].path},200,${b.publication[0].sha256},'epub','stored')`;
    b.targetSnapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: b.ebookIds, runId: s.operation.runId });
    if (!options.newBook) { s.r.newEbook = null; s.r.items[0].outcome = "new_format"; }
    s.operation.planSha256 = registrationPlanSha256(s.r);
    const target = options.newBook ? { kind: "new" } : { kind: "add_format", ebookId: s.r.ebookId, beforeFingerprint: reviewPayloadHash({ version: 1,
      ebooks: b.targetSnapshot.ebooks, ebook_files: b.targetSnapshot.ebook_files }) };
    const progress = { uploadCoreV1: { previewTokenSha256: b.previewTokenSha256, expiresAt: b.expiresAt,
      coreOperation: s.operation, publication: b.publication } };
    j.input = { ...(j.input as Record<string, unknown>), target };
    await c`insert into ebook_upload_capacity(volume_id,binding_sha256,state,owner_token,owner_fence,owner_identity,
      owner_lease_expires_at,reserved_bytes,allocated_bytes,available_bytes,measured_at)
      values(${b.command.volumeId},${b.command.bindingSha256},'ready',${b.owner.token},1,'{"fixture":true}'::jsonb,
        clock_timestamp()+interval '1 hour',637665280,0,34359738368,clock_timestamp())`;
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,volume_id,run_id,input,state)
      values(${batchId},${batchKey},'batch',${"a".repeat(64)},${b.command.targetFingerprint},${b.command.bindingSha256},
        1,${b.command.volumeId},${s.operation.runId},'{}'::jsonb,'completed')`;
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,parent_operation_id,volume_id,run_id,ingest_item_id,input,progress,state,source_size_bytes,
      reserved_bytes,generation,receipt,receipt_status,effect_committed_at,cleanup_verified_at)
      values(${b.job.id},${String(j.idempotency_key)},'upload',${String(j.request_sha256)},${b.command.targetFingerprint},${b.command.bindingSha256},
        1,${batchId},${b.command.volumeId},${s.operation.runId},${String(j.ingest_item_id)},${JSON.stringify(j.input)}::jsonb,
        ${JSON.stringify(j.progress)}::jsonb,'ready',200,553779200,2,${JSON.stringify(j.receipt)}::jsonb,200,clock_timestamp(),clock_timestamp())`;
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,parent_operation_id,volume_id,run_id,input,progress,state)
      values(${b.command.id},${b.command.key},'complete',${b.command.requestSha256},${b.command.targetFingerprint},${b.command.bindingSha256},
        1,${b.job.id},${b.command.volumeId},${s.operation.runId},'{"action":"confirm"}'::jsonb,${JSON.stringify(progress)}::jsonb,'queued')`;
    const control = await readUploadControlSnapshotsOn(conn, b.command.id, b.job.id);
    b.command.rawSnapshot = control.command; b.job.rawSnapshot = control.job; b.owner.capacitySnapshot = control.capacity;
    return s;
  }
  function issuer(s: Awaited<ReturnType<typeof fixture>>, corruptReceipt = false) {
    const b = s.binding, scope = { ebookIds: b.ebookIds, runId: s.operation.runId };
    return prepareUploadAtomicExtension(b, { before: () => [], after: (d) => [
      d.execute(sql`update ebook_upload_operations set receipt=${JSON.stringify(b.receipt)}::jsonb,receipt_status=200,
        effect_committed_at=clock_timestamp(),state='completed' where id=${b.command.id}::uuid and receipt is null`),
      d.execute(sql`insert into activity_events(id,entity_type,entity_id,event_key,metadata) values(${b.activityId}::uuid,'ebook',
        ${s.r.ebookId}::uuid,'ebook.upload.effect.v1',jsonb_build_object('extra',jsonb_build_object('ebookUpload',
          jsonb_build_object('operationId',${b.command.id}::text,'coreWriter',${corruptReceipt ? "wrong-writer" : b.coreWriter}::text,
            'coreOperation',${JSON.stringify(s.operation)}::jsonb,'catalogueBefore',${JSON.stringify({ ebooks: b.targetSnapshot.ebooks,
              ebook_files: b.targetSnapshot.ebook_files })}::jsonb,'catalogueAfter',jsonb_build_object(
                'ebooks',${uploadTableSnapshotSql("ebooks", scope)},'ebook_files',${uploadTableSnapshotSql("ebook_files", scope)})))))`),
      // Independent DB read at the atomic commit point, before accession's
      // documented enrichment follow-up can extend its Undo ownership receipt.
      d.execute(sql`select ${"durtal.upload.fixture.commit.v1"}::text marker,
        updated_at > ${beforeAt}::timestamptz forward,
        to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') version,link_written,
        ${uploadTableSnapshotSql("ebooks", scope)} ebooks from ebooks where id=${s.r.ebookId}::uuid`),
    ] });
  }
  async function unchanged(s: Awaited<ReturnType<typeof fixture>>) {
    const [file] = await c`select count(*)::int as count from ebook_files where id=${s.r.inserts[0].id!}`;
    const [command] = await c`select receipt,receipt_status,effect_committed_at from ebook_upload_operations where id=${s.binding.command.id}`;
    const [item] = await c`select state from ebook_ingest_items where id=${String(s.binding.job.rawSnapshot.ingest_item_id)}`;
    const [activity] = await c`select count(*)::int as count from activity_events where id=${s.binding.activityId}`;
    expect(file.count).toBe(0); expect(command).toEqual({ receipt: null, receipt_status: null, effect_committed_at: null });
    expect(item.state).toBe("stored"); expect(activity.count).toBe(0);
  }
  it("rolls real registered rows, item state, operation receipt and activity back on the final suffix failure", async () => {
    const s = await fixture(100), extension = issuer(s, true);
    await expect(registerGroup(conn, s.r, s.operation.runId, { uploadExtension: extension, operation: s.operation })).rejects.toThrow();
    await unchanged(s);
    const after = await readUploadTargetSnapshotOn(conn, { ebookIds: s.binding.ebookIds, runId: s.operation.runId });
    expect(after).toEqual(s.binding.targetSnapshot);
  });
  it.each(["retired", "cursor"] as const)("refuses a concurrent %s annotation change before any registration", async (kind) => {
    const s = await fixture(kind === "retired" ? 200 : 300), extension = issuer(s);
    if (kind === "retired") await c`insert into ebook_annotation_retired_ids(id,ebook_id,retired_at)
      values(${id(290)},${s.r.ebookId},clock_timestamp())`;
    else await c`insert into ebook_annotation_cursors(ebook_id,server_time) values(${s.r.ebookId},clock_timestamp())`;
    await expect(registerGroup(conn, s.r, s.operation.runId, { uploadExtension: extension, operation: s.operation })).rejects.toThrow();
    await unchanged(s);
  });
  it("commits a settled ready source plus actual final receipt while retained source reservation stays charged", async () => {
    const s = await fixture(400), extension = issuer(s);
    const results = await registerGroup(conn, s.r, s.operation.runId, { uploadExtension: extension, operation: s.operation });
    expect(results.length).toBeGreaterThan(1);
    const [job] = await c`select state,reserved_bytes::int,reservation_released_at from ebook_upload_operations where id=${s.binding.job.id}`;
    expect(job).toEqual({ state: "ready", reserved_bytes: 553779200, reservation_released_at: null });
    const [stored] = await c`select receipt,receipt_status from ebook_upload_operations where id=${s.binding.command.id}`;
    expect(stored.receipt).toEqual(s.binding.receipt); expect(stored.receipt_status).toBe(200);
  });
  it.each([
    { name: "fresh e-book without a cursor", offset: 4000, newBook: true, cursor: false },
    { name: "existing e-book with a cursor", offset: 4100, newBook: false, cursor: true },
  ])("preserves the exact reader snapshot when registering a $name", async ({ offset, newBook, cursor }) => {
    const s = await fixture(offset, offset.toString(16).padStart(64, "0"), { newBook, cursor });
    const before = s.binding.targetSnapshot;
    expect(before.ebooks).toHaveLength(newBook ? 0 : 1);
    expect(before.ebook_annotation_cursors).toHaveLength(cursor ? 1 : 0);
    const results = await registerGroup(conn, s.r, s.operation.runId, { uploadExtension: issuer(s), operation: s.operation });
    expect(results.length).toBeGreaterThan(1);
    const after = await readUploadTargetSnapshotOn(conn, { ebookIds: s.binding.ebookIds, runId: s.operation.runId });
    expect(after.ebooks).toHaveLength(1);
    expect(after.ebooks[0].match_state).toBe("pending");
    expect(after.ebooks[0].instance_id).toBeNull();
    expect(after.ebook_files.map((file) => file.id)).toEqual([s.r.inserts[0].id]);
    for (const table of UPLOAD_READER_TABLES) expect(after[table]).toEqual(before[table]);
    const [stored] = await c`select receipt,receipt_status from ebook_upload_operations where id=${s.binding.command.id}`;
    expect(stored.receipt).toEqual(s.binding.receipt); expect(stored.receipt_status).toBe(200);
  });
  const writers = ["classification", "decision", "link", "accession"] as const;
  const times = ["same_millisecond", "older_plan"] as const;
  const beforeAt = "2030-01-01T12:00:00.123456Z";
  type CommitState = {
    marker: string; forward: boolean; version: string; ebooks: unknown[];
    link_written: { after: { ebook: { updated_at: string }; instance: unknown;
      ownedChildren: Record<string, unknown> } };
  };
  const accessionAuthors = new Map([[1600, "Henry James"], [1700, "Franz Kafka"], [3300, "Ursula Le Guin"]]);
  async function matchingFixture(offset: number, writer: typeof writers[number], planTime: typeof times[number]) {
    const s = await fixture(offset, offset.toString(16).padStart(64, "0")), b = s.binding, file = b.publication[0];
    const locationId = id(offset + 40), workId = id(offset + 41), editionId = id(offset + 42), copyId = id(offset + 43);
    await c`insert into locations(id,name,type,is_active) values(${locationId},'Upload version test','digital',true)`;
    await c`insert into app_settings(id,ebook_location_id) values(true,${locationId})
      on conflict(id) do update set ebook_location_id=excluded.ebook_location_id`;
    await c`insert into works(id,title,kind,original_language) values(${workId},'Nadja','book','en')`;
    await c`insert into editions(id,work_id,title,language) values(${editionId},${workId},'Nadja','en')`;
    await c`insert into instances(id,edition_id,location_id,updated_at)
      values(${copyId},${editionId},${locationId},${beforeAt}::timestamptz)`;
    await c`insert into ebook_files(id,ebook_id,sha256,format,size_bytes,content_type,s3_key,status,metadata,manifest_key)
      values(${file.id},${file.ebookId},${file.sha256},${file.format},${file.sizeBytes},'application/epub+zip',${file.s3Key},'stored',
        ${JSON.stringify(file.metadata)}::jsonb,${file.manifestKey})`;
    // Numeric suffixes differing by one character deliberately match as
    // compatible people; each accession case needs a distinct author identity.
    const author = writer === "accession" ? accessionAuthors.get(offset) : "Version author " + offset;
    if (!author) throw new Error("Missing accession fixture author");
    await c`update ebooks set language='en',authors=${[author]},
      title=${writer === "accession" ? "Fresh upload book " + offset : "Nadja"},
      preferred_file_id=${file.id},updated_at=${beforeAt}::timestamptz where id=${s.r.ebookId}`;
    // Binding-changing writers acquire this real protocol lock too. Establish
    // its cursor before planning so the upload's exact reader snapshot stays
    // unchanged throughout the version test.
    await c.begin(async (t) => {
      await t.unsafe("select public.durtal_annotation_lock_book($1::uuid)", [s.r.ebookId]);
    });
    const identity = { runId: s.operation.runId, targetDatabase: b.databaseFingerprint,
      now: planTime === "same_millisecond" ? "2030-01-01T12:00:00.123Z" : "2025-01-01T12:00:00.001Z" };
    const plan = writer === "classification" ? await planMatchingOn(conn, [s.r.ebookId],
      { ...identity, mode: "classification_only", rematch: true }) : writer === "decision"
      ? await planDecisionOn(conn, [s.r.ebookId], { action: "keep" }, identity) : writer === "link"
      ? await planLinkOn(conn, { ebookId: s.r.ebookId, workId, editionId, instanceId: copyId, method: "manual" }, identity)
      : await planAccessionOn(conn, [s.r.ebookId], identity);
    const operation: MatchOperationIdentity = { version: plan.version, operationId: plan.operationId,
      runId: plan.runId, planSha256: plan.planSha256, targetDatabase: plan.targetDatabase };
    Object.assign(s.operation, operation);b.coreOperation = operation;b.coreWriter = writer;
    b.targetSnapshot = await readUploadTargetSnapshotOn(conn, { ebookIds: b.ebookIds, runId: operation.runId });
    await c`update ebook_upload_operations set progress=${JSON.stringify({ uploadCoreV1: {
      previewTokenSha256: b.previewTokenSha256, expiresAt: b.expiresAt, coreOperation: operation, publication: b.publication,
    } })}::jsonb where id=${b.command.id}`;
    const control = await readUploadControlSnapshotsOn(conn, b.command.id, b.job.id);
    b.command.rawSnapshot = control.command;b.job.rawSnapshot = control.job;b.owner.capacitySnapshot = control.capacity;
    return { s, plan, copyId };
  }
  async function applyMatching(f: Awaited<ReturnType<typeof matchingFixture>>, corrupt = false) {
    const extension = issuer(f.s, corrupt), target = f.plan.targetDatabase;
    switch (f.plan.kind) {
      case "classification": return persistClassification(conn, f.plan, target, { atomicExtension: extension });
      case "decision": return applyDecision(conn, f.plan, target, { atomicExtension: extension });
      case "link": return linkEbook(conn, f.plan, target, { atomicExtension: extension });
      case "accession_batch": return accessionEbooks(conn, f.plan, target, { atomicExtension: extension });
    }
  }
  it.each(writers.flatMap((writer, index) => times.map((time, i) => ({ writer, time, offset: 1000 + index * 200 + i * 100 }))))(
    "keeps final $writer UTC6 version strictly newer with $time", async ({ writer, time, offset }) => {
      const f = await matchingFixture(offset, writer, time);
      const applied = await applyMatching(f);
      if (!applied) throw new Error("Matching writer returned no atomic results");
      const results = Array.isArray(applied) ? applied : applied.result;
      const captured = results.flatMap((result) => resultRows<CommitState>(result))
        .filter((row) => row.marker === "durtal.upload.fixture.commit.v1");
      expect(captured).toHaveLength(1);
      const [actual] = captured;
      const [current] = await c`select updated_at > ${beforeAt}::timestamptz forward,
        to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') version,link_written
        from ebooks where id=${f.s.r.ebookId}`;
      expect(actual.forward).toBe(true);expect(actual.version > beforeAt).toBe(true);
      const [audit] = await c`select metadata #> '{extra,ebookUpload,catalogueAfter,ebooks}' rows
        from activity_events where id=${f.s.binding.activityId}`;
      expect(audit.rows[0].updated_at).toBe(actual.version);
      expect(audit.rows).toEqual(actual.ebooks);
      const { marker: _marker, ebooks: _ebooks, ...committed } = actual;
      if (f.plan.kind === "accession_batch") {
        if (Array.isArray(applied)) throw new Error("Accession returned no follow-up outcome");
        expect(applied.followUpFailures).toEqual([]);
        const entry = f.plan.entries[0];
        const [jobs] = await c`select coalesce(jsonb_agg(to_jsonb(j) order by j.kind),'[]'::jsonb) rows
          from enrichment_jobs j where j.work_id=${entry.workId}::uuid`;
        expect(jobs.rows.map((job: { kind: string }) => job.kind)).toEqual(["identity", "research"]);
        for (const job of jobs.rows) expect(job).toMatchObject({ work_id: entry.workId,
          status: "queued", attempts: 0, priority: 200, payload: { matchingOperationId: entry.receipt.operationId } });
        // The complete final row may differ only by these exact queued-job
        // snapshots. Both the immutable audit and Undo ownership stay checked.
        expect(current).toEqual({ ...committed, link_written: { ...actual.link_written,
          after: { ...actual.link_written.after, ownedChildren: {
            ...actual.link_written.after.ownedChildren, enrichment_jobs: jobs.rows } } } });
      } else expect(current).toEqual(committed);
      if (writer === "link" || writer === "accession") {
        expect(actual.link_written.after.ebook.updated_at).toBeTruthy();
        expect(audit.rows[0].link_written).toEqual(actual.link_written);
      }
      if (writer === "link") {
        const [copy] = await c`select updated_at > ${beforeAt}::timestamptz forward,to_jsonb(i) row
          from instances i where id=${f.copyId}`;
        expect(copy.forward).toBe(true);expect(actual.link_written.after.instance).toEqual(copy.row);
      }
    });
  it.each(writers)("rolls back $writer versions and actual receipts on final audit rejection", async (writer) => {
    const offset = 3000 + writers.indexOf(writer) * 100, f = await matchingFixture(offset, writer, "older_plan");
    const scope = { ebookIds: f.s.binding.ebookIds, runId: f.s.operation.runId };
    const before = await readUploadTargetSnapshotOn(conn, scope);
    const [copyBefore] = await c`select to_jsonb(i) row from instances i where id=${f.copyId}`;
    await expect(applyMatching(f, true)).rejects.toThrow();
    expect(await readUploadTargetSnapshotOn(conn, scope)).toEqual(before);
    expect((await c`select to_jsonb(i) row from instances i where id=${f.copyId}`)[0].row).toEqual(copyBefore.row);
    expect((await c`select receipt,receipt_status,effect_committed_at from ebook_upload_operations where id=${f.s.binding.command.id}`)[0])
      .toEqual({ receipt: null, receipt_status: null, effect_committed_at: null });
    expect(await c`select id from activity_events where id=${f.s.binding.activityId}`).toHaveLength(0);
    if (f.plan.kind === "accession_batch") {
      expect(await c`select id from works where id=${f.plan.entries[0].workId}`).toHaveLength(0);
      expect(await c`select id from editions where id=${f.plan.entries[0].editionId}`).toHaveLength(0);
      expect(await c`select id from instances where id=${f.plan.entries[0].instanceId}`).toHaveLength(0);
      expect(await c`select id from enrichment_jobs where work_id=${f.plan.entries[0].workId}`).toHaveLength(0);
    }
  });

});
