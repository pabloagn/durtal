import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_PERSONAL_SIGNALS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln463_personal_signals")
    throw new Error("Personal signals tests require a disposable local sln463_personal_signals database");
}
const client = url ? postgres(url, { max: 4, onnotice: () => {} }) : null;
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
const activity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/activity/record", () => ({ recordActivity: activity }));
// A chunk made to fail: the nth atomic call throws before it writes
const failing = vi.hoisted(() => ({ on: 0, calls: 0 }));
vi.mock("@/lib/db/atomic", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/db/atomic")>();
  return {
    ...real,
    atomic: (build: Parameters<typeof real.atomic>[0]) => {
      if (failing.on && ++failing.calls === failing.on) return Promise.reject(new Error("The chunk failed"));
      return real.atomic(build);
    },
  };
});
import { markWorksRead, undoMarkWorksRead } from "@/lib/actions/reading-bulk";
import { abandonReading, addPastReading, finishReading, startReading } from "@/lib/actions/reading";
import { loadReading } from "@/lib/reading/service";
import { feedbackExclusionCondition, feedbackPausedAuthorCondition } from "@/lib/enrichment/feedback";
import { loadBooks } from "@/lib/reading/suggest/load";
import { hiddenByFeedback, pausedAuthors } from "@/lib/reading/suggest/score";
import type { SuggestBook, SuggestContext } from "@/lib/reading/suggest/types";
import { GET as listWorks } from "@/app/api/works/route";

// Read status and personal signals (SLN-463): bulk Mark as read and its
// undo, the owned and unread route, and the feedback helpers against the
// suggestion engine's own rules, with PostgreSQL.

describe.skipIf(!url)("read status and personal signals with PostgreSQL", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) => client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) => Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });

  let serial = 0;
  let home = "";
  beforeEach(async () => {
    await q(`truncate works, authors, locations cascade`);
    home = await value(`insert into locations(name, type) values ('Amsterdam', 'physical') returning id`);
    activity.mockClear();
    failing.on = 0;
    failing.calls = 0;
  });
  const book = (title: string) => value(`insert into works(title, slug) values ($1, $2) returning id`, [title, `book-${++serial}`]);
  const copy = async (workId: string, { status = "available", format = "paperback" } = {}) => {
    const e = await value(`insert into editions(work_id, title, language) values ($1, 'E', 'en') returning id`, [workId]);
    await q(`insert into instances(edition_id, location_id, status, format) values ($1, $2, $3, $4)`, [e, home, status, format]);
  };
  const read = (workId: string, { status = "finished", finished = null as string | null } = {}) =>
    value(
      `insert into readings(work_id, status, started_precision, finished_on, finished_precision) values ($1, $2, 'unknown', $3, $4) returning id`,
      [workId, status, finished, finished ? "day" : "unknown"],
    );
  const readingsOf = (workId: string) =>
    q(`select status, source, source_key, format, started_on, finished_on, started_precision, finished_precision from readings where work_id = $1`, [workId]);
  const events = (key: string) => activity.mock.calls.filter((c) => c[2] === key).map((c) => c[1]);

  it("marks an unread book, lists a read one as a possible duplicate and reports one being read", async () => {
    const unread = await book("Unread");
    await copy(unread, { format: "epub" });
    const already = await book("Already read");
    await read(already, { finished: "2019-04-14" });
    const reading = await book("Being read");
    await read(reading, { status: "reading" });
    const result = await markWorksRead({ workIds: [unread, already, reading] });
    expect(result.marked).toBe(1);
    expect(result.possibleDuplicates).toEqual([
      { workId: already, title: "Already read", match: expect.objectContaining({ status: "finished", finishedOn: "2019-04-14", finishedPrecision: "day" }) },
    ]);
    expect(result.skipped).toEqual([{ workId: reading, title: "Being read", reason: "being read: finish it on the book page" }]);
    // Manual, no key, finished, both dates unknown; the format of its only copy
    expect(await readingsOf(unread)).toEqual([
      { status: "finished", source: "manual", source_key: null, format: "ebook", started_on: null, finished_on: null, started_precision: "unknown", finished_precision: "unknown" },
    ]);
    expect(await readingsOf(already)).toHaveLength(1);
    expect(await readingsOf(reading)).toHaveLength(1);
    expect(events("work.reading_finished")).toEqual([unread]);
  });

  it("writes a possible duplicate only when he confirms that book, and marking again writes nothing", async () => {
    const a = await book("A");
    const b = await book("B");
    const first = await markWorksRead({ workIds: [a, b] });
    expect(first.marked).toBe(2);
    const again = await markWorksRead({ workIds: [a, b] });
    expect(again.marked).toBe(0);
    expect(again.possibleDuplicates.map((d) => d.workId).sort()).toEqual([a, b].sort());
    const confirmed = await markWorksRead({ workIds: [a, b], confirmDuplicates: [a] });
    expect(confirmed.marked).toBe(1);
    expect(confirmed.possibleDuplicates.map((d) => d.workId)).toEqual([b]);
    expect(await readingsOf(a)).toHaveLength(2);
    expect(await readingsOf(b)).toHaveLength(1);
  });

  it("leaves no partial chunk when the second one fails, and the same selection again writes the rest", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 150; i++) ids.push(await book(`Book ${String(i).padStart(3, "0")}`));
    failing.on = 2;
    await expect(markWorksRead({ workIds: ids })).rejects.toThrow("Marked 100 before an error");
    expect(Number(await value(`select count(*) from readings`))).toBe(100);
    expect(events("work.reading_finished")).toHaveLength(100);
    failing.on = 0;
    const rest = await markWorksRead({ workIds: ids });
    expect(rest.marked).toBe(50);
    expect(rest.possibleDuplicates).toHaveLength(100);
    expect(Number(await value(`select count(*) from readings`))).toBe(150);
    expect(Number(await value(`select count(distinct work_id) from readings`))).toBe(150);
  });

  it("undoes only the readings one call wrote, and keeps one changed since or with a session", async () => {
    const [kept, logged, untouched, onPage] = [await book("Edited"), await book("With a session"), await book("Untouched"), await book("Logged on its page")];
    const page = await addPastReading({ workId: onPage, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2020-05-01", finishedPrecision: "day" });
    const marked = await markWorksRead({ workIds: [kept, logged, untouched] });
    expect(marked.marked).toBe(3);
    const idOf = async (workId: string) => value(`select id from readings where work_id = $1`, [workId]);
    await q(`update readings set updated_at = updated_at + interval '1 second' where id = $1`, [await idOf(kept)]);
    await q(`insert into reading_sessions(reading_id, format, read_on, time_zone, end_page) values ($1, 'print', '2026-10-01', 'Europe/Amsterdam', 10)`, [await idOf(logged)]);
    const undone = await undoMarkWorksRead({ readingIds: marked.readingIds });
    expect(undone.removed).toBe(1);
    expect(undone.kept.map((k) => [k.title, k.reason]).sort()).toEqual([
      ["Edited", "it changed since it was marked"],
      ["With a session", "a session was logged since"],
    ]);
    expect(await readingsOf(untouched)).toHaveLength(0);
    expect(await readingsOf(kept)).toHaveLength(1);
    expect(await readingsOf(logged)).toHaveLength(1);
    expect(page.outcome).toBe("written");
    expect(await readingsOf(onPage)).toHaveLength(1);
    expect(events("work.reading_deleted")).toEqual([untouched]);
    // Run again: nothing more goes
    expect((await undoMarkWorksRead({ readingIds: marked.readingIds })).removed).toBe(0);
  });

  it("finishes, abandons and logs a past read of a book with no copy and of one with several (SLN-447's check)", async () => {
    const none = await book("No copy");
    const several = await book("Several copies");
    await copy(several);
    await copy(several, { format: "epub" });
    for (const workId of [none, several]) {
      const started = await startReading({ workId });
      const finished = await finishReading({ readingId: started.id, fingerprint: (await loadReading(started.id))!.fingerprint });
      expect(finished.reading.status).toBe("finished");
      const again = await startReading({ workId });
      const abandoned = await abandonReading({ readingId: again.id, fingerprint: (await loadReading(again.id))!.fingerprint, reason: "lost_interest" });
      expect(abandoned.reading.status).toBe("abandoned");
      const past = await addPastReading({ workId, format: "print", status: "finished", startedPrecision: "unknown", finishedOn: "2015-06-01", finishedPrecision: "month" });
      expect(past.outcome).toBe("written");
    }
  });

  it("answers GET /api/works?reading=unread&holding=owned with the owned unread books only", async () => {
    const owned = await book("Owned unread");
    await copy(owned);
    const readOwned = await book("Owned and read");
    await copy(readOwned);
    await read(readOwned);
    await book("Unread, no copy");
    const gone = await book("Unread, copy deaccessioned");
    await copy(gone, { status: "deaccessioned" });
    const res = await listWorks(new NextRequest("http://localhost/api/works?reading=unread&holding=owned"));
    const body = await res.json();
    expect(body.works.map((w: { title: string }) => w.title)).toEqual(["Owned unread"]);
    expect(body.total).toBe(1);
  });

  describe("the feedback helpers hide exactly what the suggestion engine hides", () => {
    const TODAY = "2026-10-07";
    const feedback = (workId: string, verdict: string, { until = null as string | null, updated = "2026-10-01T12:00:00Z" } = {}) =>
      q(`insert into recommendation_feedback(work_id, verdict, until, updated_at, created_at) values ($1, $2, $3, $4, $4)`, [workId, verdict, until, updated]);
    const writer = async (name: string) => value(`insert into authors(name, slug) values ($1, $2) returning id`, [name, `author-${++serial}`]);
    const by = (workId: string, authorId: string) => q(`insert into work_authors(work_id, author_id, role) values ($1, $2, 'author')`, [workId, authorId]);
    /** The engine's own books, as its loader reads them */
    const engineBooks = async () => (await loadBooks((query) => db.execute(query), null)) as unknown as SuggestBook[];
    const matching = async (condition: ReturnType<typeof sql>) =>
      (await db.execute<{ id: string }>(sql`select w.id::text as id from works w where ${condition}`)).map((r) => r.id).sort();

    it("feedbackExclusionCondition: Never, rejected and a current or open Not now; not an expired one or a removed row", async () => {
      const ids = {
        never: await book("Never"),
        rejected: await book("Rejected"),
        current: await book("Not now, current"),
        open: await book("Not now, no day"),
        expired: await book("Not now, expired"),
        removed: await book("Row removed"),
        none: await book("No feedback"),
      };
      await feedback(ids.never, "never");
      await feedback(ids.rejected, "rejected");
      await feedback(ids.current, "not_now", { until: "2026-11-01" });
      await feedback(ids.open, "not_now");
      await feedback(ids.expired, "not_now", { until: "2026-10-07" });
      await feedback(ids.removed, "never");
      await q(`delete from recommendation_feedback where work_id = $1`, [ids.removed]);
      const hidden = await matching(feedbackExclusionCondition(sql`w.id`, TODAY));
      expect(hidden).toEqual([ids.never, ids.rejected, ids.current, ids.open].sort());
      const engine = (await engineBooks()).filter((b) => hiddenByFeedback(b, TODAY)).map((b) => b.id).sort();
      expect(hidden).toEqual(engine);
    });

    it("feedbackPausedAuthorCondition: two Not for me books within 30 days pause their writer for 30 days", async () => {
      const recent = await writer("Two recent");
      const apart = await writer("Forty days apart");
      const old = await writer("Paused long ago");
      const once = await writer("Rejected once");
      const rejected = async (authorId: string, updated: string) => {
        const id = await book(`Rejected ${++serial}`);
        await by(id, authorId);
        await feedback(id, "rejected", { updated });
      };
      await rejected(recent, "2026-09-20T10:00:00Z");
      await rejected(recent, "2026-09-30T10:00:00Z");
      await rejected(apart, "2026-08-01T10:00:00Z");
      await rejected(apart, "2026-09-10T10:00:00Z");
      await rejected(old, "2026-06-01T10:00:00Z");
      await rejected(old, "2026-06-10T10:00:00Z");
      await rejected(once, "2026-10-01T10:00:00Z");
      const candidates: Record<string, string> = {};
      for (const [name, authorId] of Object.entries({ recent, apart, old, once })) {
        candidates[name] = await book(`Next by ${name}`);
        await by(candidates[name], authorId);
      }
      const paused = await matching(feedbackPausedAuthorCondition(sql`w.id`, TODAY));
      const books = await engineBooks();
      const engineAuthors = pausedAuthors({ books, today: TODAY } as unknown as SuggestContext);
      const engine = books.filter((b) => b.authors.some((a) => engineAuthors.has(a.id))).map((b) => b.id).sort();
      expect(paused).toEqual(engine);
      expect([...engineAuthors.keys()]).toEqual([recent]);
      expect(paused).toContain(candidates.recent);
      expect(paused).not.toContain(candidates.apart);
    });
  });
});
