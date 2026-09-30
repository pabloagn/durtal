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
import { z } from "zod";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_ART_WHEREABOUTS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln360_test")
    throw new Error("Whereabouts tests require disposable local sln360_test");
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
vi.mock("@/lib/s3/artwork-cleanup", () => ({
  cleanupWorkArtwork: vi.fn(async () => false),
  cleanupCollectionArtwork: vi.fn(async () => false),
}));
import {
  deleteWhereabouts,
  getWhereabouts,
  recordWhereabouts,
  updateWhereabouts,
  verifyWhereabouts,
} from "@/lib/actions/whereabouts";
import {
  createArtObject,
  createPainting,
  deleteArtObject,
  getPainting,
  getPaintings,
} from "@/lib/actions/paintings";
import { saveOrganization } from "@/lib/actions/organizations";
import { archiveVenue, createVenue, deleteVenue } from "@/lib/actions/venues";
import { previewMerge, executeMerge } from "@/lib/harmonization/merge";
import { STALE_RECORD } from "@/lib/catalogue/work-store";

/** The whole message a caller sees; never SQL. */
async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error("Expected the call to fail");
    },
    (e: unknown) => e,
  );
  return error instanceof z.ZodError
    ? error.issues.map((issue) => issue.message).join("\n")
    : (error as Error).message;
}
/** The database's own message behind an unwrapped legacy action. */
async function rootMessage(promise: Promise<unknown>) {
  let error = await promise.then(
    () => {
      throw new Error("Expected the call to fail");
    },
    (e: unknown) => e,
  );
  while ((error as { cause?: unknown }).cause) error = (error as { cause: unknown }).cause;
  return (error as Error).message;
}

describe.skipIf(!url)("sourced whereabouts of original paintings", () => {
  const c = client!;
  let objectId: string, workId: string, louvreOrg: string;
  let louvre: string, tokyo: string, moscow: string;
  const day = (year: number, month: number, d: number) => ({ precision: "day" as const, start: { year, month, day: d } });
  const month = (year: number, m: number) => ({ precision: "month" as const, start: { year, month: m } });
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  const history = async () => (await getWhereabouts(objectId))!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, locations, catalogue_dates, harmonization_operations, harmonization_redirects cascade`;
    louvreOrg = (await saveOrganization({ name: "Musée du Louvre", roles: ["museum"] }))!.id;
    louvre = (await createVenue({ name: "Louvre, Paris", type: "museum" })).id;
    tokyo = (await createVenue({ name: "Tokyo National Museum", type: "museum" })).id;
    moscow = (await createVenue({ name: "Pushkin Museum", type: "museum" })).id;
    const painting = await createPainting({ title: "Mona Lisa" });
    workId = painting.id;
    objectId = (
      await createArtObject({ workId, kind: "original", ownership: "institutional", ownerOrganizationId: louvreOrg, accessionNumber: "INV 779" })
    ).id;
  });
  const atLouvre = async (since = year(1797)) =>
    recordWhereabouts(
      { objectId, placeKind: "venue", venueId: louvre, custody: "permanent_collection", certainty: "confirmed", startsOn: since },
      (await history()).fingerprint,
    );

  it("keeps the owner apart from the place and never infers display", async () => {
    const recorded = await atLouvre();
    expect(recorded.current).toMatchObject({ venueId: louvre, venueName: "Louvre, Paris", custody: "permanent_collection", displayStatus: "unknown" });
    const [object] = (await getPainting(workId))!.objects;
    expect(object).toMatchObject({ ownerName: "Musée du Louvre", ownership: "institutional" });
    expect(object.currentWhereabouts).toMatchObject({ venueName: "Louvre, Paris", displayStatus: "unknown", isStale: false });
    const shown = await updateWhereabouts(recorded.current!.id, { displayStatus: "on_display" }, recorded.fingerprint);
    expect(shown.current!.displayStatus).toBe("on_display");
    const stored = await updateWhereabouts(shown.current!.id, { displayStatus: "in_storage" }, shown.fingerprint);
    expect(stored.current!.displayStatus).toBe("in_storage");
    expect((await getPaintings({ currentVenueIds: [louvre] })).map((p) => p.id)).toEqual([workId]);
    expect(await getPaintings({ currentVenueIds: [tokyo] })).toEqual([]);
  });

  it("records a loan and its return as atomic moves", async () => {
    await atLouvre();
    const lent = await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: tokyo, custody: "temporary_loan", certainty: "confirmed", startsOn: day(1974, 4, 20), occasionLabel: "Mona Lisa exhibition" },
      (await history()).fingerprint,
    );
    expect(lent.current).toMatchObject({ venueId: tokyo, custody: "temporary_loan", occasionLabel: "Mona Lisa exhibition" });
    const back = await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: louvre, custody: "permanent_collection", certainty: "confirmed", startsOn: day(1974, 6, 10) },
      lent.fingerprint,
    );
    expect(back.records.map((r) => [r.venueId, r.endsOn?.value.start])).toEqual([
      [louvre, undefined],
      [tokyo, { year: 1974, month: 6, day: 10 }],
      [louvre, { year: 1974, month: 4, day: 20 }],
    ]);
    // Three starts and two closings, each an owned date value.
    expect(await c`select id from catalogue_dates where id in (select starts_on_id from art_object_whereabouts union select ends_on_id from art_object_whereabouts)`).toHaveLength(5);
    expect(
      await failure(recordWhereabouts({ objectId, placeKind: "venue", venueId: moscow, custody: "temporary_loan", certainty: "confirmed" }, back.fingerprint)),
    ).toBe("Give the date of the move, so the current location can be closed");
    expect(
      await failure(recordWhereabouts({ objectId, placeKind: "venue", venueId: moscow, custody: "temporary_loan", certainty: "confirmed", startsOn: year(1960) }, back.fingerprint)),
    ).toBe("The end date cannot precede the start date");
    expect((await history()).fingerprint).toBe(back.fingerprint);
  });

  it("represents private, unknown, lost and destroyed places without fake venues", async () => {
    const venues = await c`select count(*)::int as n from venues`;
    const privately = await recordWhereabouts(
      { objectId, placeKind: "private", placeLabel: "Private collection, Geneva", custody: "private", certainty: "confirmed", startsOn: year(1900), endsOn: year(1910) },
      (await history()).fingerprint,
    );
    const unknown = await recordWhereabouts(
      { objectId, placeKind: "unknown", certainty: "confirmed", startsOn: year(1911), endsOn: year(1913) },
      privately.fingerprint,
    );
    const destroyed = await recordWhereabouts(
      { objectId, placeKind: "destroyed", placeLabel: "Fire", certainty: "uncertain", startsOn: year(1945) },
      unknown.fingerprint,
    );
    expect(destroyed.records.map((r) => r.placeKind).sort()).toEqual(["destroyed", "private", "unknown"]);
    expect(await c`select count(*)::int as n from venues`).toEqual(venues);
    const rules: [object, string][] = [
      [{ placeKind: "lost", custody: "private" }, "A lost or destroyed object has no custody"],
      [{ placeKind: "private", custody: "temporary_loan" }, "Collections and loans are at a venue"],
      [{ placeKind: "unknown", displayStatus: "on_display" }, "Display and storage are stated only at a venue"],
      [{ placeKind: "venue" }, "A venue location names its venue, and only then"],
      [{ placeKind: "private", venueId: louvre }, "A venue location names its venue, and only then"],
    ];
    for (const [input, message] of rules)
      expect(
        await failure(recordWhereabouts({ objectId, certainty: "uncertain", ...(input as { placeKind: "venue" }) }, destroyed.fingerprint)),
        message,
      ).toBe(message);
  });

  it("keeps uncertain claims beside the confirmed history and surfaces conflicts and staleness", async () => {
    const confirmed = await atLouvre(year(1900));
    const claim = await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: moscow, custody: "unknown", certainty: "probable", startsOn: year(2020), notes: "Rumoured loan" },
      confirmed.fingerprint,
    );
    expect(claim.current!.venueId).toBe(louvre);
    expect(claim.conflicts.map((r) => r.venueId)).toEqual([moscow]);
    const old = await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: tokyo, custody: "unknown", certainty: "uncertain", startsOn: year(1950), endsOn: year(1951) },
      claim.fingerprint,
    );
    expect(old.records).toHaveLength(3);
    expect(
      await failure(recordWhereabouts({ objectId, placeKind: "venue", venueId: tokyo, custody: "temporary_loan", certainty: "confirmed", startsOn: year(1950), endsOn: year(1951) }, old.fingerprint)),
    ).toBe("Confirmed locations of one object cannot overlap; close or correct the other record first");
    // Two extra hours keep the age whole across a daylight-saving change.
    await c`update art_object_whereabouts set recorded_at=now()-interval '800 days 2 hours' where id=${old.current!.id}`;
    const stale = await history();
    expect(stale).toMatchObject({ isStale: true });
    expect(stale.ageDays).toBe(800);
    const checked = await verifyWhereabouts(stale.current!.id, stale.fingerprint);
    expect(checked).toMatchObject({ isStale: false, ageDays: 0 });
    expect(
      await failure(verifyWhereabouts(checked.current!.id, checked.fingerprint, "2999-01-01T00:00:00Z")),
    ).toBe("A location cannot be verified in the future");
  });

  it("accepts backdated corrections that keep the confirmed history consistent", async () => {
    let h = await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: louvre, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1797), endsOn: year(1911) },
      (await history()).fingerprint,
    );
    h = await recordWhereabouts({ objectId, placeKind: "unknown", certainty: "confirmed", startsOn: year(1911), endsOn: year(1913), notes: "Stolen" }, h.fingerprint);
    h = await recordWhereabouts({ objectId, placeKind: "venue", venueId: louvre, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1914) }, h.fingerprint);
    const corrected = await updateWhereabouts(h.current!.id, { startsOn: month(1913, 12) }, h.fingerprint);
    expect(corrected.current!.startsOn!.value).toMatchObject({ precision: "month", start: { year: 1913, month: 12 } });
    expect(await failure(updateWhereabouts(corrected.current!.id, { startsOn: year(1912) }, corrected.fingerprint))).toBe(
      "Confirmed locations of one object cannot overlap; close or correct the other record first",
    );
    expect(await failure(updateWhereabouts(corrected.current!.id, { notes: "late" }, h.fingerprint))).toBe(STALE_RECORD);
    const stolen = corrected.records.find((r) => r.placeKind === "unknown")!;
    const removed = await deleteWhereabouts(stolen.id, corrected.fingerprint);
    expect(removed.records).toHaveLength(2);
    expect(await c`select id from catalogue_dates where id in (${stolen.startsOn!.id},${stolen.endsOn!.id})`).toHaveLength(0);
  });

  it("resolves two competing concurrent moves to exactly one", async () => {
    const start = await atLouvre();
    const moves = await Promise.allSettled(
      [tokyo, moscow].map((venueId) =>
        recordWhereabouts(
          { objectId, placeKind: "venue", venueId, custody: "temporary_loan", certainty: "confirmed", startsOn: year(1974) },
          start.fingerprint,
        ),
      ),
    );
    expect(moves.filter((m) => m.status === "fulfilled")).toHaveLength(1);
    for (const m of moves.filter((m) => m.status === "rejected"))
      expect((m as PromiseRejectedResult).reason.message).toBe(STALE_RECORD);
    const after = await history();
    expect(after.records.filter((r) => r.certainty === "confirmed" && !r.endsOn)).toHaveLength(1);
    expect(after.records).toHaveLength(2);
  });

  it("protects venues in location history and follows venue merges", async () => {
    const h = await atLouvre();
    await recordWhereabouts(
      { objectId, placeKind: "venue", venueId: tokyo, custody: "temporary_loan", certainty: "confirmed", startsOn: year(1974) },
      h.fingerprint,
    );
    expect(await rootMessage(deleteVenue(tokyo))).toBe(
      "Archive a venue that appears in artwork location history instead of deleting it",
    );
    await archiveVenue(tokyo);
    expect((await history()).current).toMatchObject({ venueId: tokyo, venueArchivedAt: expect.any(Date) });
    const duplicate = (await createVenue({ name: "Tokyo National Museum (Ueno)", type: "museum" })).id;
    const preview = await previewMerge("venues", tokyo, duplicate);
    await executeMerge({
      entity: "venues", sourceId: tokyo, targetId: duplicate, fingerprint: preview.fingerprint,
      choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
    });
    expect((await history()).current!.venueId).toBe(duplicate);
    await deleteArtObject(objectId);
    expect(await getWhereabouts(objectId)).toBeNull();
    expect(await c`select 1 from art_object_whereabouts`).toHaveLength(0);
    expect(await c`select id from catalogue_dates`).toHaveLength(0);
  });
});
