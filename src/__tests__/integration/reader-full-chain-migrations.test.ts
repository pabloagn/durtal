import { createHash, randomUUID } from "node:crypto";
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readPinnedReaderChain, type Journal } from "../helpers/reader-migration-chain";

// Root supplies a fresh local database and accepted complete source. Never dotenv/live.
const url = process.env.DURTAL_READER_MIGRATIONS_TEST_DATABASE_URL;
if (!url && process.env.DURTAL_REQUIRE_READER_MIGRATIONS === "1")
  throw new Error("Required reader migration database was not supplied");
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln497_reader_migrations")
    throw new Error("Migration tests require fresh disposable local sln497_reader_migrations");
  if ([...parsed.searchParams.keys()].some((key) => ["host", "hostaddr", "dbname", "service"].includes(key.toLowerCase())))
    throw new Error("Database URL must not override its guarded host/database");
}
const sourceFolder = resolve("src/lib/db/migrations");
let folder = sourceFolder;
const fixtureRoot = new URL("./fixtures/reader-full-chain/", import.meta.url);
type Queries = Pick<postgres.Sql, "unsafe">;
type Params = postgres.ParameterOrJSON<never>[];
const q = (on: Queries, text: string, params: Params = []) => on.unsafe(text, params);
async function value<T = string>(on: Queries, text: string, params: Params = []): Promise<T> {
  const rows = await q(on, text, params);
  if (!rows[0]) throw new Error("Expected a database result row");
  return Object.values(rows[0])[0] as T;
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
async function refusal(operation: PromiseLike<unknown>) {
  try { await operation; return null; }
  catch (error) {
    // DrizzleQueryError retains the actual PostgresError in cause.
    const seen = new Set<object>();
    let current: unknown = error;
    for (let depth = 0; depth < 32 && current !== null && typeof current === "object" && !seen.has(current); depth++) {
      seen.add(current);
      const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
      if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code))
        return { code: e.code, constraint: typeof e.constraint_name === "string" ? e.constraint_name : undefined };
      current = e.cause;
    }
    // Unrecognized failures still fail the exact SQLSTATE/constraint assertions.
    return { code: undefined, constraint: undefined };
  }
}
const makeClient = () => postgres(url!, {
  max: 3, connect_timeout: 5, idle_timeout: 0, max_lifetime: 0, onnotice: () => {},
  connection: { application_name: "sln497-reader-migrations", timezone: "UTC",
    default_transaction_isolation: "read committed", statement_timeout: 15000, lock_timeout: 6000 },
});
const c = url ? makeClient() : null;
const temporaryFolders: string[] = [];
let ownsDatabase = false;
let journal: Journal = { entries: [] };
let baseline81 = "";
let baseline82 = "";

async function assertSourcePins() {
  const chain = await readPinnedReaderChain(sourceFolder, fixtureRoot);
  journal = chain.journal;
  return chain;
}
async function prefixFolder(slot: 81 | 82) {
  const dest = await mkdtemp(join(tmpdir(), "sln497-reader-prefix-"));
  temporaryFolders.push(dest);
  await mkdir(join(dest, "meta"));
  // These are byte copies of the actual genuine historical journals, not slices/fabrications.
  const bytes = await readFile(new URL(`${slot.toString().padStart(4, "0")}-journal.json`, fixtureRoot));
  const actual = JSON.parse(bytes.toString()) as Journal;
  expect(actual.entries).toEqual(journal.entries.slice(0, slot + 1));
  await writeFile(join(dest, "meta/_journal.json"), bytes);
  for (const entry of actual.entries)
    await copyFile(join(folder, `${entry.tag}.sql`), join(dest, `${entry.tag}.sql`));
  return dest;
}
async function variantFolder(slot: 83 | 88, change: (sql: string) => string) {
  const dest = await mkdtemp(join(tmpdir(), "sln497-reader-fault-"));
  temporaryFolders.push(dest);
  await cp(folder, dest, { recursive: true });
  const tag = journal.entries[slot].tag;
  await writeFile(join(dest, `${tag}.sql`), change(await readFile(join(dest, `${tag}.sql`), "utf8")));
  // Only a disclosed supplemental SQL statement differs; metadata is always genuine.
  expect(await readFile(join(dest, "meta/_journal.json"))).toEqual(await readFile(join(folder, "meta/_journal.json")));
  for (let n = 82; n <= 88; n++)
    expect(await readFile(join(dest, `meta/${n.toString().padStart(4, "0")}_snapshot.json`)))
      .toEqual(await readFile(join(folder, `meta/${n.toString().padStart(4, "0")}_snapshot.json`)));
  return dest;
}
async function apply(migrationsFolder = folder, client = c!) {
  await migrate(drizzle(client), { migrationsFolder });
}
async function resetDatabase() {
  if (!ownsDatabase) throw new Error("Cannot recreate an unowned database");
  await q(c!, "drop schema if exists drizzle cascade");
  await q(c!, "drop schema public cascade");
  await q(c!, "create schema public");
}
async function journalMatches(slot = 88, migrationsFolder = folder) {
  const files = readMigrationFiles({ migrationsFolder }).slice(0, slot + 1);
  const rows = await q(c!, "select hash, created_at::text as stamp from drizzle.__drizzle_migrations order by created_at,id");
  expect(rows.map((row) => ({ hash: row.hash, stamp: row.stamp })))
    .toEqual(files.map((m) => ({ hash: m.hash, stamp: String(m.folderMillis) })));
}
async function tableRows(table: string, omit: string[] = []) {
  const projection = omit.length ? `to_jsonb(t)-ARRAY[${omit.map(literal).join(",")}]::text[]` : "to_jsonb(t)";
  return value<string>(c!, `select coalesce(jsonb_agg(${projection} order by (${projection})::text),'[]'::jsonb)::text from public.${quoted(table)} t`);
}
async function fingerprint() {
  const tables = await q(c!, "select tablename from pg_tables where schemaname='public' order by tablename");
  const data: Record<string, string> = {};
  for (const table of tables) data[String(table.tablename)] = hash(Buffer.from(await tableRows(String(table.tablename))));
  // Ignore physical statistics and nontransactional sequence counters, not application rows.
  const schema = await value<string>(c!, `select jsonb_build_object(
    'columns',(select jsonb_agg(jsonb_build_array(table_name,column_name,data_type,is_nullable,column_default) order by table_name,ordinal_position) from information_schema.columns where table_schema='public'),
    'constraints',(select jsonb_agg(jsonb_build_array(cl.relname,co.conname,co.contype,co.condeferrable,co.condeferred,pg_get_constraintdef(co.oid)) order by cl.relname,co.conname) from pg_constraint co join pg_class cl on cl.oid=co.conrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public'),
    'indexes',(select jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) order by tablename,indexname) from pg_indexes where schemaname='public'),
    'functions',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.prokind='f'),
    'triggers',(select jsonb_agg(jsonb_build_array(cl.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid)) order by cl.relname,t.tgname) from pg_trigger t join pg_class cl on cl.oid=t.tgrelid join pg_namespace ns on ns.oid=cl.relnamespace where ns.nspname='public' and not t.tgisinternal)
  )::text`);
  const migrations = await value<string>(c!, "select coalesce(jsonb_agg(to_jsonb(t) order by created_at,id),'[]'::jsonb)::text from drizzle.__drizzle_migrations t");
  return { data, schema: hash(Buffer.from(schema)), migrations: hash(Buffer.from(migrations)) };
}
async function assertInstalledSchema(migrationsFolder = folder, slot = 88) {
  const snapshot = JSON.parse(await readFile(join(migrationsFolder, `meta/${slot.toString().padStart(4, "0")}_snapshot.json`), "utf8")) as {
    tables: Record<string, { name: string; schema: string; columns: Record<string, { name: string }>; checkConstraints: Record<string, { name: string }>; foreignKeys: Record<string, { name: string }>; indexes: Record<string, { name: string }> }>;
  };
  const identifierLimit = await value<number>(c!, "select current_setting('max_identifier_length')::int");
  // All pinned snapshot identifiers are ASCII. PostgreSQL stores long constraint/index
  // names at its identifier limit; do not demand an impossible untruncated catalogue name.
  const storedIdentifier = (name: string) => {
    expect(name).toMatch(/^[\x20-\x7e]+$/);
    return name.slice(0, identifierLimit);
  };
  for (const t of Object.values(snapshot.tables)) {
    const columns = await q(c!, "select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by column_name", [t.name]);
    expect(columns.map((x) => x.column_name).sort(), t.name).toEqual(Object.values(t.columns).map((x) => x.name).sort());
    const constraints = await q(c!, "select conname from pg_constraint where conrelid=to_regclass($1)", [`public.${t.name}`]);
    for (const constraint of [...Object.values(t.checkConstraints), ...Object.values(t.foreignKeys)])
      expect(constraints.map((x) => x.conname), constraint.name).toContain(storedIdentifier(constraint.name));
    const indexes = await q(c!, "select indexname from pg_indexes where schemaname='public' and tablename=$1", [t.name]);
    for (const index of Object.values(t.indexes)) expect(indexes.map((x) => x.indexname), index.name).toContain(storedIdentifier(index.name));
  }
  const required = ["durtal_annotation_locator_valid", "durtal_annotation_lock_book", "durtal_annotation_lock_id", "durtal_annotation_tick", "durtal_annotation_lifecycle_guard", "ebook_title_sort", "ebook_title_sort_set", "guard_reader_sitting_receipt", "guard_reading_note", "check_reader_quote_binding", "durtal_reader_stamp_note_version", "durtal_reader_rotate_note_quote_epoch", "durtal_annotation_finalize_delete", "durtal_tracker_delete_live_reader_quote", "durtal_reader_delete_quote_with_undo", "durtal_reader_restore_quote", "ebook_upload_operation_immutable", "ebook_upload_capacity_immutable", "ebook_upload_history_no_removal"];
  const installed = await q(c!, "select proname from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'");
  for (const name of required) expect(installed.map((x) => x.proname), name).toContain(name);
  const always = await q(c!, "select tgname,tgenabled from pg_trigger where tgname in ('ebook_upload_operation_immutable_guard','ebook_upload_operation_no_removal_guard','ebook_upload_capacity_immutable_guard','ebook_upload_capacity_no_removal_guard') order by tgname");
  expect(always).toHaveLength(4);
  expect(always.every((row) => row.tgenabled === "A")).toBe(true);
}

async function fixture(on: Queries = c!) {
  const key = randomUUID();
  const workA = await value(on, "insert into works(title,slug,kind,original_language) values('Migration A',$1,'book','en') returning id", [`migration-a-${key}`]);
  const workB = await value(on, "insert into works(title,slug,kind,original_language) values('Migration B',$1,'book','en') returning id", [`migration-b-${key}`]);
  const editionA = await value(on, "insert into editions(work_id,title,language) values($1,'A','en') returning id", [workA]);
  const editionB = await value(on, "insert into editions(work_id,title,language) values($1,'B','en') returning id", [workB]);
  const home = await value(on, "insert into locations(name,type) values($1,'digital') returning id", [`Migration home ${key}`]);
  const copyA = await value(on, "insert into instances(edition_id,location_id,format) values($1,$2,'ebook') returning id", [editionA, home]);
  const copyB = await value(on, "insert into instances(edition_id,location_id,format) values($1,$2,'ebook') returning id", [editionB, home]);
  const ebook = await value(on, "insert into ebooks(title,language,import_source,instance_id,match_state) values('The Book 10','en','folder',$1,'linked') returning id", [copyA]);
  const fileHash = key.replaceAll("-", "").padEnd(64, "0");
  const file = await value(on, "insert into ebook_files(ebook_id,sha256,format,size_bytes,content_type,s3_key,status) values($1,$2,'epub',1,'application/epub+zip',$3,'stored') returning id", [ebook, fileHash, `test/migrations/${key}.epub`]);
  const locator = { v: 1, fileHash, href: "chapter.xhtml", sectionIndex: 0, progression: 0.5, totalProgression: 0.5, text: { highlight: "Original passage" } };
  const reading = await value(on, "insert into readings(work_id,edition_id,instance_id,format,started_precision,source) values($1,$2,$3,'ebook','unknown','reader') returning id", [workA, editionA, copyA]);
  const note = await value(on, "insert into reading_notes(work_id,reading_id,edition_id,kind,body,source,created_at,updated_at) values($1,$2,$3,'note','Manual note','manual','2024-01-01T00:00:00.000001Z','2024-01-01T00:00:00.000002Z') returning id", [workA, reading, editionA]);
  const annotation = await value(on, "insert into ebook_annotations(ebook_id,file_id,kind,style,color,locator,progression,text,client_updated_at,created_at,updated_at) values($1,$2,'highlight','highlight','ochre',$3::jsonb,0.5,'Original passage','2024-01-01T00:00:00.999999Z','2024-01-01T00:00:00.000001Z','2024-02-01T00:00:00.000002Z') returning id", [ebook, file, JSON.stringify(locator)]);
  return { workA, workB, editionA, editionB, copyA, copyB, ebook, file, fileHash, locator, reading, note, annotation };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function insertLegacyQuote(on: Queries, f: Fixture, deleted = false) {
  return value(on, "insert into ebook_annotations(ebook_id,file_id,kind,style,locator,progression,text,client_updated_at,created_at,updated_at,deleted_at) values($1,$2,'highlight','quote',$3::jsonb,0.5,'Original passage','2024-01-01T00:00:00.999999Z','2024-01-01T00:00:00.000001Z','2024-02-01T00:00:00.000002Z',$4::timestamptz) returning id", [f.ebook, f.file, JSON.stringify(f.locator), deleted ? "2024-01-20T00:00:00.000003Z" : null]);
}
async function pair() {
  return c!.begin(async (tx) => {
    const f = await fixture(tx);
    await q(tx, "update ebook_annotations set style='quote',color=null where id=$1", [f.annotation]);
    const note = await value(tx, "insert into reading_notes(work_id,kind,body,source,ebook_annotation_id) values($1,'quote','Original passage','reader',$2) returning id", [f.workA, f.annotation]);
    return { ...f, note };
  });
}
const noteVersion = (id: string) => value(c!, `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from reading_notes where id=$1`, [id]);
const epoch = (id: string) => value(c!, "select quote_binding_version::text from ebook_annotations where id=$1", [id]);
async function blockedBy(waiter: number, blocker: number) {
  const end = Date.now() + 4500;
  while (Date.now() < end) {
    if (await value<boolean>(c!, "select $2::int=any(pg_blocking_pids($1::int))", [waiter, blocker])) return;
    await new Promise((done) => setTimeout(done, 10));
  }
  throw new Error("Expected database blocker was never positively observed");
}
async function uploadFixture(on: Queries = c!, used = true) {
  const volume = randomUUID(), operation = randomUUID(), key = randomUUID();
  await q(on, "insert into ebook_upload_capacity(volume_id,binding_sha256) values($1,$2)", [volume, "a".repeat(64)]);
  if (used) await q(on, "insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,protocol_version,volume_id,input) values($1,$2,'batch',$3,$4,$5,1,$6,'{}')", [operation, key, "b".repeat(64), "c".repeat(64), "a".repeat(64), volume]);
  return { volume, operation, key };
}

describe.skipIf(!url).sequential("reader full real migration chain", () => {
  beforeAll(async () => {
    const chain = await assertSourcePins();
    // Exercise the exact frozen 0000..0088 source, not a mutable latest journal.
    folder = await mkdtemp(join(tmpdir(), "sln497-reader-history-"));
    temporaryFolders.push(folder);
    await mkdir(join(folder, "meta"));
    for (const file of chain.files) await writeFile(join(folder, file.path), file.bytes);
    expect(await value(c!, "select current_database()")).toBe("sln497_reader_migrations");
    expect(await value<number>(c!, "select current_setting('server_version_num')::int")).toBeGreaterThanOrEqual(160000);
    expect(await value<number>(c!, "select current_setting('server_version_num')::int")).toBeLessThan(170000);
    expect(await value<number>(c!, "select count(*)::int from pg_tables where schemaname not in ('pg_catalog','information_schema')")).toBe(0);
    expect(await value<boolean>(c!, "select rolsuper from pg_roles where rolname=current_user")).toBe(true);
    ownsDatabase = true;
    baseline81 = await prefixFolder(81); baseline82 = await prefixFolder(82);
  }, 120000);
  beforeEach(async () => { await resetDatabase(); }, 120000);
  afterAll(async () => {
    try { if (journal.entries.length) await assertSourcePins(); }
    finally {
      await c?.end({ timeout: 5 });
      for (const temp of temporaryFolders) await rm(temp, { recursive: true, force: true });
    }
  }, 30000);

  it("empty_full_chain: applies genuine0000..0088 and installs final policies", async () => {
    await apply(); await journalMatches(); await assertInstalledSchema();
  }, 120000);

  it("latest_full_chain: applies every later migration and preserves reader rows", async () => {
    await apply(); await fixture();
    const tables = ["ebooks", "ebook_files", "ebook_annotations", "reading_notes", "ebook_positions"];
    const before = new Map(await Promise.all(tables.map(async (table) => [table, await tableRows(table)] as const)));
    const { currentJournal } = await assertSourcePins();
    const last = currentJournal.entries.length - 1;
    await apply(sourceFolder);
    await journalMatches(last, sourceFolder);
    await assertInstalledSchema(sourceFolder, last);
    for (const table of tables) expect(await tableRows(table), table).toBe(before.get(table));
    const settled = await fingerprint();
    await apply(sourceFolder);
    expect(await fingerprint()).toEqual(settled);
  }, 120000);

  it("healthy_populated_upgrade: upgrades actual0082 without losing rows or inventing history", async () => {
    await apply(baseline82); const f = await fixture();
    const tomb = await value(c!, "insert into ebook_annotations(ebook_id,file_id,kind,style,color,locator,progression,text,client_updated_at,created_at,updated_at,deleted_at) values($1,$2,'highlight','underline','sage',$3::jsonb,0.5,'Original passage','2024-01-01T00:00:00.999999Z','2024-01-01T00:00:00.000001Z','2024-02-01T00:00:00.000002Z','2024-01-20T00:00:00.000003Z') returning id", [f.ebook, f.file, JSON.stringify(f.locator)]);
    const bookmarkLocator = { ...f.locator, text: undefined };
    await q(c!, "insert into ebook_annotations(ebook_id,file_id,kind,locator,progression,client_updated_at) values($1,$2,'bookmark',$3::jsonb,0.5,clock_timestamp())", [f.ebook, f.file, JSON.stringify(bookmarkLocator)]);
    await q(c!, "insert into ebook_positions(ebook_id,file_id,device_id,device_label,locator,progression,furthest_progression,client_updated_at) values($1,$2,$3,'Legacy device',$4::jsonb,0.5,0.5,'2024-01-01T00:00:00.999999Z')", [f.ebook, f.file, randomUUID(), JSON.stringify(f.locator)]);
    const immutable = ["ebook_positions", "readings", "reading_sessions", "ebook_files"];
    const before = new Map(await Promise.all(immutable.map(async (table) => [table, await tableRows(table)] as const)));
    const annotations = await tableRows("ebook_annotations"); const notes = await tableRows("reading_notes");
    await apply(); await journalMatches();
    for (const table of immutable) expect(await tableRows(table), table).toBe(before.get(table));
    expect(await tableRows("ebook_annotations", ["quote_binding_version"])).toBe(annotations);
    expect(await tableRows("reading_notes", ["ebook_annotation_id"])).toBe(notes);
    expect(await value(c!, "select retired_at::text from ebook_annotation_retired_ids where id=$1", [tomb])).toBe("2024-01-20 00:00:00.000003+00");
    expect(await value<boolean>(c!, "select server_time >= (select max(updated_at) from ebook_annotations where ebook_id=$1) from ebook_annotation_cursors where ebook_id=$1", [f.ebook])).toBe(true);
    expect(await value<number>(c!, "select count(*)::int from legacy_reader_progress")).toBe(0);
    expect(await value<number>(c!, "select count(*)::int from reader_sitting_receipts")).toBe(0);
    expect(await value<number>(c!, "select count(*)::int from reader_preferences")).toBe(0);
    expect(await value<boolean>(c!, "select lookup_settings is null and reading_auto_track_ebooks from app_settings where id=true")).toBe(true);
    expect(await value(c!, "select title_sort from ebooks where id=$1", [f.ebook])).toBe("book 0000000002:000010");
  }, 120000);

  it("legacy_live_quote_refusal: refuses before annotation mutation and rolls pending0082 back", async () => {
    await apply(baseline81); const f = await fixture(); await insertLegacyQuote(c!, f);
    const excluded = await value(c!, "insert into ebooks(title,import_source,match_state) values('Excluded','folder','excluded') returning id");
    const before = await fingerprint();
    expect(await refusal(apply())).toEqual({ code: "23514", constraint: "reader_legacy_quote_reconciliation_required" });
    expect(await fingerprint()).toEqual(before); await journalMatches(81, baseline81);
    expect(await value(c!, "select to_regclass('public.ebook_annotation_cursors')::text")).toBeNull();
    expect(await value(c!, "select to_regclass('public.ebook_match_candidates')::text")).toBeNull();
    expect(await value(c!, "select match_state from ebooks where id=$1", [excluded])).toBe("excluded");
  }, 120000);

  it("legacy_quote_tombstone_refusal: includes deleted quotes before later invalid checks", async () => {
    await apply(baseline82); const f = await fixture(); await insertLegacyQuote(c!, f, true);
    await q(c!, "update ebook_annotations set locator='{}' where id=$1", [f.annotation]);
    const before = await fingerprint();
    expect(await refusal(apply())).toEqual({ code: "23514", constraint: "reader_legacy_quote_reconciliation_required" });
    expect(await fingerprint()).toEqual(before); await journalMatches(82, baseline82);
  }, 120000);

  it("legacy_invalid_rows_refuse: refuses real old-schema bad data without silent repair", async () => {
    for (const item of [
      ["locator='{}'::jsonb", "ebook_annotations_locator_check"],
      ["note=repeat('n',10001)", "ebook_annotations_note_check"],
      ["created_at=updated_at+interval '1 second'", "ebook_annotations_time_check"],
    ]) {
      await resetDatabase(); await apply(baseline82); const f = await fixture();
      await q(c!, `update ebook_annotations set ${item[0]} where id=$1`, [f.annotation]);
      const before = await fingerprint();
      expect(await refusal(apply())).toEqual({ code: "23514", constraint: item[1] });
      expect(await fingerprint()).toEqual(before);
    }
  }, 120000);

  it("fault_after0088_rolls_back_full_transaction: restores rows, guards and journal", async () => {
    // Supplemental fault copy, not the unmodified-chain success test or metadata fabrication.
    const faulty = await variantFolder(88, (sql) => `${sql}\n--> statement-breakpoint\nselect 1/0;\n`);
    for (const prefix of [baseline81, baseline82]) {
      await resetDatabase(); await apply(prefix); await fixture(); const before = await fingerprint();
      expect((await refusal(apply(faulty)))?.code).toBe("22012");
      expect(await fingerprint()).toEqual(before);
      expect(await value(c!, "select to_regclass('public.ebook_upload_operations')::text")).toBeNull();
    }
  }, 120000);

  it("second_migration_run_is_noop_with_new_quote: preserves exact rows and installed hashes", async () => {
    await apply(); await pair(); const before = await fingerprint();
    await apply(); expect(await fingerprint()).toEqual(before); await journalMatches();
  }, 120000);

  it("annotation_lock_writer_first: sees writer commit after wait and permits rollback case", async () => {
    for (const commit of [true, false]) {
      await resetDatabase(); await apply(baseline82); const f = await fixture();
      const writerClient = makeClient();
      const writer = await writerClient.reserve();
      let outcome: Promise<Awaited<ReturnType<typeof refusal>>> | undefined;
      try {
        await q(writer, "begin isolation level read committed");
        const writerPid = await value<number>(writer, "select pg_backend_pid()");
        const quote = await insertLegacyQuote(writer, f);
        // Use a true max1 client for stable migrator PID; ReservedSql lacks begin at runtime.
        const solo = postgres(url!, { max: 1, onnotice: () => {}, connection: { statement_timeout: 15000, lock_timeout: 6000, timezone: "UTC", default_transaction_isolation: "read committed" } });
        try {
          const migrationPid = await value<number>(solo, "select pg_backend_pid()");
          outcome = refusal(apply(folder, solo));
          await blockedBy(migrationPid, writerPid);
          await q(writer, commit ? "commit" : "rollback");
          expect(await outcome).toEqual(commit ? { code: "23514", constraint: "reader_legacy_quote_reconciliation_required" } : null);
          expect(await value<boolean>(c!, "select exists(select 1 from ebook_annotations where id=$1)", [quote])).toBe(commit);
          await journalMatches(commit ? 82 : 88, commit ? baseline82 : folder);
        } finally { await q(writer, "rollback"); if (outcome) await outcome; await solo.end({ timeout: 5 }); }
      } finally { writer.release(); await writerClient.end({ timeout: 5 }); }
    }
    await resetDatabase(); await apply(baseline82);
    const guard = readMigrationFiles({ migrationsFolder: folder })[83].sql.slice(0, 2);
    expect((await refusal(q(c!, guard[0])))?.code).toBe("25P01");
    for (const isolation of ["repeatable read", "serializable"]) {
      await resetDatabase(); await apply(baseline82); const f = await fixture();
      let before: Awaited<ReturnType<typeof fingerprint>> | undefined;
      const denied = await refusal(c!.begin(`isolation level ${isolation}`, async (tx) => {
        await q(tx, "select count(*) from ebook_annotations"); // establish an old snapshot
        await insertLegacyQuote(c!, f); // commit from a different pool connection
        before = await fingerprint();
        await q(tx, guard[0]); await q(tx, guard[1]);
      }));
      expect(denied?.code).toBe("25000");
      expect(before).toBeDefined(); expect(await fingerprint()).toEqual(before);
      await journalMatches(82, baseline82);
    }
  }, 120000);

  it("annotation_lock_migrator_first: holds lock after guard through final chain commit", async () => {
    await apply(baseline82); const f = await fixture();
    const advisory = 4970083;
    const paused = await variantFolder(83, (sql) => {
      const statements = sql.split("--> statement-breakpoint");
      statements.splice(2, 0, `\nselect pg_advisory_xact_lock(${advisory});\n`);
      return statements.join("--> statement-breakpoint");
    });
    const gate = await c!.reserve(); const writer = await c!.reserve();
    const migrator = postgres(url!, { max: 1, onnotice: () => {}, connection: { statement_timeout: 15000, lock_timeout: 12000, timezone: "UTC", default_transaction_isolation: "read committed" } });
    let migrating: Promise<Awaited<ReturnType<typeof refusal>>> | undefined;
    let writing: Promise<Awaited<ReturnType<typeof refusal>>> | undefined;
    try {
      await q(gate, "select pg_advisory_lock($1)", [advisory]);
      const gatePid = await value<number>(gate, "select pg_backend_pid()");
      const migratePid = await value<number>(migrator, "select pg_backend_pid()");
      migrating = refusal(apply(paused, migrator)); await blockedBy(migratePid, gatePid);
      const writerPid = await value<number>(writer, "select pg_backend_pid()");
      // This locator is allowed by0082, then must be refused by installed0083 guards.
      writing = refusal(q(writer, "insert into ebook_annotations(ebook_id,file_id,kind,style,locator,progression,text,client_updated_at) values($1,$2,'highlight','quote','{}',0.5,'Queued old quote',clock_timestamp())", [f.ebook, f.file]));
      await blockedBy(writerPid, migratePid);
      await q(gate, "select pg_advisory_unlock($1)", [advisory]);
      expect(await migrating).toBeNull();
      expect(await writing).toEqual({ code: "23514", constraint: "ebook_annotation_locator_file" });
      await journalMatches(88, paused); await assertInstalledSchema();
    } finally {
      await q(gate, "select pg_advisory_unlock($1)", [advisory]);
      if (migrating) await migrating; if (writing) await writing;
      gate.release(); writer.release(); await migrator.end({ timeout: 5 });
    }
  }, 120000);

  it("natural_sort_index_semantics: uses language, exact large integers and real index order", async () => {
    await apply();
    for (const [title, language, expected] of [["The Waves", "en", "waves"], ["Les Misérables", "fr", "miserables"], ["L’Étranger", "fra", "etranger"], ["The Waves", "und", "the waves"], ["The", "en", "the"]])
      expect(await value(c!, "select ebook_title_sort($1,$2)", [title, language])).toBe(expected);
    const numbers = ["0", "2", "10", "999999", "1000000", "9007199254740992", "9007199254740993", "1" + "0".repeat(120)];
    for (const n of [...numbers].reverse()) await q(c!, "insert into ebooks(title,language,import_source) values($1,'en','folder')", [`Numbers ${n}`]);
    const ordered = await q(c!, "select title from ebooks where title like 'Numbers %' order by title_sort collate \"C\",id");
    expect(ordered.map((x) => x.title)).toEqual(numbers.map((n) => `Numbers ${n}`));
    expect(await value<boolean>(c!, "select ebook_title_sort('Book 0000002','en')=ebook_title_sort('Book 2','en')")).toBe(true);
    const id = await value(c!, "insert into ebooks(title,language,import_source) values('The Waves','en','folder') returning id");
    await q(c!, "update ebooks set title='Les Misérables',language='fr' where id=$1", [id]);
    expect(await value(c!, "select title_sort from ebooks where id=$1", [id])).toBe("miserables");
    const descending = await q(c!, "select indexdef from pg_indexes where indexname in ('ebooks_created_at_idx','ebook_ingest_items_ebook_created_idx')");
    expect(descending).toHaveLength(2); for (const row of descending) expect(String(row.indexdef)).toContain("DESC NULLS LAST");
  }, 120000);

  it("preferences_lookup_settings_constraints: enforces genuine scopes and lookup object check", async () => {
    await apply();
    await q(c!, "insert into reader_preferences(device_class,presentation) values('phone','{}')");
    expect((await refusal(q(c!, "insert into reader_preferences(device_class,presentation) values('phone','{}')")))?.code).toBe("23505");
    expect(await refusal(q(c!, "insert into reader_preferences(device_class,presentation) values('watch','{}')"))).toEqual({ code: "23514", constraint: "reader_preferences_device_class_check" });
    const book = await value(c!, "insert into ebooks(title,import_source) values('Preference','folder') returning id");
    await q(c!, "insert into reader_preferences(device_class,ebook_id,presentation) values('phone',$1,'{}')", [book]);
    await q(c!, "delete from ebooks where id=$1", [book]);
    expect(await value<number>(c!, "select count(*)::int from reader_preferences")).toBe(1);
    expect(await refusal(q(c!, "update app_settings set lookup_settings='[]' where id=true"))).toEqual({ code: "23514", constraint: "app_settings_lookup_settings_check" });
    await q(c!, "update app_settings set lookup_settings='{\"v\":1}' where id=true");
    expect(await value<number>(c!, "select (lookup_settings->>'v')::int from app_settings where id=true")).toBe(1);
  }, 120000);

  it("tracker_and0069_reference_guards: preserves reference/merge guards and sitting retirement", async () => {
    await apply(); const f = await fixture();
    expect(await refusal(q(c!, "insert into reading_notes(work_id,edition_id,kind,body) values($1,$2,'note','Wrong edition')", [f.workA, f.editionB]))).toEqual({ code: "23514", constraint: "reading_note_edition_work" });
    const otherReading = await value(c!, "insert into readings(work_id,started_precision) values($1,'unknown') returning id", [f.workB]);
    expect(await refusal(q(c!, "insert into reading_notes(work_id,reading_id,kind,body) values($1,$2,'note','Wrong reading')", [f.workA, otherReading]))).toEqual({ code: "23514", constraint: "reading_note_reading_work" });
    expect(await refusal(q(c!, "insert into reading_notes(work_id,kind,body,ebook_annotation_id) values($1,'quote','Wrong book',$2)", [f.workB, f.annotation]))).toEqual({ code: "23514", constraint: "reading_note_ebook_work" });
    // Exercise the original audited move exemption against its real evidence predicate.
    await c!.begin(async (tx) => {
      const op = await value(tx, "insert into harmonization_operations(action,entity,source_id,target_id,label,\"before\") values('merge','works',$1,$2,'Migration guard probe','{}') returning id", [f.workA, f.workB]);
      await q(tx, "select set_config('durtal.harmonization_operation',$1,true)", [op]);
      await q(tx, "update reading_notes set work_id=$1 where id=$2", [f.workB, f.note]);
      expect(await value(tx, "select work_id from reading_notes where id=$1", [f.note])).toBe(f.workB);
      // Restore before commit; this tests guard pass-through without claiming a full catalogue merge.
      await q(tx, "update reading_notes set work_id=$1 where id=$2", [f.workA, f.note]);
    });
    const ordinaryVersion = await noteVersion(f.note);
    await q(c!, "update reading_notes set edition_id=null where id=$1", [f.note]);
    expect(await noteVersion(f.note)).toBe(ordinaryVersion);
    const bound = await pair();
    const alternativeEdition = await value(c!, "insert into editions(work_id,title,language) values($1,'Alternative','en') returning id", [bound.workA]);
    const epochs = [await epoch(bound.annotation)]; let version = await noteVersion(bound.note);
    for (const edition of [bound.editionA, alternativeEdition, bound.editionA]) {
      await q(c!, "update reading_notes set edition_id=$1 where id=$2", [edition, bound.note]);
      epochs.push(await epoch(bound.annotation));
      const next = await noteVersion(bound.note);
      expect(next).toMatch(/\.\d{6}Z$/); expect(next > version).toBe(true); version = next;
    }
    expect(new Set(epochs).size).toBe(4); // A-B-A never restores the original epoch.
    const sitting = randomUUID(); let session = "";
    await c!.begin(async (tx) => {
      session = await value(tx, "insert into reading_sessions(reading_id,edition_id,format,read_on,time_zone,source,started_at,ended_at,duration_seconds,start_percent,end_percent) values($1,$2,'ebook','2024-01-01','UTC','reader','2024-01-01T00:00:00Z','2024-01-01T00:05:00Z',300,0,5) returning id", [f.reading, f.editionA]);
      await q(tx, "insert into reader_sitting_receipts(sitting_id,reading_id,ebook_id,device_id,original_session_id,session_id,revision,started_at,ended_at,active_seconds,start_percent,end_percent,time_zone) values($1,$2,$3,$4,$5,$5,1,'2024-01-01T00:00:00Z','2024-01-01T00:05:00Z',300,0,5,'UTC')", [sitting, f.reading, f.ebook, randomUUID(), session]);
    });
    await q(c!, "delete from reading_sessions where id=$1", [session]);
    expect(await value(c!, "select state from reader_sitting_receipts where sitting_id=$1", [sitting])).toBe("retired");
    expect(await value(c!, "select original_session_id from reader_sitting_receipts where sitting_id=$1", [sitting])).toBe(session);
    expect(await value(c!, "select session_id from reader_sitting_receipts where sitting_id=$1", [sitting])).toBeNull();
    expect(await refusal(q(c!, "truncate reader_sitting_receipts"))).toEqual({ code: "23514", constraint: "reader_sitting_receipt_permanent" });
  }, 120000);

  it("upload_history_always_guards: enforces immutable history including replica sessions", async () => {
    await apply(); const f = await uploadFixture(); const unused = await uploadFixture(c!, false);
    await q(c!, "update ebook_upload_capacity set binding_sha256=$1 where volume_id=$2", ["d".repeat(64), unused.volume]);
    expect((await refusal(q(c!, "update ebook_upload_capacity set binding_sha256=$1 where volume_id=$2", ["d".repeat(64), f.volume])))?.code).toBe("23514");
    expect((await refusal(q(c!, "update ebook_upload_operations set input='{\"changed\":true}' where id=$1", [f.operation])))?.code).toBe("23514");
    await q(c!, "update ebook_upload_operations set receipt='{\"ok\":true}',receipt_status=200,effect_committed_at=clock_timestamp(),state='completed',revision=1 where id=$1", [f.operation]);
    expect((await refusal(q(c!, "update ebook_upload_operations set receipt='{\"ok\":false}' where id=$1", [f.operation])))?.code).toBe("23514");
    expect((await refusal(q(c!, "update ebook_upload_operations set revision=0 where id=$1", [f.operation])))?.code).toBe("23514");
    expect((await refusal(q(c!, "update ebook_upload_operations set effect_committed_at=clock_timestamp() where id=$1", [f.operation])))?.code).toBe("23514");
    await q(c!, "update ebook_upload_capacity set revision=1,owner_fence=1,measurement_generation=1 where volume_id=$1", [f.volume]);
    for (const field of ["revision", "owner_fence", "measurement_generation"])
      expect((await refusal(q(c!, `update ebook_upload_capacity set ${field}=0 where volume_id=$1`, [f.volume])))?.code).toBe("23514");
    const before = await fingerprint();
    for (const table of ["ebook_upload_operations", "ebook_upload_capacity"]) {
      expect((await refusal(q(c!, `delete from ${table}`)))?.code).toBe("23514");
      expect((await refusal(q(c!, `truncate ${table} cascade`)))?.code).toBe("23514");
      expect((await refusal(c!.begin(async (tx) => {
        await q(tx, "set local session_replication_role=replica"); await q(tx, `delete from ${table}`);
      })))?.code).toBe("23514");
    }
    expect(await fingerprint()).toEqual(before);
    expect(await value(c!, "select current_setting('session_replication_role')")).toBe("origin");
    await assertInstalledSchema();
  }, 120000);

  it("installed_contract_replays_noops: keeps retirement, retained quotes and paired Undo coherent", async () => {
    await apply(); const f = await fixture();
    const result = await value<{ status: string }>(c!, "select durtal_annotation_finalize_delete($1,$2,clock_timestamp(),'migration-delete',1,'{\"action\":\"none\"}')", [f.ebook, f.annotation]);
    expect(result.status).toBe("committed");
    const retired = await fingerprint();
    expect((await value<{ status: string }>(c!, "select durtal_annotation_finalize_delete($1,$2,clock_timestamp(),'migration-delete',1,'{\"action\":\"none\"}')", [f.ebook, f.annotation])).status).toBe("already-retired");
    expect(await fingerprint()).toEqual(retired);
    expect(await refusal(q(c!, "truncate ebook_annotation_retired_ids"))).toEqual({ code: "23514", constraint: "ebook_annotation_retirement_no_truncate" });
    expect(await refusal(q(c!, "truncate ebook_annotation_cursors cascade"))).toEqual({ code: "23514", constraint: "ebook_annotation_cursor_no_truncate" });
    const kept = await pair();
    const effect = JSON.stringify({ action: "keep-quote", noteId: kept.note, expectedNoteVersion: await noteVersion(kept.note), expectedBindingVersion: await epoch(kept.annotation) });
    expect((await value<{ status: string }>(c!, "select durtal_annotation_finalize_delete($1,$2,clock_timestamp(),'keep',1,$3::jsonb)", [kept.ebook, kept.annotation, effect])).status).toBe("committed");
    expect(await value(c!, "select ebook_annotation_id from reading_notes where id=$1", [kept.note])).toBeNull();
    const afterKeep = await fingerprint();
    expect((await value<{ status: string }>(c!, "select durtal_annotation_finalize_delete($1,$2,clock_timestamp(),'keep',1,$3::jsonb)", [kept.ebook, kept.annotation, effect])).status).toBe("already-retired");
    expect(await fingerprint()).toEqual(afterKeep);
    const undo = await pair(), token = randomUUID();
    expect((await value<{ status: string }>(c!, "select durtal_reader_delete_quote_with_undo($1,$2,$3,$4,$5,$6)", [undo.ebook, undo.annotation, undo.note, await noteVersion(undo.note), await epoch(undo.annotation), token])).status).toBe("committed");
    expect((await value<{ status: string }>(c!, "select durtal_reader_restore_quote($1,$2)", [token, undo.note])).status).toBe("committed");
    const restored = await fingerprint();
    expect((await value<{ status: string }>(c!, "select durtal_reader_restore_quote($1,$2)", [token, undo.note])).status).toBe("replayed");
    expect(await fingerprint()).toEqual(restored);
    expect(await value(c!, "select style from ebook_annotations where id=$1", [undo.annotation])).toBe("quote");
    expect(await value(c!, "select ebook_annotation_id from reading_notes where id=$1", [undo.note])).toBe(undo.annotation);
    const upload = await uploadFixture(); const operations = await tableRows("ebook_upload_operations");
    await q(c!, "insert into ebook_upload_operations(id,idempotency_key,kind,request_sha256,target_fingerprint,binding_sha256,protocol_version,volume_id,input) values($1,$2,'batch',$3,$4,$5,1,$6,'{}') on conflict(idempotency_key) do nothing", [randomUUID(), upload.key, "b".repeat(64), "c".repeat(64), "a".repeat(64), upload.volume]);
    expect(await tableRows("ebook_upload_operations")).toBe(operations);
  }, 120000);
});
