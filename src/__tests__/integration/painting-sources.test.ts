import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_PAINTING_SOURCES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln378_painting_sources")
    throw new Error("Painting source tests require disposable local sln378_painting_sources");
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
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), cached: (fn: unknown) => fn, CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { applyPaintingSource, reviewPaintingSource, searchPaintingSource } from "@/lib/actions/painting-sources";
import { createArtObject, createPainting, getArtObject, getPainting } from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { linkOrganizationVenue, saveOrganization } from "@/lib/actions/organizations";
import { createVenue } from "@/lib/actions/venues";
import { createPerson } from "@/lib/actions/people";

/** The Met as these tests know it; each test sets what it answers */
let met: Record<string, unknown>;
let offline = false;
const asked: string[] = [];
function museum(input: string | URL) {
  const address = String(input);
  asked.push(address);
  if (offline) throw new TypeError("fetch failed");
  const body = address.includes("/v1.1/search?") ? { total: 1, objectIDs: [437397] } : met;
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}
const rembrandt = () => ({
  objectID: 437397,
  title: "Aristotle with a Bust of Homer",
  artistDisplayName: "Rembrandt (Rembrandt van Rijn)",
  objectDate: "1653",
  objectBeginDate: 1653,
  objectEndDate: 1653,
  medium: "Oil on canvas",
  dimensions: "143.5 x 136.5 cm",
  measurements: [{ elementName: "Overall", elementMeasurements: { Height: 143.5, Width: 136.5 } }],
  accessionNumber: "61.198",
  creditLine: "Purchase, special contributions and funds given or bequeathed by friends of the Museum, 1961",
  GalleryNumber: "964",
  classification: "Paintings",
  primaryImage: "https://images.metmuseum.org/CRDImages/ep/original/DP-1.jpg",
  isPublicDomain: true,
  objectURL: "https://www.metmuseum.org/art/collection/search/437397",
});

describe.skipIf(!url)("museum-source painting enrichment", () => {
  const c = client!;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  let metOrg: string, metVenue: string, tokyo: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, catalogue_dates, source_records, catalogue_identifiers, activity_events cascade`;
    met = rembrandt();
    offline = false;
    asked.length = 0;
    vi.stubGlobal("fetch", museum);
    metOrg = (await saveOrganization({ name: "The Metropolitan Museum of Art", roles: ["museum"] }))!.id;
    metVenue = (await createVenue({ name: "The Met Fifth Avenue", type: "museum" })).id;
    await linkOrganizationVenue({ organizationId: metOrg, venueId: metVenue, role: "operator" });
    tokyo = (await createVenue({ name: "Tokyo Metropolitan Art Museum", type: "museum" })).id;
  });

  async function aristotle(objectFields: Record<string, unknown> = {}) {
    const painting = await createPainting({ title: "Aristotle with a Bust of Homer" });
    const object = await createArtObject({ workId: painting.id, kind: "original", ownership: "unknown", ...objectFields });
    return { painting: (await getPainting(painting.id))!, object: (await getArtObject(object.id))! };
  }
  const apply = async (paintingId: string, extra: Record<string, unknown> = {}) => {
    const painting = (await getPainting(paintingId))!;
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId, externalId: "437397" });
    if ("error" in review) throw new Error(review.error);
    return applyPaintingSource({
      museum: "metmuseum",
      paintingId,
      externalId: "437397",
      objectId: review.object?.id ?? null,
      fingerprint: painting.fingerprint,
      objectFingerprint: review.object?.fingerprint ?? null,
      historyFingerprint: review.location.historyFingerprint,
      ...extra,
    });
  };

  it("finds works in the museum's collection", async () => {
    const found = await searchPaintingSource({ museum: "metmuseum", text: "Aristotle" });
    expect(found).toEqual({
      hits: [
        {
          externalId: "437397",
          title: "Aristotle with a Bust of Homer",
          detail: "Rembrandt (Rembrandt van Rijn), 1653, Paintings",
          url: "https://www.metmuseum.org/art/collection/search/437397",
        },
      ],
    });
  });

  it("tells the owning museum from the loan venue, and moves only on the museum's dated word", async () => {
    const { painting, object } = await aristotle({ ownership: "institutional", ownerOrganizationId: metOrg, accessionNumber: "61.198" });
    let history = (await getWhereabouts(object.id))!;
    history = await recordWhereabouts(
      { objectId: object.id, placeKind: "venue", venueId: tokyo, custody: "temporary_loan", certainty: "confirmed", startsOn: year(2024) },
      history.fingerprint,
    );
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect(review).toMatchObject({
      owner: { name: "The Metropolitan Museum of Art", match: { id: metOrg } },
      objectFields: expect.arrayContaining([expect.objectContaining({ field: "owner", verdict: "same" }), expect.objectContaining({ field: "accessionNumber", verdict: "same" })]),
      location: { evidence: "on_view", action: "move", venue: { id: metVenue } },
    });
    expect((review as { location: { note: string } }).location.note).toMatch(/^Here it is at Tokyo Metropolitan Art Museum \(temporary loan\)\. Saving records a move to The Met Fifth Avenue on /);

    // Without the location step, the loan stays the current place
    await apply(painting.id);
    expect((await getWhereabouts(object.id))!.current?.venueId).toBe(tokyo);

    // With it: the loan closes on the day the museum said, and the return is sourced and dated
    const saved = await apply(painting.id, { location: true });
    expect(saved).toMatchObject({ added: ["A move"] });
    const after = (await getWhereabouts(object.id))!;
    expect(after.current).toMatchObject({ venueId: metVenue, custody: "permanent_collection", displayStatus: "on_display", sourceRecordId: (saved as { sourceRecordId: string }).sourceRecordId });
    const loan = after.records.find((r) => r.venueId === tokyo)!;
    expect(loan.endsOn).not.toBeNull();
    expect(after.records).toHaveLength(2);
  });

  it("keeps an unknown location unknown when the museum does not show the work", async () => {
    met = { ...rembrandt(), GalleryNumber: "" };
    const { painting, object } = await aristotle();
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect(review).toMatchObject({
      location: { evidence: "not_on_view", action: null, note: "The Met does not show it now and does not say where it is. Its location stays unknown." },
      // Owned, per the museum: that fills the owner, never the location
      objectFields: expect.arrayContaining([expect.objectContaining({ field: "owner", verdict: "fill" })]),
    });
    await apply(painting.id, { object: ["owner", "accessionNumber"], location: true });
    expect(await getArtObject(object.id)).toMatchObject({ ownership: "institutional", ownerOrganizationId: metOrg, accessionNumber: "61.198" });
    const history = (await getWhereabouts(object.id))!;
    expect([history.current, history.records]).toEqual([null, []]);
  });

  it("compares sizes across units and fills only an empty size", async () => {
    // 56.5 × 53.75 in is 143.5 × 136.5 cm
    const { painting } = await aristotle({ height: 56.5, width: 53.75, dimensionUnit: "in" });
    const same = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect((same as { objectFields: { field: string; verdict: string; source: string }[] }).objectFields.find((f) => f.field === "dimensions")).toEqual(
      expect.objectContaining({ verdict: "same", source: "143.5 × 136.5 cm, about 56.496 × 53.74 in" }),
    );

    const other = await aristotle({ height: 100, width: 80, dimensionUnit: "cm" });
    const differs = await reviewPaintingSource({ museum: "metmuseum", paintingId: other.painting.id, externalId: "437397" });
    expect((differs as { objectFields: { field: string; verdict: string }[] }).objectFields.find((f) => f.field === "dimensions")!.verdict).toBe("conflict");
    await apply(other.painting.id, { object: ["dimensions"] });
    expect(await getArtObject(other.object.id)).toMatchObject({ height: 100, width: 80, dimensionUnit: "cm" });

    const empty = await aristotle();
    await apply(empty.painting.id, { object: ["dimensions"] });
    expect(await getArtObject(empty.object.id)).toMatchObject({ height: 143.5, width: 136.5, dimensionUnit: "cm" });
  });

  it("shows a changed attribution and a stale answer, and keeps both answers and the credit here", async () => {
    const { painting } = await aristotle();
    const first = await apply(painting.id, { painter: true });
    expect(first).toMatchObject({ added: ["Rembrandt (Rembrandt van Rijn)"] });
    const firstSource = (first as { sourceRecordId: string }).sourceRecordId;
    await c`update source_records set retrieved_at = now() - interval '400 days' where id = ${firstSource}`;

    met = { ...rembrandt(), artistDisplayName: "Workshop of Rembrandt", GalleryNumber: "" };
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect(review).toMatchObject({
      previous: {
        stale: true,
        changes: [
          { field: "Attribution", before: "Rembrandt (Rembrandt van Rijn)", after: "Workshop of Rembrandt" },
          { field: "On view", before: "Yes, Gallery 964", after: "No" },
        ],
      },
      painter: { name: "Workshop of Rembrandt", here: false, others: ["Rembrandt (Rembrandt van Rijn)"] },
    });
    expect((review as { previous: { ageDays: number } }).previous.ageDays).toBeGreaterThanOrEqual(400);

    const second = await apply(painting.id);
    // The new answer follows the old one; both stay
    expect(await c`select id, supersedes_id, review_status from source_records order by retrieved_at`).toEqual([
      { id: firstSource, supersedes_id: null, review_status: "accepted" },
      { id: (second as { sourceRecordId: string }).sourceRecordId, supersedes_id: firstSource, review_status: "accepted" },
    ]);
    // The painter credited here is not replaced
    expect((await getPainting(painting.id))!.credits.map((x) => [x.person?.name, x.attribution])).toEqual([["Rembrandt (Rembrandt van Rijn)", "attributed"]]);
  });

  it("keeps a locked source's painting as it is, and works without the museum", async () => {
    const { painting, object } = await aristotle();
    await apply(painting.id);
    await c`update source_records set locked = true`;
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect(review).toMatchObject({ locked: true, location: { action: null } });
    expect(await apply(painting.id, { object: ["accessionNumber"], location: true })).toEqual({ error: "A locked The Met source keeps this painting as it is" });
    expect((await getArtObject(object.id))!.accessionNumber).toBeNull();

    offline = true;
    expect(await searchPaintingSource({ museum: "metmuseum", text: "Aristotle" })).toEqual({ error: "The Met could not be reached" });
    const manual = await createPainting({ title: "Without a museum" });
    const original = await createArtObject({ workId: manual.id, kind: "original", ownership: "unknown" });
    expect((await getWhereabouts(original.id))!.current).toBeNull();
  });

  it("adds the original with its owner and a sourced first location", async () => {
    await createPerson({ name: "Rembrandt (Rembrandt van Rijn)", domains: ["painting"] });
    const painting = await createPainting({ title: "Aristotle with a Bust of Homer" });
    const review = await reviewPaintingSource({ museum: "metmuseum", paintingId: painting.id, externalId: "437397" });
    expect(review).toMatchObject({ object: null, location: { action: "record" }, painter: { match: { name: "Rembrandt (Rembrandt van Rijn)" } } });
    const saved = await apply(painting.id, { createObject: true, location: true });
    const objectId = (saved as { objectId: string }).objectId;
    expect(await getArtObject(objectId)).toMatchObject({ kind: "original", ownership: "institutional", ownerOrganizationId: metOrg, accessionNumber: "61.198", height: 143.5, dimensionUnit: "cm" });
    const history = (await getWhereabouts(objectId))!;
    expect(history.current).toMatchObject({ venueId: metVenue, custody: "permanent_collection", displayStatus: "on_display", certainty: "confirmed" });
    expect(history.current!.startsOn).toBeNull();
    expect(asked.every((a) => a.startsWith("https://collectionapi.metmuseum.org/"))).toBe(true);
  });
});
