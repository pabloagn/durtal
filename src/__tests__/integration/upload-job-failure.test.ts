import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get() { throw new Error("Global database forbidden"); } }), getDb() { throw new Error("Global database forbidden"); } }));
import { PostgresUploadStore, type UploadSqlExecutor } from "@/lib/ebooks/upload/store";
import { uploadReaderHashSql } from "@/lib/ebooks/upload-core/snapshots";
import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";

// The upload service crashed on live, in a loop, when it recorded a failed
// file check: PostgreSQL could not type the generation it put in the record
// ("could not determine data type of parameter $8")
const url = process.env.DURTAL_UPLOAD_JOB_FAILURE_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln1388_upload_job_failure");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln1388_upload_job_failure")
    throw new Error("Upload job failure tests require disposable local sln1388_upload_job_failure");
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const hex = (c: string) => c.repeat(64);
const volume = id(1), owner = id(2), operation = id(3), worker = id(4), run = id(8), item = id(9);

// The store's own SQL with its numbers and strings sent without types, as the
// Neon driver sends them, so PostgreSQL has to infer each one
const executor: UploadSqlExecutor = {
  async execute(query) {
    const compiled = new PgDialect().sqlToQuery(query);
    return [...(await client!.unsafe(compiled.sql, compiled.params as never[]))];
  },
};

describe.skipIf(!url)("an upload's failed check is recorded", () => {
  const c = client!;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln1388_upload_job_failure");
    await c`insert into ebook_upload_capacity(volume_id,binding_sha256,state,owner_token,owner_fence,owner_identity,
      owner_lease_expires_at,reserved_bytes,allocated_bytes,available_bytes,measured_at)
      values(${volume},${hex("b")},'ready',${owner},1,'{"fixture":true}'::jsonb,clock_timestamp()+interval '1 hour',
        83886080,0,34359738368,clock_timestamp())`;
    await c`insert into ebook_ingest_runs(id,kind,tool_version) values(${run},'upload',2)`;
    await c`insert into ebook_ingest_items(id,run_id,source_path,size_bytes,sha256,format,state)
      values(${item},${run},${`upload:${operation}`},200,${hex("d")},'epub','stored')`;
    await c`insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,
      protocol_version,volume_id,run_id,ingest_item_id,input,state,source_size_bytes,generation,lease_token,
      lease_expires_at,reserved_bytes)
      values(${operation},${id(5)},'upload',${hex("a")},${hex("c")},${hex("b")},1,${volume},${run},${item},'{}'::jsonb,
        'processing',200,3,${worker},clock_timestamp()+interval '1 hour',4096)`;
    await c`update ebook_upload_capacity set worker_state='running',worker_operation_id=${operation},
      worker_token=${worker},worker_lease_expires_at=clock_timestamp()+interval '1 hour' where volume_id=${volume}`;
  });
  afterAll(async () => { await c?.end(); });

  it("marks the file failed with its reason, and the generation as a number", async () => {
    const store = new PostgresUploadStore({ hostId: id(6), processId: 1, processStartedAt: id(7),
      hostLock: { port: 47000, acquire: async () => {}, assertHeld: () => {}, release: async () => {} }, executor });
    await store.recordJobFailure(
      { volumeId: volume, bindingSha256: hex("b"), ownerToken: owner, ownerFence: 1, leaseExpiresAt: Date.now() + 3_600_000 },
      { operationId: operation, ownerToken: owner, ownerFence: 1, generation: 3 },
      { reason: "not_an_ebook", what: "PNG image" });
    const [row] = await c<{ state: string; failure: unknown }[]>`
      select state, progress->'jobFailureV1' as failure from ebook_upload_operations where id=${operation}`;
    expect(row).toEqual({ state: "failed",
      failure: { generation: 3, code: "upload_job_failed", reason: "not_an_ebook", what: "PNG image" } });
  });
  it("fingerprints a book's reading rows before an upload adds it", async () => {
    const [row] = (await executor.execute(sql`select ${uploadReaderHashSql({ ebookIds: [id(10)], runId: run })} as hash`)) as { hash: string }[];
    expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
