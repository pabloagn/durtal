import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
import { createAnnotationController } from "@/lib/reader/annotation-controller";
import { saveQuoteWithRefresh, subscribeAnnotationServerChanges } from "@/lib/reader/annotation-server-changes";
import type { AnnotationBookState, AnnotationTransport } from "@/lib/reader/sync/annotation-transport";
import { QUIET_GLASS_ANNOTATION_PALETTE } from "@/lib/reader/annotation-colors";
import { fakeEngine } from "../reader/fixtures/fake-engine";

// No environment-file or live fallback. Run only after approved 0083/0087
// generation/rehearsal. This suite never applies the review SQL itself.
const url = process.env.DURTAL_READER_QUOTE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln454_reader_quote")
    throw new Error("Reader quote tests require disposable local sln454_reader_quote");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
// Only replace the application's connection and Next cache boundary, as in
// other local integration suites. Quote planning, writes and reads stay real.
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_, prop) => {
  if (!testDb) throw new Error("Disposable reader quote database required");
  return Reflect.get(testDb, prop);
} }) }));
vi.mock("@/lib/cache", () => ({ cached: (fn: unknown) => fn, invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
import { saveReaderQuote } from "@/lib/actions/reader-tracking";
import { deleteReadingNote, restoreReadingNote } from "@/lib/actions/reading-notes";
import { readAnnotations } from "@/lib/reader/annotation-store";
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
      and to_regprocedure('public.durtal_reader_delete_quote_with_undo(uuid,uuid,uuid,text,text,uuid)') is not null
      and to_regprocedure('public.durtal_reader_restore_quote(uuid,uuid)') is not null
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
      return { workA, workB, copyA, copyB, ebook, annotation, note, file, locator: JSON.parse(locator) };
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
  async function pairedDelete(f: Awaited<ReturnType<typeof fixture>>) {
    const token = randomUUID();
    const result = await value<{ status: string; token: string; ebookId: string }>(c,
      `select public.durtal_reader_delete_quote_with_undo($1,$2,$3,$4,$5,$6)`,
      [f.ebook, f.annotation, f.note, await version(f.note), await epoch(f.annotation), token]);
    expect(result).toEqual({ status: "committed", token, ebookId: f.ebook });
    return token;
  }
  const originalMark = (annotation: string) => value(c,
    `select jsonb_build_array(id,file_id,locator,text,note,client_updated_at)::text from ebook_annotations where id=$1`, [annotation]);

  it("real saveReaderQuote commits both rows and refreshes the actual controller after an older locked server read", async () => {
    const f = await fixture();
    let current: AnnotationBookState = { annotations: [], pending: [], cursor: null };
    const listeners = new Set<() => void>();
    const transport: AnnotationTransport = {
      enqueue: vi.fn(async () => {}),
      readBook: async () => structuredClone(current),
      transactBook: async (_ebookId, reduce) => {
        current = structuredClone(reduce(structuredClone(current)));
        listeners.forEach((fn) => fn());
        return structuredClone(current);
      },
      subscribe: (_ebookId, fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
      requestReplay: async () => {},
    };
    const captured = deferred<void>(), release = deferred<void>();
    let calls = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const since = new URL(String(input), "http://localhost").searchParams.get("since");
      const rows = await readAnnotations(f.ebook, since);
      if (++calls === 1) { captured.resolve(undefined); await release.promise; }
      return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
    });
    const { engine } = fakeEngine();
    const controller = createAnnotationController({ ebookId: f.ebook, fileId: f.file, deviceId: randomUUID(),
      engine, transport, fetch, window: null, palette: () => QUIET_GLASS_ANNOTATION_PALETTE,
      deletion: { prepare: async () => ({ status: "proceed", effect: { action: "none" } }) },
      yieldWork: async () => {},
    });
    const stop = subscribeAnnotationServerChanges(f.ebook, () => controller.serverChanged());
    try {
      await controller.ready;
      controller.firstPaint();
      await vi.waitFor(() => expect(calls).toBe(1));
      await captured.promise;
      let committed!: { annotationId: string };
      const saving = saveQuoteWithRefresh(f.ebook, async () => {
        committed = await saveReaderQuote({ ebookId: f.ebook, fileId: f.file, locator: f.locator,
          text: "Original passage", chapter: "Chapter", percent: 50 });
        return committed;
      }, (error) => { throw error; });
      // The action has committed, but its response handoff waits for the old GET.
      await vi.waitFor(() => expect(committed?.annotationId).toBeTypeOf("string"));
      expect(controller.getSnapshot().annotations.some((row) => row.id === committed.annotationId)).toBe(false);
      expect(await value(c, `select jsonb_build_object('body',body,'source',source,'work',work_id) from reading_notes where ebook_annotation_id=$1`, [committed.annotationId])).toEqual({ body: "Original passage", source: "reader", work: f.workA });
      release.resolve(undefined);
      expect((await saving).annotationId).toBe(committed.annotationId);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(controller.getSnapshot().annotations).toContainEqual(expect.objectContaining({ id: committed.annotationId, style: "quote" }));
      await vi.waitFor(() => expect(engine.setDecorations).toHaveBeenLastCalledWith("annotations",
        expect.arrayContaining([expect.objectContaining({ id: committed.annotationId, style: "quote" })])));
      expect(transport.enqueue).not.toHaveBeenCalled();
    } finally { release.resolve(undefined); stop(); controller.destroy(); }
  });

  it("restores both sides from server evidence, preserves edited quote provenance, and replays Undo once", async () => {
    const f = await fixture();
    await q(c, `update reading_notes set body='Edited quote',comment_html='<p>My thought</p>',is_favourite=true where id=$1`, [f.note]);
    const mark = await originalMark(f.annotation);
    const oldEpoch = await epoch(f.annotation);
    const snapshot = await deleteReadingNote({ id: f.note });
    expect(snapshot.readerQuoteUndo?.ebookId).toBe(f.ebook);
    const token = snapshot.readerQuoteUndo!.token;
    expect(await value<number>(c, `select count(*)::int from reading_notes where id=$1`, [f.note])).toBe(0);
    expect(await value(c, `select style from ebook_annotations where id=$1`, [f.annotation])).toBe("highlight");
    await restoreReadingNote({ ...snapshot, body: "Forged client body", workId: f.workB });
    expect(await originalMark(f.annotation)).toBe(mark);
    expect(await value(c, `select style from ebook_annotations where id=$1`, [f.annotation])).toBe("quote");
    expect(await epoch(f.annotation)).not.toBe(oldEpoch);
    expect(await value(c, `select jsonb_build_object('body',body,'thought',comment_html,'favourite',is_favourite,
      'source',source,'work',work_id,'annotation',ebook_annotation_id) from reading_notes where id=$1`, [f.note])).toEqual({
      body: "Edited quote", thought: "<p>My thought</p>", favourite: true, source: "reader", work: f.workA, annotation: f.annotation,
    });
    const restoredMark = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    expect(await value(c, `select public.durtal_reader_restore_quote($1,$2)`, [token, f.note])).toEqual({ status: "replayed" });
    expect(await value<number>(c, `select count(*)::int from reading_notes where id=$1`, [f.note])).toBe(1);
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(restoredMark);
  });

  it.each(["edit", "retire", "binding", "binding-back", "expire"] as const)("refuses paired Undo after %s without changing either side", async (change) => {
    const f = await fixture();
    const token = await pairedDelete(f);
    if (change === "edit") await q(c, `update ebook_annotations set color='rose' where id=$1`, [f.annotation]);
    if (change === "retire") await q(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,'{"action":"none"}'::jsonb)`, [f.ebook, f.annotation, randomUUID()]);
    if (change === "binding" || change === "binding-back") await q(c, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyB]);
    if (change === "binding-back") await q(c, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyA]);
    if (change === "expire") await q(c, `update reader_quote_undo_receipts set expires_at=clock_timestamp()-interval '1 second' where token=$1`, [token]);
    const before = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    expect(await value(c, `select public.durtal_reader_restore_quote($1,$2)`, [token, f.note])).toMatchObject({ status: "conflict" });
    expect(await value<number>(c, `select count(*)::int from reading_notes where id=$1`, [f.note])).toBe(0);
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(before);
  });

  it("applies prepared keep by clearing only the pointer, retains old-book provenance, and permits later relink", async () => {
    const f = await fixture();
    const before = await value(c, `select (to_jsonb(n)-array['ebook_annotation_id','updated_at'])::text from reading_notes n where id=$1`, [f.note]);
    const effect = { action: "keep-quote", noteId: f.note, expectedNoteVersion: await version(f.note), expectedBindingVersion: await epoch(f.annotation) };
    await c.begin(async (tx) => {
      expect(await value(tx, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`,
        [f.ebook, f.annotation, randomUUID(), JSON.stringify(effect)])).toEqual({ status: "committed" });
      await q(tx, `update ebooks set instance_id=$2 where id=$1`, [f.ebook, f.copyB]);
    });
    expect(await value(c, `select ebook_annotation_id from reading_notes where id=$1`, [f.note])).toBeNull();
    expect(await value(c, `select (to_jsonb(n)-array['ebook_annotation_id','updated_at'])::text from reading_notes n where id=$1`, [f.note])).toBe(before);
    const retired = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    expect(await value(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`,
      [f.ebook, f.annotation, randomUUID(), JSON.stringify({ ...effect, action: "delete-quote" })])).toEqual({ status: "already-retired" });
    expect(await value<number>(c, `select count(*)::int from reading_notes where id=$1`, [f.note])).toBe(1);
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(retired);
  });

  it("rejects a stale prepared delete without effects and applies a fresh explicit delete atomically", async () => {
    const f = await fixture();
    const effect = { action: "delete-quote", noteId: f.note, expectedNoteVersion: await version(f.note), expectedBindingVersion: await epoch(f.annotation) };
    await q(c, `update reading_notes set body='Keep my edit' where id=$1`, [f.note]);
    const mark = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    const note = await value(c, `select to_jsonb(n)::text from reading_notes n where id=$1`, [f.note]);
    expect(await value(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`,
      [f.ebook, f.annotation, randomUUID(), JSON.stringify(effect)])).toEqual({ status: "conflict", reason: "note-version" });
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(mark);
    expect(await value(c, `select to_jsonb(n)::text from reading_notes n where id=$1`, [f.note])).toBe(note);
    effect.expectedNoteVersion = await version(f.note);
    effect.expectedBindingVersion = await epoch(f.annotation);
    expect(await value(c, `select public.durtal_annotation_finalize_delete($1,$2,clock_timestamp(),$3,1,$4::jsonb)`,
      [f.ebook, f.annotation, randomUUID(), JSON.stringify(effect)])).toEqual({ status: "committed" });
    expect(await value<number>(c, `select count(*)::int from reading_notes where id=$1`, [f.note])).toBe(0);
    expect(await value<boolean>(c, `select deleted_at is not null from ebook_annotations where id=$1`, [f.annotation])).toBe(true);
  });

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
    expect(await value(c, `select ebook_annotation_id from reading_notes where id=$1`, [f.note])).toBeNull();
    const before = await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation]);
    await q(c, `delete from reading_notes where id=$1`, [f.note]);
    expect(await value(c, `select to_jsonb(a)::text from ebook_annotations a where id=$1`, [f.annotation])).toBe(before);
    expect(await value<boolean>(c, `select exists(select 1 from ebook_annotation_retired_ids where id=$1)`, [f.annotation])).toBe(true);
  });
});
