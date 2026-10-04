import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { NextRequest } from "next/server";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_SHARED_ACTIVITY_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln372_test")
    throw new Error("Shared activity tests require disposable local sln372_test");
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
const s3 = vi.hoisted(() => ({ deleteUnusedObjects: vi.fn(async () => false) }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: s3.deleteUnusedObjects,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
import { POST as postComment, GET as getComments } from "@/app/api/comments/route";
import { resolveEntity, ownerExists } from "@/lib/activity/owners";
import { getActivityTimeline } from "@/lib/actions/activity";
import { formatEventDescription } from "@/lib/activity/event-config";
import { createFilm, getFilm, updateFilm } from "@/lib/actions/films";
import { addPerfumeBottle, createPerfume, deletePerfumeBottle, getPerfume, updatePerfumeBottle } from "@/lib/actions/perfumes";
import { createArtObject, createPainting } from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { createPerson, updatePerson } from "@/lib/actions/people";
import {
  deleteOrganization,
  getOrganizationMergePreview,
  mergeOrganizations,
  saveOrganization,
} from "@/lib/actions/organizations";
import { createVenue, deleteVenue } from "@/lib/actions/venues";
import { createTaxonomyItem, replaceTaxonomyAssignments } from "@/lib/actions/taxonomy-families";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";

describe.skipIf(!url)("activity and comments for every kind of record", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint if exists works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, places, catalogue_dates, comments, activity_events,
      gallery_layouts, harmonization_operations, harmonization_redirects, custom_taxonomy_items cascade`;
    s3.deleteUnusedObjects.mockClear();
  });

  const comment = (entityType: string, entityId: string) =>
    postComment(
      new NextRequest("http://localhost/api/comments", {
        method: "POST",
        body: JSON.stringify({ entityType, entityId, contentHtml: "<p>Note</p>" }),
      }),
    );
  const history = async (id: string, type: "work" | "organization" | "venue" = "work") =>
    (await getActivityTimeline(type, id, 50)).events.map((e) => [
      e.eventKey,
      formatEventDescription(e.eventKey, e.metadata as never),
    ]);
  const year = (value: number) => ({ precision: "year" as const, start: { year: value } });

  it("resolves each kind of record to its own page, follows merges and knows a missing one", async () => {
    const [book] = await c`insert into works(title, slug) values ('Solaris', 'solaris-by-lem') returning id`;
    const film = await createFilm({ title: "Solaris" });
    const perfume = await createPerfume({ title: "Mitsouko" });
    const painting = await createPainting({ title: "The Night Watch" });
    const publisher = (await saveOrganization({ name: "Gallimard", roles: ["publisher"] }))!;
    const museum = (await saveOrganization({ name: "Rijksmuseum", roles: ["museum"] }))!;
    const venue = await createVenue({ name: "Rijksmuseum, Amsterdam", type: "museum" });
    expect((await resolveEntity("work", book.id))?.href).toBe("/library/solaris-by-lem");
    expect((await resolveEntity("work", film.id))?.href).toBe(`/films/${film.slug}`);
    expect((await resolveEntity("work", perfume.id))?.href).toBe(`/perfumes/${perfume.slug}`);
    expect((await resolveEntity("work", painting.id))?.href).toMatch(/^\/paintings\//);
    expect((await resolveEntity("organization", publisher.id))?.href).toBe(`/publishers/${publisher.slug}`);
    expect(await resolveEntity("organization", museum.id)).toMatchObject({ name: "Rijksmuseum", href: null });
    expect((await resolveEntity("venue", venue.id))?.href).toBe(`/places/${venue.slug}`);
    expect(await resolveEntity("venue", "00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await ownerExists("work", film.id)).toBe(true);
    expect(await ownerExists("venue", film.id)).toBe(false);

    // A merged book resolves to the one it became, and keeps its comment there
    const [kept] = await c`insert into works(title, slug) values ('Solaris', 'solaris-kept') returning id`;
    expect((await comment("work", book.id)).status).toBe(201);
    const preview = await previewMerge("works", book.id, kept.id);
    await executeMerge({
      entity: "works",
      sourceId: book.id,
      targetId: kept.id,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
    });
    expect(await resolveEntity("work", book.id)).toMatchObject({ id: kept.id, mergedFrom: book.id, href: "/library/solaris-kept" });
    expect((await history(kept.id)).map(([key]) => key)).toContain("work.comment_added");
  });

  it("refuses a comment on a missing record or an unknown kind, and takes one on an organization or a venue", async () => {
    const missing = await comment("work", "00000000-0000-4000-8000-000000000000");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "That record no longer exists" });
    expect((await comment("planet", "00000000-0000-4000-8000-000000000000")).status).toBe(400);
    expect(await c`select 1 from comments`).toHaveLength(0);

    const house = (await saveOrganization({ name: "Guerlain", roles: ["perfume_house"] }))!;
    const venue = await createVenue({ name: "Maison Guerlain", type: "perfumery" });
    expect((await comment("organization", house.id)).status).toBe(201);
    expect((await comment("venue", venue.id)).status).toBe(201);
    expect(await history(house.id, "organization")).toEqual([["organization.comment_added", "Left a comment"]]);
    expect(await history(venue.id, "venue")).toEqual([["venue.comment_added", "Left a comment"]]);
    const listed = await getComments(
      new NextRequest(`http://localhost/api/comments?entityType=venue&entityId=${venue.id}`),
    );
    expect((await listed.json()).length).toBe(1);
    expect(
      (await getComments(new NextRequest(`http://localhost/api/comments?entityType=planet&entityId=${venue.id}`))).status,
    ).toBe(400);
  });

  it("records a film edit as readable differences, and a person's new name shows on the film at once", async () => {
    const carpenter = (await createPerson({ name: "John Carpenter", domains: ["film"] })).id;
    const hill = (await createPerson({ name: "Debra Hill", domains: ["film"] })).id;
    const film = await createFilm({ title: "Halloweem", credits: [{ personId: carpenter, roleId: "film.director" }] });
    const [family] = await c`select slug from taxonomy_families where slug = 'film-genres'`;
    const horror = await createTaxonomyItem(family.slug, { name: "Horror" });
    const stored = (await getFilm(film.id))!;
    await updateFilm(
      film.id,
      {
        title: "Halloween",
        credits: [
          { id: stored.credits[0].id, personId: carpenter, roleId: "film.director" },
          { personId: hill, roleId: "film.producer" },
        ],
      },
      stored.fingerprint,
    );
    await replaceTaxonomyAssignments({ familySlug: family.slug, kind: "film", level: "work", ownerId: film.id, itemIds: [horror.id] });
    const lines = (await history(film.id)).map(([, text]) => text);
    expect(lines).toEqual(
      expect.arrayContaining([
        "Created this work",
        "Changed title from Halloweem to Halloween",
        "Added producer Debra Hill",
        "Added Horror (Film genres)",
      ]),
    );
    // Equal-time entries page in a stable order: none repeated, none skipped
    await c`update activity_events set created_at = '2026-01-01T00:00:00Z' where entity_id = ${film.id}`;
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await getActivityTimeline("work", film.id, 2, cursor);
      seen.push(...page.events.map((e) => e.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.length).toBe((await c`select 1 from activity_events where entity_id = ${film.id}`).length);
    // The film reads the person as they are now
    await updatePerson(carpenter, { name: "John H. Carpenter" });
    expect((await getFilm(film.id))!.credits.map((cr) => cr.person?.name)).toContain("John H. Carpenter");
  });

  it("records containers and painting moves in the work's history", async () => {
    const perfume = await createPerfume({ title: "Shalimar" });
    const variantId = (await getPerfume(perfume.id))!.variants[0]?.id
      ?? (await c`insert into perfume_variants(work_id) values (${perfume.id}) returning id`)[0].id;
    const bottle = await addPerfumeBottle({ variantId, container: "bottle", capacityValue: 100, volumeUnit: "ml" });
    await updatePerfumeBottle(bottle.id, { status: "lent_out", remainingMl: 60 }, bottle.fingerprint);
    await deletePerfumeBottle(bottle.id);
    expect((await history(perfume.id)).map(([, text]) => text)).toEqual(
      expect.arrayContaining([
        "Added Bottle · 100 ml",
        "Updated Bottle · 100 ml: Status: Held → Lent out; Left: ? → 60 ml",
        "Removed Bottle · 100 ml",
      ]),
    );

    const louvre = (await saveOrganization({ name: "Louvre", roles: ["museum"] }))!.id;
    const paris = await createVenue({ name: "Louvre, Paris", type: "museum" });
    const tokyo = await createVenue({ name: "Tokyo Gallery", type: "gallery" });
    const mona = await createPainting({ title: "Mona Lisa" });
    const object = await createArtObject({ workId: mona.id, kind: "original", ownership: "institutional", ownerOrganizationId: louvre });
    const first = await recordWhereabouts(
      { objectId: object.id, placeKind: "venue", venueId: paris.id, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1797) },
      (await getWhereabouts(object.id))!.fingerprint,
    );
    await recordWhereabouts(
      { objectId: object.id, placeKind: "venue", venueId: tokyo.id, custody: "temporary_loan", certainty: "confirmed", startsOn: year(1974) },
      first.fingerprint,
    );
    expect((await history(mona.id)).map(([, text]) => text)).toEqual(
      expect.arrayContaining([
        "Recorded at Louvre, Paris (permanent collection, confirmed)",
        "Moved from Louvre, Paris to Tokyo Gallery (on loan for an exhibition, confirmed)",
      ]),
    );
  });

  it("moves an organization's comments in a merge and clears them, with their files, on delete", async () => {
    const source = (await saveOrganization({ name: "Guerlain Paris", roles: ["perfume_house"] }))!;
    const target = (await saveOrganization({ name: "Guerlain", roles: ["perfume_house"] }))!;
    expect((await comment("organization", source.id)).status).toBe(201);
    const preview = await getOrganizationMergePreview(source.id, target.id);
    await mergeOrganizations({
      sourceId: source.id,
      targetId: target.id,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
    });
    expect(await c`select entity_id from comments where entity_type = 'organization'`).toEqual([{ entity_id: target.id }]);
    expect(await resolveEntity("organization", source.id)).toMatchObject({ id: target.id, mergedFrom: source.id });

    const [saved] = await c`select id from comments where entity_id = ${target.id}`;
    await c`insert into comment_attachments(comment_id, file_name, file_size, mime_type, s3_key)
      values (${saved.id}, 'scan.pdf', 10, 'application/pdf', ${`gold/comments/organization/${target.id}/${saved.id}/scan.pdf`})`;
    // The files fail to go: the record still goes, and says its files are pending
    s3.deleteUnusedObjects.mockResolvedValueOnce(true);
    expect(await deleteOrganization(target.id)).toMatchObject({ cleanupPending: true });
    expect(s3.deleteUnusedObjects).toHaveBeenCalledWith(
      expect.objectContaining({
        keys: expect.arrayContaining([`gold/comments/organization/${target.id}/${saved.id}/scan.pdf`]),
        prefixes: expect.arrayContaining([`gold/comments/organization/${target.id}/`]),
      }),
      expect.any(String),
    );
    expect(await c`select 1 from comments where entity_id = ${target.id}`).toHaveLength(0);
    expect(await c`select 1 from activity_events where entity_id = ${target.id}`).toHaveLength(0);

    const venue = await createVenue({ name: "Closed Shop", type: "perfumery" });
    expect((await comment("venue", venue.id)).status).toBe(201);
    await deleteVenue(venue.id);
    expect(await c`select 1 from comments where entity_id = ${venue.id}`).toHaveLength(0);
    expect(await c`select 1 from activity_events where entity_id = ${venue.id}`).toHaveLength(0);
  });
});
