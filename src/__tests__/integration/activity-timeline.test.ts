import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";
const url = process.env.DURTAL_ACTIVITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln297_test"
  )
    throw new Error("Activity tests require disposable local sln297_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
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
vi.mock("@/lib/s3/cleanup", () => ({
  authorObjects: vi.fn(async () => ({ keys: [], prefixes: [] })),
  deleteUnusedObjects: vi.fn(async () => false),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getActivityTimeline } from "@/lib/actions/activity";
import { updateWorkTaxonomy } from "@/lib/actions/taxonomy";
import { createTaxonomyItem } from "@/lib/actions/taxonomy-families";
import { getPersonMergePreview, mergePeople } from "@/lib/actions/people";
import { formatEventDescription } from "@/lib/activity/event-config";
import { getMergePreview, mergeRecords } from "@/lib/actions/harmonization";

describe.skipIf(!url)("activity timeline accuracy", () => {
  const c = client!;
  let workId: string;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works,authors,themes,activity_events cascade`;
    const [work] =
      await c`insert into works(title,slug,kind,original_language) values ('Book','book','book','en') returning id`;
    workId = work.id;
  });

  async function eventsOf(entityId: string, key: string) {
    return c`select metadata from activity_events where entity_id=${entityId} and event_key=${key} order by metadata->>'targetName'`;
  }

  it("pages events that share a timestamp without skipping or repeating any", async () => {
    // Seven events: five share one timestamp, so a page edge falls inside them.
    await c`insert into activity_events(entity_type,entity_id,event_key,created_at)
      select 'work',${workId},'work.title_changed',
        case when n <= 5 then timestamptz '2026-01-01 00:00:00.123456+00'
             else timestamptz '2026-01-01 00:00:00.123456+00' - n * interval '1 microsecond' end
      from generate_series(1,7) n`;
    const expected = (
      await c`select id from activity_events where entity_id=${workId} order by created_at desc, id desc`
    ).map((r) => r.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await getActivityTimeline("work", workId, 2, cursor);
      seen.push(...result.events.map((e) => e.id));
      if (!result.hasMore) break;
      expect(result.nextCursor).toBeTruthy();
      cursor = result.nextCursor!;
    }
    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(7);
  });

  it("records one taxonomy event per added or removed item, with its name", async () => {
    const dread = await createTaxonomyItem("themes", { name: "Dread" });
    const decay = await createTaxonomyItem("themes", { name: "Decay" });
    await updateWorkTaxonomy(workId, { themeIds: [dread.id, decay.id] });
    await vi.waitFor(async () =>
      expect(await eventsOf(workId, "work.taxonomy_added")).toHaveLength(2),
    );
    expect(
      (await eventsOf(workId, "work.taxonomy_added")).map((r) => r.metadata),
    ).toEqual([
      { taxonomyType: "theme", targetId: decay.id, targetName: "Decay" },
      { taxonomyType: "theme", targetId: dread.id, targetName: "Dread" },
    ]);

    await updateWorkTaxonomy(workId, { themeIds: [decay.id] });
    await vi.waitFor(async () =>
      expect(await eventsOf(workId, "work.taxonomy_removed")).toHaveLength(1),
    );
    const [removed] = await eventsOf(workId, "work.taxonomy_removed");
    expect(formatEventDescription("work.taxonomy_removed", removed.metadata)).toBe(
      "Removed theme Dread",
    );

    // A save that changes nothing records nothing.
    await updateWorkTaxonomy(workId, { themeIds: [decay.id] });
    await new Promise((r) => setTimeout(r, 200));
    expect(
      await c`select 1 from activity_events where entity_id=${workId}`,
    ).toHaveLength(3);
  });

  async function twoAuthors() {
    const [source, target] =
      await c`insert into authors(name,slug) values ('H. P. Lovecraft','h-p-lovecraft'),('Howard Phillips Lovecraft','howard-phillips-lovecraft') returning id`;
    // An older event on the source moves to the target with the merge.
    await c`insert into activity_events(entity_type,entity_id,event_key) values ('author',${source.id},'author.created')`;
    return { source, target };
  }
  const targetChoices = (fields: { key: string; conflict: boolean }[]) =>
    Object.fromEntries(
      fields.filter((f) => f.conflict).map((f) => [f.key, "target"]),
    );
  async function expectOneMergeEvent(sourceId: string, targetId: string) {
    const merged = await eventsOf(targetId, "author.merged");
    expect(merged.map((r) => r.metadata)).toEqual([
      { targetId: sourceId, targetName: "H. P. Lovecraft" },
    ]);
    expect(
      await c`select event_key from activity_events where entity_id=${targetId} order by event_key`,
    ).toEqual([{ event_key: "author.created" }, { event_key: "author.merged" }]);
  }

  it("records one merge event on the author that remains, from the author page", async () => {
    const { source, target } = await twoAuthors();
    const preview = await getPersonMergePreview(source.id, target.id);
    await mergePeople({
      sourceId: source.id,
      targetId: target.id,
      fingerprint: preview.fingerprint,
      choices: targetChoices(preview.fields),
    });
    await expectOneMergeEvent(source.id, target.id);
  });

  it("records one merge event on the author that remains, from Harmonize", async () => {
    const { source, target } = await twoAuthors();
    const preview = await getMergePreview({
      entity: "authors",
      sourceId: source.id,
      targetId: target.id,
    });
    if (!preview.ok) throw new Error(preview.error);
    const result = await mergeRecords({
      entity: "authors",
      sourceId: source.id,
      targetId: target.id,
      fingerprint: preview.value.fingerprint,
      choices: targetChoices(preview.value.fields),
    });
    expect(result.ok).toBe(true);
    await expectOneMergeEvent(source.id, target.id);
  });
});
