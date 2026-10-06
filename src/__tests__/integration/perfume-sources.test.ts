import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_PERFUME_SOURCES_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln377_perfume_sources")
    throw new Error("Perfume source tests require disposable local sln377_perfume_sources");
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
import { applyPerfumeSource, recordPerfumeEntrySource, reviewPerfumeSource, searchPerfumeSource } from "@/lib/actions/perfume-sources";
import { createPerfume, createPerfumeVariant, getPerfume, updatePerfume } from "@/lib/actions/perfumes";
import { saveOrganization } from "@/lib/actions/organizations";
import { citeSource } from "@/lib/actions/catalogue-provenance";
import { createTaxonomyItem } from "@/lib/actions/taxonomy-families";
import { addPerfumeRetailerLink, getPerfumeRetailerLinks, recordRetailerObservation } from "@/lib/actions/perfume-retailers";

/** Wikidata as these tests know it: a perfume, its brand and perfumer, and a film of the same name */
const ENTITIES: Record<string, unknown> = {
  Q820507: {
    id: "Q820507",
    labels: { en: { value: "Chanel No. 5" } },
    descriptions: { en: { value: "perfume by Coco Chanel" } },
    claims: {
      P31: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q131746" } } } }],
      P1716: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q180270" } } } }],
      P14539: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q1374026" } } } }],
      P571: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { time: "+1921-00-00T00:00:00Z", precision: 9 } } } }],
    },
  },
  Q900001: {
    id: "Q900001",
    labels: { en: { value: "Chanel No. 5" } },
    descriptions: { en: { value: "short film" } },
    claims: { P31: [{ rank: "normal", mainsnak: { snaktype: "value", datavalue: { value: { id: "Q24862" } } } }] },
  },
  Q180270: { id: "Q180270", labels: { en: { value: "Chanel" } } },
  Q1374026: { id: "Q1374026", labels: { en: { value: "Ernest Beaux" } } },
};
let calls: string[] = [];
let offline = false;
function wikidata(input: string | URL) {
  const url = new URL(String(input));
  calls.push(url.searchParams.get("action") ?? "");
  if (offline) throw new TypeError("fetch failed");
  const body =
    url.searchParams.get("action") === "wbsearchentities"
      ? { search: [{ id: "Q900001" }, { id: "Q820507" }] }
      : {
          entities: Object.fromEntries(
            (url.searchParams.get("ids") ?? "").split("|").map((id) => [id, ENTITIES[id] ?? { id, missing: "" }]),
          ),
        };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
}

describe.skipIf(!url)("perfume source-assisted entry", () => {
  const c = client!;
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });
  let chanel: string;

  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, catalogue_dates, source_records, catalogue_identifiers, activity_events cascade`;
    calls = [];
    offline = false;
    vi.stubGlobal("fetch", wikidata);
    chanel = (await saveOrganization({ name: "Chanel", roles: ["perfume_house"] }))!.id;
  });

  it("finds perfumes only, and reviews one against the perfume here", async () => {
    const found = await searchPerfumeSource("Chanel No 5");
    expect(found).toMatchObject({ hits: [{ externalId: "Q820507", title: "Chanel No. 5", detail: "perfume by Coco Chanel" }] });

    const perfume = await createPerfume({ title: "No 5", organizations: [{ organizationId: chanel, role: "perfume_house" }] });
    const review = await reviewPerfumeSource({ perfumeId: perfume.id, externalId: "Q820507" });
    expect(review).toMatchObject({
      locked: false,
      fields: [
        { field: "title", here: "No 5", source: "Chanel No. 5", verdict: "conflict" },
        { field: "description", here: null, source: "perfume by Coco Chanel", verdict: "fill" },
        { field: "launched", here: null, source: "1921", verdict: "fill" },
      ],
      // Chanel is already this perfume's house: it is matched, and not added again as its brand
      organizations: [{ wikidataId: "Q180270", name: "Chanel", role: "brand", match: { id: chanel }, here: true }],
      perfumers: [{ wikidataId: "Q1374026", name: "Ernest Beaux", match: null, here: false }],
    });
    // Reading is not writing
    expect(await c`select count(*)::int as n from source_records`).toEqual([{ n: 0 }]);
  });

  it("fills empty fields, adds houses and perfumers with their source, and keeps every other value", async () => {
    // Chanel is in the library, not yet on this perfume
    const perfume = await createPerfume({ title: "No 5" });
    const saved = await applyPerfumeSource({
      perfumeId: perfume.id,
      fingerprint: perfume.fingerprint,
      externalId: "Q820507",
      fields: ["description", "launched"],
      organizations: ["Q180270"],
      perfumers: ["Q1374026"],
    });
    expect(saved).toMatchObject({ added: ["Description", "Launched", "Chanel", "Ernest Beaux"] });
    const after = (await getPerfume(perfume.id))!;
    expect(after.title).toBe("No 5");
    expect(after.description).toBe("perfume by Coco Chanel");
    expect(after.releaseDate?.value).toMatchObject({ precision: "year", start: { year: 1921 } });
    const sourceId = (saved as { sourceRecordId: string }).sourceRecordId;
    expect(after.sourceRecordId).toBe(sourceId);
    expect(after.organizations.map((o) => [o.organizationId, o.role, o.sourceRecordId])).toEqual([[chanel, "brand", sourceId]]);
    expect(after.credits.map((x) => [x.person?.name, x.attribution])).toEqual([["Ernest Beaux", "attributed"]]);
    expect(await c`select provider, review_status, locked from source_records`).toEqual([{ provider: "wikidata", review_status: "accepted", locked: false }]);
    expect((await c`select entity_kind, external_id from catalogue_identifiers order by entity_kind`).map((r) => `${r.entity_kind}:${r.external_id}`)).toEqual([
      "organization:Q180270",
      "perfume:Q820507",
      "person:Q1374026",
    ]);

    // Again: everything is here, nothing more is added
    const again = (await getPerfume(perfume.id))!;
    const second = await applyPerfumeSource({ perfumeId: again.id, fingerprint: again.fingerprint, externalId: "Q820507", fields: ["description", "launched"], organizations: ["Q180270"], perfumers: ["Q1374026"] });
    expect(second).toMatchObject({ added: [] });
    expect((await getPerfume(perfume.id))!.credits).toHaveLength(1);
  });

  it("keeps a different value and a locked source as they are", async () => {
    const perfume = await createPerfume({ title: "No 5", releaseDate: year(1922), description: "Aldehydes" });
    const review = await reviewPerfumeSource({ perfumeId: perfume.id, externalId: "Q820507" });
    expect(review).toMatchObject({
      fields: [
        { field: "title", verdict: "conflict" },
        { field: "description", here: "Aldehydes", verdict: "conflict" },
        { field: "launched", here: "1922", source: "1921", verdict: "conflict" },
      ],
    });
    const saved = await applyPerfumeSource({ perfumeId: perfume.id, fingerprint: perfume.fingerprint, externalId: "Q820507", fields: ["description", "launched"] });
    expect(saved).toMatchObject({ added: [] });
    const after = (await getPerfume(perfume.id))!;
    expect([after.description, after.releaseDate?.value.start?.year]).toEqual(["Aldehydes", 1922]);
    // What the source says is kept with it, conflict and all
    expect(await c`select payload->'launched'->>'time' as time from source_records`).toEqual([{ time: "+1921-00-00T00:00:00Z" }]);

    // The person locks the source: it keeps the perfume as it is, and a new look changes nothing
    await c`update source_records set locked = true`;
    const locked = await reviewPerfumeSource({ perfumeId: perfume.id, externalId: "Q820507" });
    expect(locked).toMatchObject({ locked: true, fields: [{ verdict: "locked" }, { verdict: "locked" }, { verdict: "locked" }] });
    const current = (await getPerfume(perfume.id))!;
    expect(
      await applyPerfumeSource({ perfumeId: current.id, fingerprint: current.fingerprint, externalId: "Q820507", perfumers: ["Q1374026"] }),
    ).toEqual({ error: "A locked Wikidata source keeps this perfume as it is" });
    expect((await getPerfume(perfume.id))!.credits).toHaveLength(0);
  });

  it("never gives one Wikidata perfume to two perfumes of the same name", async () => {
    const lutens = (await saveOrganization({ name: "Serge Lutens", roles: ["perfume_house"] }))!.id;
    const first = await createPerfume({ title: "No 5" });
    const other = await createPerfume({ title: "No 5", organizations: [{ organizationId: lutens, role: "perfume_house" }] });
    await applyPerfumeSource({ perfumeId: first.id, fingerprint: first.fingerprint, externalId: "Q820507", organizations: ["Q180270"] });
    const refused = await applyPerfumeSource({ perfumeId: other.id, fingerprint: other.fingerprint, externalId: "Q820507", organizations: ["Q180270"] });
    expect(refused).toEqual({ error: "This provider identifier already belongs to another catalogue record" });
    expect((await getPerfume(other.id))!.organizations.map((o) => o.name)).toEqual(["Serge Lutens"]);
    // Another organization named Chanel: the one Wikidata named before is the match
    await c`insert into publishing_houses(name, slug) values ('Chanel', 'chanel-paris')`;
    // Two people of one name: neither is taken for the perfumer
    await c`insert into authors(name, slug) values ('Ernest Beaux', 'ernest-beaux'), ('Ernest Beaux', 'ernest-beaux-2')`;
    const review = await reviewPerfumeSource({ perfumeId: other.id, externalId: "Q820507" });
    expect(review).toMatchObject({
      organizations: [{ name: "Chanel", match: { id: chanel } }],
      perfumers: [{ name: "Ernest Beaux", match: null }],
    });
  });

  it("keeps a cited link, adds its formulation once, and keeps notes two sources place differently", async () => {
    const perfume = await createPerfume({ title: "No 5" });
    const link = "https://www.fragrantica.com/perfume/Chanel/Chanel-No-5-Parfum-28711.html";
    const kept = await recordPerfumeEntrySource({ perfumeId: perfume.id, link, retrievedOn: "2026-10-01" });
    // A cited source is never fetched
    expect(calls).toEqual([]);
    expect(await c`select provider, url, attribution, review_status from source_records`).toEqual([
      { provider: "fragrantica.com", url: link, attribution: "Fragrantica", review_status: "accepted" },
    ]);
    const fragrantica = (kept as { sourceRecordId: string }).sourceRecordId;
    await createPerfumeVariant({ workId: perfume.id, concentration: "parfum", sourceRecordId: fragrantica });
    // The same formulation named again is the one already here
    await expect(createPerfumeVariant({ workId: perfume.id, concentration: "parfum" })).rejects.toThrow(
      "This perfume already has a formulation with this concentration and labels",
    );

    const book = (await citeSource({ owner: { kind: "perfume", id: perfume.id }, attribution: "Perfume Legends, p. 31", retrievedOn: "2026-09-01" }))!.id;
    const bergamot = (await createTaxonomyItem("perfume-notes", { name: "Bergamot" })).id;
    const current = (await getPerfume(perfume.id))!;
    await updatePerfume(
      perfume.id,
      {
        notePyramid: [
          { itemId: bergamot, position: "top", sourceRecordId: fragrantica },
          { itemId: bergamot, position: "heart", sourceRecordId: book },
        ],
      },
      current.fingerprint,
    );
    const notes = (await getPerfume(perfume.id))!.notePyramid;
    expect(notes.map((n) => [n.name, n.position, n.sourceRecordId])).toEqual([
      ["Bergamot", "top", fragrantica],
      ["Bergamot", "heart", book],
    ]);
  });

  it("works without Wikidata, and a lookup never touches retailer listings", async () => {
    offline = true;
    expect(await searchPerfumeSource("No 5")).toEqual({ error: "Wikidata could not be reached" });
    const perfume = await createPerfume({ title: "No 5", organizations: [{ organizationId: chanel, role: "perfume_house" }] });
    expect(await recordPerfumeEntrySource({ perfumeId: perfume.id, link: "https://www.chanel.com/no-5", retrievedOn: "2026-10-01" })).toMatchObject({
      sourceRecordId: expect.any(String),
    });
    const offlineReview = await reviewPerfumeSource({ perfumeId: perfume.id, externalId: "Q820507" });
    expect(offlineReview).toEqual({ error: "Wikidata could not be reached" });

    offline = false;
    const shop = (await saveOrganization({ name: "Shop", roles: ["retailer"] }))!.id;
    const listing = await addPerfumeRetailerLink({ workId: perfume.id, organizationId: shop, url: "https://shop.example/no-5" });
    await recordRetailerObservation({ linkId: listing.id, checkedAt: "2025-01-01T12:00:00Z", availability: "in_stock", price: 150, currency: "EUR" });
    const fresh = (await getPerfume(perfume.id))!;
    await applyPerfumeSource({ perfumeId: perfume.id, fingerprint: fresh.fingerprint, externalId: "Q820507", fields: ["launched"] });
    const [after] = await getPerfumeRetailerLinks({ workId: perfume.id });
    expect(after).toMatchObject({ isStale: true, observation: { availability: "in_stock", price: 150 } });
    expect(await c`select count(*)::int as n from perfume_retailer_observations`).toEqual([{ n: 1 }]);
  });
});
