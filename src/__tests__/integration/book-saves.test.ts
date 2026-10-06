import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_BOOK_SAVES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln365_test"
  )
    throw new Error("Book save tests require disposable local sln365_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
const activity = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local test database required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
vi.mock("@/lib/activity/record", () => ({ recordActivity: activity }));

import { createWork, updateWork } from "@/lib/actions/works";
import { getWorkCuration } from "@/lib/actions/curation";

const MISSING = "00000000-0000-4000-8000-000000000000";

describe.skipIf(!url)("book saves through the shared adapters", () => {
  const c = client!;
  let mann: string;
  let hesse: string;
  let subject: string;
  let friend: string;
  let critic: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    activity.mockClear();
    await c`truncate works, authors, subjects, recommenders, activity_events cascade`;
    [mann, hesse] = (
      await c`insert into authors(name,slug) values ('Thomas Mann','thomas-mann'),('Hermann Hesse','hermann-hesse') returning id`
    ).map((row) => row.id);
    [subject] = (
      await c`insert into subjects(name,slug) values ('Illness','illness') returning id`
    ).map((row) => row.id);
    [friend, critic] = (
      await c`insert into recommenders(name) values ('A friend'),('A critic') returning id`
    ).map((row) => row.id);
  });

  const rows = async (workId: string) => ({
    authors: (
      await c`select author_id from work_authors where work_id=${workId} order by sort_order`
    ).map((row) => row.author_id),
    subjects: (
      await c`select subject_id from work_subjects where work_id=${workId}`
    ).map((row) => row.subject_id),
    recommenders: (
      await c`select recommender_id from work_recommenders where work_id=${workId} order by recommender_id`
    ).map((row) => row.recommender_id),
  });

  it("creates a book with its slug, authors, subjects and recommendations", async () => {
    const work = await createWork({
      title: "The Magic Mountain",
      originalLanguage: "de",
      rating: 5,
      authorIds: [{ authorId: mann }],
      subjectIds: [subject],
      // A repeated recommender is stored once
      recommenderIds: [friend, friend],
    });
    expect(work).toMatchObject({
      kind: "book",
      title: "The Magic Mountain",
      slug: "the-magic-mountain-by-thomas-mann",
      rating: 5,
    });
    expect(await rows(work.id)).toEqual({
      authors: [mann],
      subjects: [subject],
      recommenders: [friend],
    });
    // The activity row is part of the same transaction
    expect(
      await c`select event_key, metadata from activity_events where entity_id=${work.id}`,
    ).toEqual([
      { event_key: "work.created", metadata: { newValue: "The Magic Mountain" } },
    ]);
    // Its identity job, after the save (SLN-464): a tracked book comes last
    expect(await c`select kind, priority, payload->>'reason' as reason from enrichment_jobs where work_id=${work.id}`).toEqual([
      { kind: "identity", priority: 100, reason: "created" },
    ]);
  });

  it("numbers the slug of a second book with the same title and author", async () => {
    const input = { title: "Doctor Faustus", authorIds: [{ authorId: mann }] };
    await createWork(input);
    expect((await createWork(input)).slug).toBe("doctor-faustus-by-thomas-mann-2");
  });

  it("creates nothing when a later part of the book fails", async () => {
    await expect(
      createWork({
        title: "Half a Book",
        authorIds: [{ authorId: mann }],
        recommenderIds: [MISSING],
      }),
    ).rejects.toThrow();
    expect(await c`select id from works`).toHaveLength(0);
    expect(await c`select work_id from work_authors`).toHaveLength(0);
    expect(await c`select id from activity_events`).toHaveLength(0);
  });

  it("saves an edit whole or not at all", async () => {
    const work = await createWork({
      title: "Demian",
      rating: 3,
      authorIds: [{ authorId: hesse }],
      subjectIds: [subject],
      recommenderIds: [friend],
    });
    await expect(
      updateWork(work.id, {
        title: "Steppenwolf",
        rating: 5,
        authorIds: [{ authorId: mann }],
        subjectIds: [],
        recommenderIds: [critic, MISSING],
      }),
    ).rejects.toThrow();
    const [stored] = await c`select title, rating::float8 as rating, slug from works where id=${work.id}`;
    expect(stored).toEqual({ title: "Demian", rating: 3, slug: "demian-by-hermann-hesse" });
    expect(await rows(work.id)).toEqual({
      authors: [hesse],
      subjects: [subject],
      recommenders: [friend],
    });
  });

  it("replaces recommendations once when the form repeats one, and records the rating", async () => {
    const work = await createWork({
      title: "Siddhartha",
      rating: 3,
      authorIds: [{ authorId: hesse }],
      recommenderIds: [friend],
    });
    activity.mockClear();
    await updateWork(work.id, { rating: 5, recommenderIds: [critic, critic] });
    expect((await rows(work.id)).recommenders).toEqual([critic]);
    expect(activity).toHaveBeenCalledWith("work", work.id, "work.rating_changed", {
      oldValue: 3,
      newValue: 5,
    });
    // The shared curation read sees the book form's edit
    expect(await getWorkCuration({ id: work.id, kind: "book" })).toMatchObject({
      rating: 5,
      recommenderIds: [critic],
    });
  });

  it("keeps the other fields of a sparse edit, and the series it names", async () => {
    const work = await createWork({
      title: "Narcissus and Goldmund",
      rating: 4,
      notes: "Reread",
      authorIds: [{ authorId: hesse }],
      recommenderIds: [friend],
    });
    const result = await updateWork(work.id, {
      seriesName: "Hesse novels",
      seriesPosition: "1",
    });
    expect(result).toEqual({ id: work.id });
    const [stored] =
      await c`select w.rating::float8 as rating, w.notes, s.title as series from works w join series s on s.id = w.series_id where w.id=${work.id}`;
    expect(stored).toEqual({ rating: 4, notes: "Reread", series: "Hesse novels" });
    expect((await rows(work.id)).recommenders).toEqual([friend]);
  });
});
