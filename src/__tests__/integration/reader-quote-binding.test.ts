import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

// No environment-file or live fallback. Run only after approved 0083/0087
// generation/rehearsal. This suite never applies the review SQL itself.
const url = process.env.DURTAL_READER_QUOTE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln454_reader_quote")
    throw new Error("Reader quote tests require disposable local sln454_reader_quote");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
type Queries = Pick<postgres.Sql, "unsafe">;
const q = (on: Queries, text: string, params: postgres.ParameterOrJSON<never>[] = []) => on.unsafe(text, params);
async function value<T = string>(on: Queries, text: string, params: postgres.ParameterOrJSON<never>[] = []): Promise<T> {
  return Object.values((await q(on, text, params))[0])[0] as T;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const stampSql = `to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

describe.skipIf(!url)("reader quote versions and catalogue races", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(drizzle(c), { migrationsFolder: "src/lib/db/migrations" });
    const installed = await value<boolean>(c, `select
      to_regprocedure('public.durtal_reader_lock_quote_ebooks(uuid[])') is not null
      and to_regprocedure('public.durtal_annotation_finalize_delete(uuid,uuid,timestamp with time zone,text,bigint,jsonb)') is not null`);
    if (!installed) throw new Error("Approved 0083/0087 and composed quote functions must be installed; review drafts are never test migrations");
  }, 60000);
  afterAll(async () => { await client?.end(); });

  // Each test owns fresh fixtures; no TRUNCATE can erase permanent receipts.
  // The test runner destroys this dedicated disposable database afterward.
  async function fixture() {
    return c.begin(async (tx) => {
      const key = randomUUID();
      const workA = await value(tx, `insert into works(title,slug,kind,original_language) values ('Quote A',$1,'book','en') returning id`, [`quote-a-${key}`]);
      const workB = await value(tx, `insert into works(title,slug,kind,original_language) values ('Quote B',$1,'book','en') returning id`, [`quote-b-${key}`]);
      const editionA = await value(tx, `insert into editions(work_id,title,language) values ($1,'A','en') returning id`, [workA]);
      const editionB = await value(tx, `insert into editions(work_id,title,language) values ($1,'B','en') returning id`, [workB]);
      const home = await value(tx, `insert into locations(name,type) values ('Quote test','digital') returning id`);
      const copyA = await value(tx, `insert into instances(edition_id,location_id,format) values ($1,$2,'ebook') returning id`, [editionA, home]);
      const copyB = await value(tx, `insert into instances(edition_id,location_id,format) values ($1,$2,'ebook') returning id`, [editionB, home]);
      const ebook = await value(tx, `insert into ebooks(title,import_source,instance_id,match_state) values ('Quote test','folder',$1,'linked') returning id`, [copyA]);
      const hash = key.replaceAll("-", "").padEnd(64, "0");
      const file = await value(tx, `insert into ebook_files(ebook_id,sha256,format,size_bytes,content_type,s3_key,status)
        values ($1,$2,'epub',1,'application/epub+zip',$3,'stored') returning id`, [ebook, hash, `gold/media/ebooks/quote-test-${key}.epub`]);
      const locator = JSON.stringify({ v: 1, fileHash: hash, href: "OPS/chapter.xhtml", sectionIndex: 0, progression: 0.5, totalProgression: 0.5, text: { highlight: "Original passage" } });
      const annotation = await value(tx, `insert into ebook_annotations(ebook_id,file_id,kind,style,locator,progression,text,client_updated_at)
        values ($1,$2,'highlight','quote',$3::jsonb,0.5,'Original passage',clock_timestamp()) returning id`, [ebook, file, locator]);
      const note = await value(tx, `insert into reading_notes(work_id,kind,body,source,ebook_annotation_id)
        values ($1,'quote','Original passage','reader',$2) returning id`, [workA, annotation]);
      return { workA, workB, copyA, copyB, ebook, annotation, note };
    });
  }
  async function blockedBy(waiter: number, blocker: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (await value<boolean>(c, `select $2::int=any(pg_blocking_pids($1::int))`, [waiter, blocker])) return;
      await new Promise((done) => setTimeout(done, 10));
    }
    throw new Error("Concurrent writer never reached the expected database lock");
  }
  const version = (note: string) => value(c, `select ${stampSql} from reading_notes where id=$1`, [note]);
  const epoch = (annotation: string) => value(c, `select quote_binding_version::text from ebook_annotations where id=$1`, [annotation]);

  it("stamps successive edits strictly later even when the application clock repeats or moves back", async () => {
    const f = await fixture();
    const original = await version(f.note);
    await q(c, `update reading_notes set body='Edit one',updated_at='2000-01-01T00:00:00Z' where id=$1`, [f.note]);
    const first = await version(f.note);
    await q(c, `update reading_notes set body='Edit two',updated_at='2000-01-01T00:00:00Z' where id=$1`, [f.note]);
    const second = await version(f.note);
    expect(first > original).toBe(true);
    expect(second > first).toBe(true);
    expect(second).toMatch(/\.\d{6}Z$/);
    expect(await value(c, `select text from ebook_annotations where id=$1`, [f.annotation])).toBe("Original passage");
  });

  it("preserves an ordinary imported note's unedited timestamp during automatic reference clearing", async () => {
    const f = await fixture();
    const reading = await value(c, `insert into readings(work_id,started_precision) values ($1,'unknown') returning id`, [f.workA]);
    const note = await value(c, `insert into reading_notes(work_id,reading_id,kind,body,source) values ($1,$2,'note','Imported','import') returning id`, [f.workA, reading]);
    const before = await version(note);
    await q(c, `delete from readings where id=$1`, [reading]);
    expect(await version(note)).toBe(before);
    expect(await value<boolean>(c, `select updated_at=created_at from reading_notes where id=$1`, [note])).toBe(true);
  });

  it("rotates the epoch through A-B-A and refuses an old binding token even with the fresh note version", async () => {
    const f = await fixture();
    const oldEpoch = await epoch(f.annotation);
    await c.begin(async (tx) => {
      await q(tx, `select public.durtal_reader_lock_quote_ebooks(array[$1::uuid])`, [f.ebook]);
      await q(tx, `update reading_notes set ebook_annotation_id=null where id=$1`, [f.note]);
      await q(tx, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyB]);
    });
    const middleEpoch = await epoch(f.annotation);
    expect(middleEpoch).not.toBe(oldEpoch);
    await c.begin(async (tx) => {
      await q(tx, `select public.durtal_reader_lock_quote_ebooks(array[$1::uuid])`, [f.ebook]);
      await q(tx, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyA]);
      await q(tx, `update reading_notes set ebook_annotation_id=$2 where id=$1`, [f.note, f.annotation]);
    });
    const currentEpoch = await epoch(f.annotation);
    expect(currentEpoch).not.toBe(oldEpoch);
    expect(currentEpoch).not.toBe(middleEpoch);
    const effect = JSON.stringify({ action: "delete-quote", noteId: f.note, expectedNoteVersion: await version(f.note), expectedBindingVersion: oldEpoch });
    const result = await value<{ status: string; reason: string }>(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`, [f.ebook, f.annotation, randomUUID(), effect]);
    expect(result).toEqual({ status: "conflict", reason: "binding-version" });
    expect(await value<boolean>(c, `select deleted_at is null from ebook_annotations where id=$1`, [f.annotation])).toBe(true);
    expect(await value<boolean>(c, `select exists(select 1 from reading_notes where id=$1)`, [f.note])).toBe(true);
  });

  it("serializes a quote edit before relink; the incompatible relink rolls back", async () => {
    const f = await fixture();
    const held = deferred<number>(), release = deferred<void>(), waiter = deferred<number>();
    const first = c.begin(async (tx) => {
      const pid = await value<number>(tx, `select pg_backend_pid()`);
      await q(tx, `select public.durtal_reader_lock_quote_notes(array[$1::uuid])`, [f.note]);
      await q(tx, `update reading_notes set body='Committed edit' where id=$1`, [f.note]);
      held.resolve(pid);
      await release.promise;
    });
    const blocker = await Promise.race([held.promise, first.then(() => { throw new Error("First writer ended before acquiring its locks"); })]);
    const second = c.begin(async (tx) => {
      waiter.resolve(await value<number>(tx, `select pg_backend_pid()`));
      await q(tx, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyB]);
    }).then(() => null, (error: { code: string; constraint_name: string }) => error);
    try {
      const pid = await Promise.race([waiter.promise, second.then(() => { throw new Error("Second writer ended before announcing its connection"); })]);
      await blockedBy(pid, blocker);
    } finally { release.resolve(undefined); }
    await first;
    expect(await second).toMatchObject({ code: "23514", constraint_name: "reading_note_ebook_work" });
    expect(await value(c, `select instance_id from ebooks where id=$1`, [f.ebook])).toBe(f.copyA);
    expect(await value(c, `select body from reading_notes where id=$1`, [f.note])).toBe("Committed edit");
  }, 10000);

  it("rereads ownership after waiting behind relink and refuses insertion on the old book", async () => {
    const f = await fixture();
    const held = deferred<number>(), release = deferred<void>(), waiter = deferred<number>();
    const first = c.begin(async (tx) => {
      const pid = await value<number>(tx, `select pg_backend_pid()`);
      await q(tx, `select public.durtal_reader_lock_quote_ebooks(array[$1::uuid])`, [f.ebook]);
      await q(tx, `update reading_notes set ebook_annotation_id=null where id=$1`, [f.note]);
      await q(tx, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyB]);
      held.resolve(pid);
      await release.promise;
    });
    const blocker = await Promise.race([held.promise, first.then(() => { throw new Error("First writer ended before acquiring its locks"); })]);
    const second = c.begin(async (tx) => {
      waiter.resolve(await value<number>(tx, `select pg_backend_pid()`));
      await q(tx, `insert into reading_notes(work_id,kind,body,source,ebook_annotation_id) values ($1,'quote','Stale insert','reader',$2)`, [f.workA, f.annotation]);
    }).then(() => null, (error: { code: string; constraint_name: string }) => error);
    try {
      const pid = await Promise.race([waiter.promise, second.then(() => { throw new Error("Second writer ended before announcing its connection"); })]);
      await blockedBy(pid, blocker);
    } finally { release.resolve(undefined); }
    await first;
    expect(await second).toMatchObject({ code: "23514", constraint_name: "reading_note_ebook_work" });
    expect(await value(c, `select instance_id from ebooks where id=$1`, [f.ebook])).toBe(f.copyB);
    expect(await value<number>(c, `select count(*)::int from reading_notes where ebook_annotation_id=$1`, [f.annotation])).toBe(0);
  }, 10000);

  it("deleting a kept quote never changes or recreates its retired mark", async () => {
    const f = await fixture();
    const effect = JSON.stringify({ action: "keep-quote", noteId: f.note, expectedNoteVersion: await version(f.note), expectedBindingVersion: await epoch(f.annotation) });
    const kept = await value<{ status: string }>(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`, [f.ebook, f.annotation, randomUUID(), effect]);
    expect(kept).toEqual({ status: "committed" });
    const before = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    await q(c, `delete from reading_notes where id=$1`, [f.note]);
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(before);
    expect(await value<boolean>(c, `select exists(select 1 from ebook_annotation_retired_ids where id=$1)`, [f.annotation])).toBe(true);
  });
});
