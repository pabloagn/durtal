import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/lib/db/schema";
import { settleUploadRunSql } from "@/lib/ebooks/upload-core/run-settle";
import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";

// SLN-1395: every browser-upload run stayed "running" for good, and its run
// page refreshed every 10 seconds for as long as it was open
const url = process.env.DURTAL_UPLOAD_RUN_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln1395_upload_run");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln1395_upload_run")
    throw new Error("Upload run tests require disposable local sln1395_upload_run");
}
const client = url ? postgres(url, { prepare: false, max: 2, onnotice: () => {} }) : null;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hex = (c: string) => c.repeat(64);
const volume = id(1);

describe.skipIf(!url)("an upload's run settles with its last file", () => {
  const c = client!, conn = client ? drizzle(client, { schema }) : null;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln1395_upload_run");
    await c`insert into ebook_upload_capacity(volume_id,binding_sha256,state,owner_token,owner_fence,owner_identity,
      owner_lease_expires_at,reserved_bytes,allocated_bytes,available_bytes,measured_at)
      values(${volume},${hex("b")},'ready',${id(2)},1,'{"fixture":true}'::jsonb,
        clock_timestamp()+interval '1 hour',83886080,0,34359738368,clock_timestamp())`;
  });
  afterAll(async () => { await c?.end(); });

  /** A run and its batch of files, each "ready": received and checked, not yet added */
  async function batch(base: number, files: number) {
    const run = id(base);
    await c`insert into ebook_ingest_runs(id,kind,tool_version) values(${run},'upload',2)`;
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,volume_id,run_id,input,state)
      values(${id(base + 1)},${id(base + 2)},'batch',${hex("a")},${hex("c")},${hex("b")},1,${volume},${run},'{}'::jsonb,'completed')`;
    const uploads: string[] = [];
    for (let n = 0; n < files; n++) {
      const upload = id(base + 10 + n), item = id(base + 20 + n);
      await c`insert into ebook_ingest_items(id,run_id,source_path,size_bytes,sha256,format,state)
        values(${item},${run},${`upload:${upload}`},200,${hex(String(n))},'epub','stored')`;
      await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
        protocol_version,parent_operation_id,volume_id,run_id,ingest_item_id,input,state,source_size_bytes,generation)
        values(${upload},${id(base + 30 + n)},'upload',${hex("a")},${hex("c")},${hex("b")},1,${id(base + 1)},${volume},${run},
          ${item},'{}'::jsonb,'ready',200,1)`;
      uploads.push(upload);
    }
    return { run, uploads };
  }
  /** A committed confirmation: the file is added */
  async function add(run: string, upload: string, n: number) {
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,parent_operation_id,volume_id,run_id,input,state,receipt,receipt_status,effect_committed_at)
      values(${id(n)},${id(n + 1)},'complete',${hex("a")},${hex("c")},${hex("b")},1,${upload},${volume},${run},
        '{"action":"confirm"}'::jsonb,'completed','{"status":200}'::jsonb,200,clock_timestamp())`;
  }
  const settle = async (run: string) => { await conn!.execute(settleUploadRunSql(run)); };
  const runOf = async (run: string) => (await c<{ state: string; finished: boolean }[]>`
    select state, finished_at is not null as finished from ebook_ingest_runs where id=${run}`)[0];

  it("stays running while a file is open, then finishes once every file is added, canceled or expired", async () => {
    const { run, uploads: [added, canceled, expired] } = await batch(1000, 3);
    await settle(run);
    expect(await runOf(run)).toEqual({ state: "running", finished: false });
    await c`update ebook_upload_operations set state='canceled' where id=${canceled}`; await settle(run);
    await add(run, added, 1100); await settle(run);
    // One file is still open: its registration still finds the run running
    expect(await runOf(run)).toEqual({ state: "running", finished: false });
    await c`update ebook_upload_operations set state='expired' where id=${expired}`; await settle(run);
    expect(await runOf(run)).toEqual({ state: "finished", finished: true });
  });

  it("counts a confirmation only once it is committed", async () => {
    const { run, uploads: [upload] } = await batch(2000, 1);
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,parent_operation_id,volume_id,run_id,input,state)
      values(${id(2100)},${id(2101)},'complete',${hex("a")},${hex("c")},${hex("b")},1,${upload},${volume},${run},
        '{"action":"confirm"}'::jsonb,'queued')`;
    await settle(run);
    expect(await runOf(run)).toEqual({ state: "running", finished: false });
    await add(run, upload, 2200); await settle(run);
    expect(await runOf(run)).toEqual({ state: "finished", finished: true });
  });

  it("is failed when a file was given up on after its check failed", async () => {
    const { run, uploads: [added, refused] } = await batch(3000, 2);
    await add(run, added, 3100);
    await c`update ebook_upload_operations set state='canceled',
      progress=jsonb_build_object('jobFailureV1',jsonb_build_object('generation',1,'code','upload_job_failed')) where id=${refused}`;
    await settle(run);
    expect(await runOf(run)).toEqual({ state: "failed", finished: true });
  });

  it("counts only the current check's failure, so a retry that passed and was canceled is finished", async () => {
    // Each claim of the check is a new generation (claimNext); a failure records the generation it failed in
    const check = (upload: string) => c`update ebook_upload_operations set state='processing', generation=generation+1 where id=${upload}`;
    const fail = (upload: string) => c`update ebook_upload_operations set state='failed',
      progress=jsonb_build_object('jobFailureV1',jsonb_build_object('generation',generation,'code','upload_job_failed')) where id=${upload}`;
    const pass = (upload: string) => c`update ebook_upload_operations set state='ready' where id=${upload}`;
    const cancel = (upload: string) => c`update ebook_upload_operations set state='canceled' where id=${upload}`;

    const retried = await batch(3500, 1), [passed] = retried.uploads;
    await check(passed); await fail(passed); await check(passed); await pass(passed); await cancel(passed);
    await settle(retried.run);
    expect(await runOf(retried.run)).toEqual({ state: "finished", finished: true });

    const twice = await batch(3600, 1), [refused] = twice.uploads;
    await check(refused); await fail(refused); await check(refused); await fail(refused); await cancel(refused);
    await settle(twice.run);
    expect(await runOf(twice.run)).toEqual({ state: "failed", finished: true });
  });

  it("leaves a settled run, a run with no files and another kind of run as they are", async () => {
    const { run, uploads: [upload] } = await batch(4000, 1);
    await add(run, upload, 4100); await settle(run);
    const [first] = await c`select finished_at from ebook_ingest_runs where id=${run}`;
    await settle(run);
    const [again] = await c`select state, finished_at from ebook_ingest_runs where id=${run}`;
    expect(again).toEqual({ state: "finished", finished_at: first.finished_at });
    const empty = id(4500), apply = id(4600);
    await c`insert into ebook_ingest_runs(id,kind,tool_version) values(${empty},'upload',2),(${apply},'apply',2)`;
    await settle(empty); await settle(apply);
    expect(await runOf(empty)).toEqual({ state: "running", finished: false });
    expect(await runOf(apply)).toEqual({ state: "running", finished: false });
  });
});
