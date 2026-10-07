import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_READING_QUEUE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln452_reading_queue")
    throw new Error("Up Next tests require a disposable local sln452_reading_queue database");
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, prop) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, prop);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  cached: (fn: unknown) => fn,
  invalidate: vi.fn(),
  CACHE_TAGS: new Proxy({}, { get: (_, prop) => String(prop) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  addManyToQueue,
  addToQueue,
  getQueue,
  moveQueueItem,
  removeFromQueue,
  restoreQueueItem,
  updateQueueItem,
} from "@/lib/actions/reading-queue";
import { startReading } from "@/lib/actions/reading";
import { deleteEdition, updateEdition } from "@/lib/actions/editions";
import { moveToExistingEdition } from "@/lib/actions/identify";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { writeReadings } from "@/lib/reading/service";
import { queueAtHand, queueWhereabouts } from "@/lib/reading/queue";
import { NextRequest } from "next/server";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { commitImport, createReadingImport, decideRow, undoImport } from "@/lib/reading/import/store";
import { getImportPreview } from "@/lib/reading/import/page-data";
import { getWorkCount, getWorks } from "@/lib/actions/works";
import { LIBRARY_SORTS, parseReadingFilters } from "@/lib/reading/filter-params";
import { GET as listWorks } from "@/app/api/works/route";
import { activitySettled } from "@/lib/activity/record";

/* Up Next against PostgreSQL (SLN-452). */

describe.skipIf(!url)("Up Next with PostgreSQL", () => {
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, locations, activity_events, imports cascade`);
  });

  let serial = 0;
  const book = async (title: string, kind = "book") =>
    value(`insert into works(title, slug, kind, original_language) values ($1, $2, $3::text::work_kind_enum, case when $3::text = 'book' then 'en' end) returning id`, [
      title,
      `${title.toLowerCase().replace(/\W+/g, "-")}-${++serial}`,
      kind,
    ]);
  const edition = async (workId: string, pages: number | null = 300, extra: Record<string, unknown> = {}) =>
    value(`insert into editions(work_id, title, language, page_count, metadata_source) values ($1, 'E', 'en', $2, $3) returning id`, [workId, pages, (extra.metadataSource as string) ?? null]);
  const place = async (name: string, type = "physical") => value(`insert into locations(name, type) values ($1, $2) returning id`, [name, type]);
  const copy = async (editionId: string, locationId: string, status = "available", extra: { lentTo?: string; lentDate?: string } = {}) =>
    value(`insert into instances(edition_id, location_id, status, format, lent_to, lent_date) values ($1, $2, $3, 'paperback', $4, $5) returning id`, [
      editionId,
      locationId,
      status,
      extra.lentTo ?? null,
      extra.lentDate ?? null,
    ]);
  const order = async () => (await q(`select w.title from reading_queue q join works w on w.id = q.work_id order by q.position, q.work_id`)).map((r) => r.title);
  const positions = async () => (await q(`select position from reading_queue order by position`)).map((r) => r.position as number);

  describe("adding and removing", () => {
    it("adds at the bottom or the top, and refuses a queued book and a book being read", async () => {
      const [a, b, c] = [await book("Nadja"), await book("La Curée"), await book("Watt")];
      await addToQueue({ workId: a });
      await addToQueue({ workId: b, note: "M. says start with this one" });
      expect(await addToQueue({ workId: c, at: "top" })).toMatchObject({ place: 1 });
      expect(await order()).toEqual(["Watt", "Nadja", "La Curée"]);
      await expect(addToQueue({ workId: b })).rejects.toThrow("Already in Up Next, at 3");
      const d = await book("Moby-Dick");
      await startReading({ workId: d });
      await expect(addToQueue({ workId: d })).rejects.toThrow("Moby-Dick is being read");
      expect(await value(`select note from reading_queue where work_id = $1`, [b])).toBe("M. says start with this one");
      // History entries are written after an action returns (SLN-521)
      await activitySettled();
      expect(await value(`select count(*)::int from activity_events where event_key = 'work.queued'`)).toBe(3);
      // A second add the same day records nothing more
      await removeFromQueue({ workId: a });
      await addToQueue({ workId: a });
      expect(await value(`select count(*)::int from activity_events where event_key = 'work.queued' and entity_id = $1`, [a])).toBe(1);
    });

    it("refuses a film, a perfume and a painting, by the action and by the trigger", async () => {
      for (const kind of ["film", "perfume", "painting"]) {
        const w = await book(`Not a book ${kind}`, kind);
        await expect(addToQueue({ workId: w })).rejects.toThrow(/(?:Book|Work) not found/);
        await expect(q(`insert into reading_queue(work_id, position) values ($1, 1024)`, [w])).rejects.toMatchObject({ code: "23514", constraint_name: "book_parent_required" });
      }
    });

    it("removes and restores an item at its place, and refuses a restore once the book was queued or started again", async () => {
      const [a, b, c] = [await book("A"), await book("B"), await book("C")];
      for (const w of [a, b, c]) await addToQueue({ workId: w });
      const removed = await removeFromQueue({ workId: b });
      expect(await order()).toEqual(["A", "C"]);
      expect(await restoreQueueItem(removed)).toMatchObject({ place: 2 });
      expect(await order()).toEqual(["A", "B", "C"]);
      expect(await value(`select id from reading_queue where work_id = $1`, [b])).toBe(removed.id);
      // Its position taken meanwhile: the next free one after it
      const again = await removeFromQueue({ workId: b });
      await q(`update reading_queue set position = $1 where work_id = $2`, [again.position, c]);
      await restoreQueueItem(again);
      expect(await value<number>(`select position from reading_queue where work_id = $1`, [b])).toBe(again.position + 1);
      const gone = await removeFromQueue({ workId: a });
      await addToQueue({ workId: a });
      await expect(restoreQueueItem(gone)).rejects.toThrow("A is in Up Next again");
      const started = await removeFromQueue({ workId: c });
      await startReading({ workId: c });
      await expect(restoreQueueItem(started)).rejects.toThrow("C was started meanwhile");
    });

    it("adds many in order and counts the books it skips", async () => {
      const [a, b, c, d] = [await book("A"), await book("B"), await book("C"), await book("D")];
      await addToQueue({ workId: b });
      await startReading({ workId: c });
      expect(await addManyToQueue({ workIds: [d, a, b, c] })).toEqual({ added: 2, alreadyQueued: 1, beingRead: 1 });
      expect(await order()).toEqual(["B", "D", "A"]);
    });
  });

  describe("moving", () => {
    it("moves between neighbours, to the top and to the bottom", async () => {
      const ids = [];
      for (const t of ["A", "B", "C", "D"]) ids.push(await book(t));
      for (const w of ids) await addToQueue({ workId: w });
      const [a, b, c, d] = ids;
      expect(await moveQueueItem({ workId: d, afterWorkId: a, beforeWorkId: b })).toMatchObject({ place: 2, total: 4 });
      expect(await order()).toEqual(["A", "D", "B", "C"]);
      await moveQueueItem({ workId: c, beforeWorkId: a });
      expect(await order()).toEqual(["C", "A", "D", "B"]);
      await moveQueueItem({ workId: c, afterWorkId: b });
      expect(await order()).toEqual(["A", "D", "B", "C"]);
    });

    it("renumbers every position in steps of 1024 when no gap is left", async () => {
      const ids = [];
      for (const t of ["A", "B", "C"]) ids.push(await book(t));
      for (const w of ids) await addToQueue({ workId: w });
      await q(`update reading_queue set position = case work_id when $1::uuid then 10 when $2::uuid then 11 else 12 end`, ids.slice(0, 2));
      await moveQueueItem({ workId: ids[2], afterWorkId: ids[0], beforeWorkId: ids[1] });
      expect(await order()).toEqual(["A", "C", "B"]);
      expect(await positions()).toEqual([1024, 2048, 3072]);
    });
  });

  describe("starting a book takes it off Up Next", () => {
    it("through startReading", async () => {
      const a = await book("Nadja");
      await addToQueue({ workId: a });
      const started = await startReading({ workId: a });
      expect(started.unqueued).toBe(true);
      expect(await order()).toEqual([]);
      const b = await book("Watt");
      expect((await startReading({ workId: b })).unqueued).toBe(false);
    });

    it("through writeReadings with an open row; a finished past read leaves it", async () => {
      const [a, b] = [await book("Open"), await book("Past")];
      await addToQueue({ workId: a });
      await addToQueue({ workId: b });
      const out = await writeReadings(
        [
          { workId: a, status: "reading", format: "print", startedOn: "2026-10-01", startedPrecision: "day", finishedPrecision: "unknown" },
          { workId: b, status: "finished", format: "print", startedPrecision: "unknown", finishedOn: "2019-01-01", finishedPrecision: "year" },
        ] as never,
        { source: "manual" },
      );
      expect(out.map((o) => [o.outcome, o.unqueued ?? false])).toEqual([
        ["written", true],
        ["written", false],
      ]);
      expect(await order()).toEqual(["Past"]);
    });
  });

  describe("merges", () => {
    async function merge(source: string, target: string) {
      // The merge's fingerprint covers the history entries, so the preview waits for addToQueue's (SLN-521)
      await activitySettled();
      const p = await previewMerge("works", source, target);
      expect(p.blockers).toEqual([]);
      await executeMerge({
        entity: "works",
        sourceId: source,
        targetId: target,
        fingerprint: p.fingerprint,
        choices: Object.fromEntries(p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
      });
    }

    it("keeps the earlier of two queued books, with its note and edition", async () => {
      for (const sourceEarlier of [true, false]) {
        await q(`truncate works cascade`);
        const [s, t, x] = [await book("Source"), await book("Target"), await book("Other")];
        const se = await edition(s);
        await addToQueue({ workId: sourceEarlier ? s : t, ...(sourceEarlier ? { editionId: se, note: "source note" } : { note: "target note" }) });
        await addToQueue({ workId: x });
        await addToQueue({ workId: sourceEarlier ? t : s, ...(sourceEarlier ? { note: "target note" } : { editionId: se, note: "source note" }) });
        await merge(s, t);
        const rows = await q(`select work_id, note, edition_id from reading_queue order by position`);
        expect(rows.map((r) => r.work_id)).toEqual(sourceEarlier ? [t, x] : [t, x]);
        expect(rows[0].note).toBe(sourceEarlier ? "source note" : "target note");
        // The kept edition moved with the merge, so the guard passed
        if (sourceEarlier) expect(rows[0].edition_id).toBe(se);
      }
    });

    it("moves the merged book's row when only it is queued", async () => {
      const [s, t] = [await book("Source"), await book("Target")];
      await addToQueue({ workId: s });
      await merge(s, t);
      expect(await q(`select work_id from reading_queue`)).toEqual([{ work_id: t }]);
    });
  });

  describe("the edition guard", () => {
    it("refuses an edition of another book, by the action and by the trigger", async () => {
      const [a, b] = [await book("A"), await book("B")];
      const eb = await edition(b);
      await expect(addToQueue({ workId: a, editionId: eb })).rejects.toThrow("This edition belongs to another book");
      await addToQueue({ workId: a });
      await expect(q(`update reading_queue set edition_id = $1 where work_id = $2`, [eb, a])).rejects.toMatchObject({ code: "23514", constraint_name: "reading_queue_edition_work" });
      await expect(updateQueueItem({ workId: a, editionId: eb })).rejects.toThrow("This edition belongs to another book");
    });

    it("clears a deleted or moved edition, renumbers afterwards, carries a placeholder's, and goes with its book", async () => {
      const [a, b, other] = [await book("A"), await book("B"), await book("Other")];
      const ea = await edition(a);
      const eb = await edition(b);
      await addToQueue({ workId: a, editionId: ea });
      await addToQueue({ workId: b, editionId: eb });
      await deleteEdition(ea);
      expect(await value(`select edition_id from reading_queue where work_id = $1`, [a])).toBeNull();
      await updateEdition(eb, { workId: other });
      expect(await value(`select edition_id from reading_queue where work_id = $1`, [b])).toBeNull();
      // No gap left: the move renumbers every row, the one whose edition was cleared too
      const c = await book("C");
      await addToQueue({ workId: c });
      await q(`update reading_queue set position = case work_id when $1::uuid then 1 when $2::uuid then 2 else 3 end`, [a, b]);
      await moveQueueItem({ workId: c, afterWorkId: a, beforeWorkId: b });
      expect(await positions()).toEqual([1024, 2048, 3072]);
      // A placeholder edition replaced by the real one
      const p = await book("Placeholder");
      const placeholderId = await value(`insert into editions(work_id, title, language, metadata_source) values ($1, 'P', 'en', 'phantom_canon') returning id`, [p]);
      const real = await value(`insert into editions(work_id, title, language, isbn_13, page_count) values ($1, 'R', 'en', '9780000000002', 300) returning id`, [p]);
      await addToQueue({ workId: p, editionId: placeholderId });
      await moveToExistingEdition(placeholderId, real);
      expect(await value(`select edition_id from reading_queue where work_id = $1`, [p])).toBe(real);
      await q(`delete from works where id = $1`, [p]);
      expect(await value(`select count(*)::int from reading_queue where work_id = $1`, [p])).toBe(0);
    });
  });

  describe("getQueue", () => {
    it("says where each copy is, what is at hand and what is not owned, in one list", async () => {
      const ams = await place("Amsterdam");
      const kindle = await place("Kindle", "digital");
      const [lent, digital, gone] = [await book("Lent"), await book("Digital"), await book("Gone")];
      await copy(await edition(lent), ams, "lent_out", { lentTo: "M.", lentDate: "2026-05-03" });
      await copy(await edition(digital), kindle);
      await copy(await edition(gone), ams, "deaccessioned");
      for (const w of [lent, digital, gone]) await addToQueue({ workId: w });
      const items = await getQueue({ homeId: ams });
      expect(items.map((i) => i.title)).toEqual(["Lent", "Digital", "Gone"]);
      const [l, d, g] = items;
      expect(queueWhereabouts(l.editions, l.atHandCopyId, "2026-10-05")).toBe("Lent to M. since 3 May");
      expect(queueAtHand(l.editions, ams)).toBe(false);
      expect(queueWhereabouts(d.editions, d.atHandCopyId, "2026-10-05")).toBe("Digital");
      expect(queueAtHand(d.editions, null)).toBe(true);
      expect(g.owned).toBe(false);
      expect(queueWhereabouts(g.editions, g.atHandCopyId, "2026-10-05")).toBe("Not owned");
      expect(l.owned).toBe(true);
    });

    it("gives each edition its last known audio length and the book's reading history", async () => {
      const w = await book("Audio");
      const e = await edition(w, null);
      await q(`insert into readings(work_id, edition_id, status, format, unit, total_minutes, started_precision, finished_on, finished_precision) values ($1, $2, 'finished', 'audio', 'minutes', 540, 'unknown', '2012-05-01', 'day')`, [w, e]);
      await addToQueue({ workId: w });
      const [item] = await getQueue();
      expect(item.editions[0].audioMinutes).toBe(540);
      expect(item.readCount).toBe(1);
      expect(item.lastFinishedOn).toBe("2012-05-01");
    });
  });

  describe("the library", () => {
    it("filters to the books in Up Next and sorts by its order, on the page and in GET /api/works", async () => {
      const [a, b, c, d] = [await book("Alpha"), await book("Beta"), await book("Gamma"), await book("Delta")];
      await addToQueue({ workId: c });
      await addToQueue({ workId: a });
      await q(`insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, 'finished', 'unknown', '2020-01-01', 'year')`, [d]);
      const titles = async (query: string) => {
        const { filters, sort } = parseReadingFilters(new URLSearchParams(query), { sorts: LIBRARY_SORTS });
        return (await getWorks({ filters, sort: sort as never, limit: 50 })).map((w) => w.title);
      };
      expect(await titles("reading=queued&sort=queue")).toEqual(["Gamma", "Alpha"]);
      // Combined with a reading state it matches any one of them
      expect(await titles("reading=queued,read&sort=queue")).toEqual(["Gamma", "Alpha", "Delta"]);
      // Books not queued come last, ties on the id
      const all = await titles("sort=queue");
      expect(all.slice(0, 2)).toEqual(["Gamma", "Alpha"]);
      expect(all.slice(2).sort()).toEqual(["Beta", "Delta"]);
      expect(await getWorkCount(undefined, parseReadingFilters(new URLSearchParams("reading=queued"), { sorts: LIBRARY_SORTS }).filters)).toBe(2);
      const res = await listWorks(new NextRequest("http://localhost/api/works?reading=queued&sort=queue"));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.works.map((w: { title: string }) => w.title)).toEqual(["Gamma", "Alpha"]);
      expect(body.total).toBe(2);
      for (const bad of ["reading=queue", "sort=upnext"]) expect((await listWorks(new NextRequest(`http://localhost/api/works?${bad}`))).status).toBe(400);
      void b;
    });
  });

  describe("to-read shelves", () => {
    async function author(workId: string, name: string) {
      const authorId = (await value(`select id from authors where name = $1`, [name])) ?? (await value(`insert into authors(name, slug) values ($1, $2) returning id`, [name, `${name.toLowerCase().replace(/\W+/g, "-")}-${++serial}`]));
      await q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [workId, authorId]);
    }
    function goodreads(rows: Record<string, string>[]) {
      const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
      return [GOODREADS_EXPORT_HEADER.join(","), ...rows.map((r) => GOODREADS_EXPORT_HEADER.map((h) => cell(r[h] ?? "")).join(","))].join("\n");
    }
    const STORYGRAPH = ["Title", "Authors", "ISBN/UID", "Format", "Read Status", "Date Added", "Dates Read", "Read Count", "Star Rating", "Review"];
    const storygraph = (rows: Record<string, string>[]) => [STORYGRAPH.join(","), ...rows.map((r) => STORYGRAPH.map((h) => r[h] ?? "").join(","))].join("\n");
    const queueRows = () => q(`select w.title, q.source, q.source_key, q.import_id from reading_queue q join works w on w.id = q.work_id order by q.position`);
    const rowsOf = async (importId: string) =>
      (await q(`select row_no, match, decision, written from reading_import_rows where import_id = $1 order by row_no`, [importId])) as unknown as {
        row_no: number;
        match: { section: string; note: string | null };
        decision: string;
        written: { queueOutcome?: string; queueReason?: string | null; queueItem?: { id: string } | null } | null;
      }[];

    async function shelf() {
      const byId = await book("Watt");
      await author(byId, "Samuel Beckett");
      await q(`insert into editions(work_id, title, language, goodreads_id) values ($1, 'Watt', 'en', '1111')`, [byId]);
      const byIsbn = await book("Nadja");
      await author(byIsbn, "André Breton");
      await q(`insert into editions(work_id, title, language, isbn_13) values ($1, 'Nadja', 'fr', '9782070360260')`, [byIsbn]);
      const byTitle = await book("La Curée");
      await author(byTitle, "Émile Zola");
      const read = await book("Moby-Dick");
      await author(read, "Herman Melville");
      return goodreads([
        { "Book Id": "1111", Title: "Watt", Author: "Samuel Beckett", "Exclusive Shelf": "to-read", "Date Added": "2024/03/01" },
        { Title: "Nadja", Author: "André Breton", ISBN13: '="9782070360260"', "Exclusive Shelf": "to-read", "Date Added": "2023/01/01" },
        { Title: "La Curée", Author: "Émile Zola", "Exclusive Shelf": "to-read" },
        { Title: "Moby-Dick", Author: "Herman Melville", "Exclusive Shelf": "read", "Date Read": "2019/05/01", "Read Count": "1", "My Rating": "4" },
        { Title: "Not in Durtal", Author: "Nobody", "Exclusive Shelf": "to-read", "Date Added": "2020/01/01" },
      ]);
    }

    it("adds Goodreads to-read rows, with and without a Book Id, oldest added first, and never twice", async () => {
      const file = await shelf();
      const { importId } = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      const rows = await rowsOf(importId);
      expect(rows.map((r) => [r.match.section, r.decision])).toEqual([
        ["to_read", "import"],
        ["to_read", "import"],
        ["to_read", "import"],
        ["likely", "pending"],
        ["none", "pending"],
      ]);
      const preview = (await getImportPreview(importId))!;
      expect(preview.summary).toMatchObject({ toQueue: 3, toImport: 0 });
      const result = await commitImport(importId);
      expect(result).toMatchObject({ queued: 3, queuePresent: 0, queueSkipped: 0 });
      expect((await queueRows()).map((r) => [r.title, r.source, r.import_id === importId])).toEqual([
        ["Nadja", "import", true],
        ["Watt", "import", true],
        ["La Curée", "import", true],
      ]);
      expect((await queueRows()).map((r) => String(r.source_key).split(":").slice(0, 2).join(":"))).toEqual([
        "goodreads-to-read:isbn13",
        "goodreads-to-read:1111",
        "goodreads-to-read:title",
      ]);
      expect((await rowsOf(importId)).filter((r) => r.written?.queueItem).length).toBe(3);
      // The same import committed again, and the same file uploaded again, write nothing
      expect(await commitImport(importId)).toMatchObject({ queued: 0 });
      const again = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      const second = await rowsOf(again.importId);
      expect(second.slice(0, 3).map((r) => [r.match.note, r.decision])).toEqual([
        ["Already in Up Next, at 2", "skip"],
        ["Already in Up Next, at 1", "skip"],
        ["Already in Up Next, at 3", "skip"],
      ]);
      for (const r of second.slice(0, 3)) await decideRow({ importId: again.importId, rowNo: r.row_no, decision: "import" });
      expect(await commitImport(again.importId)).toMatchObject({ queued: 0, queuePresent: 3 });
      expect(await queueRows()).toHaveLength(3);
    });

    it("skips a book queued by hand or started after the upload", async () => {
      const file = await shelf();
      const { importId } = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      const [watt] = (await q(`select id from works where title = 'Watt'`)).map((r) => r.id as string);
      const [nadja] = (await q(`select id from works where title = 'Nadja'`)).map((r) => r.id as string);
      await addToQueue({ workId: watt });
      await startReading({ workId: nadja });
      expect(await commitImport(importId)).toMatchObject({ queued: 1, queueSkipped: 2 });
      const rows = await rowsOf(importId);
      expect(rows.slice(0, 2).map((r) => [r.written?.queueOutcome, r.written?.queueReason])).toEqual([
        ["skipped", "Queued by hand meanwhile"],
        ["skipped", "Started meanwhile"],
      ]);
    });

    it("adds StoryGraph to-read rows", async () => {
      const w = await book("The Waves");
      await author(w, "Virginia Woolf");
      const { importId } = await createReadingImport({
        text: storygraph([{ Title: "The Waves", Authors: "Virginia Woolf", "Read Status": "to-read", "Date Added": "2022/02/02" }]),
        fileName: "storygraph.csv",
      });
      expect((await rowsOf(importId))[0].match.section).toBe("to_read");
      await commitImport(importId);
      const [item] = await queueRows();
      expect(item.title).toBe("The Waves");
      expect(String(item.source_key)).toMatch(/^storygraph-to-read:/);
    });

    it("re-imports an earlier file for its to-read rows only, and undo keeps a moved item", async () => {
      const file = await shelf();
      // The earlier import wrote the readings and left the to-read rows out
      const first = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      for (const r of await rowsOf(first.importId))
        if (r.match.section === "to_read") await decideRow({ importId: first.importId, rowNo: r.row_no, decision: "skip" });
        else if (r.match.section === "likely") await decideRow({ importId: first.importId, rowNo: r.row_no, decision: "import" });
      expect(await commitImport(first.importId)).toMatchObject({ written: 1, queued: 0 });
      const again = await createReadingImport({ text: file, fileName: "goodreads.csv" });
      const rows = await rowsOf(again.importId);
      expect(rows.map((r) => r.match.section)).toEqual(["to_read", "to_read", "to_read", "present", "none"]);
      const preview = (await getImportPreview(again.importId))!;
      expect(preview.summary).toMatchObject({ toImport: 0, toQueue: 3 });
      expect(await commitImport(again.importId)).toMatchObject({ written: 0, queued: 3 });
      // One item moved after the import stays; the others go
      const [nadja] = (await q(`select work_id from reading_queue order by position limit 1`)).map((r) => r.work_id as string);
      const others = (await q(`select work_id from reading_queue order by position`)).map((r) => r.work_id as string);
      await moveQueueItem({ workId: nadja, afterWorkId: others[2] });
      expect(await undoImport(again.importId)).toMatchObject({ queueRemoved: 2, queueKept: 1 });
      expect((await queueRows()).map((r) => r.title)).toEqual(["Nadja"]);
    });
  });
});
