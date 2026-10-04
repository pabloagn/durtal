import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_DOMAIN_HARMONIZATION_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln373_test")
    throw new Error("Domain harmonization tests require disposable local sln373_test");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
const testDb = client ? drizzle(client, { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!testDb) throw new Error("Local DB required");
        return Reflect.get(testDb, key);
      },
    },
  ),
}));
vi.mock("@/lib/cache", () => ({ invalidate: vi.fn(), CACHE_TAGS: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { scanLibrary } from "@/lib/actions/harmonization";

describe.skipIf(!url)("Merging films, perfumes and paintings", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) =>
    client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
  const value = async <T = string>(text: string, params: unknown[] = []) =>
    Object.values((await one(text, params)) ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(
      `truncate works, authors, publishing_houses, locations, venues, countries, source_records, catalogue_identifiers, catalogue_dates, comments, activity_events, gallery_layouts, harmonization_decisions, harmonization_operations, harmonization_redirects cascade`,
    );
  });

  let serial = 0;
  const slugFor = (title: string) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${++serial}`;
  async function person(name: string) {
    return (
      (await value(`select id from authors where name = $1`, [name])) ??
      (await value(`insert into authors(name, slug, sort_name) values ($1, $2, $1) returning id`, [name, slugFor(name)]))
    );
  }
  async function organization(name: string, roles: string[]) {
    const id =
      (await value(`select id from publishing_houses where name = $1`, [name])) ??
      (await value(`insert into publishing_houses(name, slug) values ($1, $2) returning id`, [name, slugFor(name)]));
    for (const role of roles)
      await q(`insert into organization_roles(organization_id, role) values ($1, $2) on conflict do nothing`, [id, role]);
    return id;
  }
  async function year(y: number) {
    return value(`insert into catalogue_dates(precision, start_year) values ('year', $1) returning id`, [y]);
  }
  async function source(kind: string, workId: string, provider = "manual") {
    return value(
      `insert into source_records(entity_kind, work_id, provider, retrieved_at, payload, payload_hash)
       values ($1, $2, $3, now(), '{}'::jsonb, repeat('a', 64)) returning id`,
      [kind, workId, provider],
    );
  }
  async function work(kind: string, title: string) {
    const slug = slugFor(title);
    // Only a book carries an original language
    const id =
      kind === "book"
        ? await value(`insert into works(title, slug) values ($1, $2) returning id`, [title, slug])
        : await value(`insert into works(kind, title, slug, original_language) values ($1, $2, $3, null) returning id`, [kind, title, slug]);
    return { id, slug };
  }
  async function credit(workId: string, role: string, name: string) {
    await q(
      `insert into work_credits(work_id, person_id, role_id, attribution, sort_order) values ($1, $2, $3, 'unspecified', 0)`,
      [workId, await person(name), role],
    );
  }
  async function film(title: string, director: string | null, released?: number, originalTitle?: string) {
    const w = await work("film", title);
    await q(`insert into film_details(work_id, original_title, release_date_id) values ($1, $2, $3)`, [
      w.id,
      originalTitle ?? null,
      released ? await year(released) : null,
    ]);
    if (director) await credit(w.id, "film.director", director);
    return w;
  }
  async function perfume(title: string, house: string | null, released?: number) {
    const w = await work("perfume", title);
    await q(`insert into perfume_details(work_id, release_date_id) values ($1, $2)`, [
      w.id,
      released ? await year(released) : null,
    ]);
    if (house)
      await q(`insert into perfume_organizations(work_id, organization_id, role, sort_order) values ($1, $2, 'perfume_house', 0)`, [
        w.id,
        await organization(house, ["perfume_house"]),
      ]);
    return w;
  }
  async function painting(title: string, painter: string | null, made?: number) {
    const w = await work("painting", title);
    await q(`insert into painting_details(work_id, creation_date_id) values ($1, $2)`, [w.id, made ? await year(made) : null]);
    if (painter) await credit(w.id, "painting.painter", painter);
    return w;
  }
  async function location(name: string) {
    return value(`insert into locations(name, type) values ($1, 'physical') returning id`, [name]);
  }
  async function preview(sourceId: string, targetId: string) {
    return previewMerge("works", sourceId, targetId);
  }
  async function merge(sourceId: string, targetId: string, choices: Record<string, "source" | "target"> = {}) {
    const p = await preview(sourceId, targetId);
    return executeMerge({
      entity: "works",
      sourceId,
      targetId,
      fingerprint: p.fingerprint,
      choices: {
        ...Object.fromEntries(p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
        ...choices,
      },
    });
  }
  /** Every row that hangs from either work, by table, for before/after counts */
  async function rowsOf(ids: string[]) {
    const tables = [
      "film_versions",
      "film_holdings",
      "film_countries",
      "film_organizations",
      "perfume_variants",
      "perfume_organizations",
      "perfume_retailer_links",
      "art_objects",
      "work_credits",
      "source_records",
    ];
    const out: Record<string, number> = {};
    for (const table of tables)
      out[table] = Number(await value(`select count(*) from ${table} where work_id = any($1::uuid[])`, [ids]));
    return out;
  }

  it("still refuses a plain change of work for every guarded row", async () => {
    const a = await film("Alien", "Ridley Scott");
    const b = await film("Aliens", "James Cameron");
    const version = await value(`insert into film_versions(work_id, label, sort_order) values ($1, 'Theatrical', 0) returning id`, [a.id]);
    const shelf = await location("Shelf");
    await q(`insert into film_holdings(work_id, version_id, medium, format_label, status, location_id) values ($1, $2, 'physical', 'Blu-ray', 'held', $3)`, [
      a.id,
      version,
      shelf,
    ]);
    await source("film", a.id);
    await expect(q(`update film_versions set work_id = $1 where work_id = $2`, [b.id, a.id])).rejects.toThrow(
      "A film profile, company or version cannot move to another film",
    );
    await expect(q(`update film_holdings set work_id = $1, version_id = null where work_id = $2`, [b.id, a.id])).rejects.toThrow(
      "A copy cannot move to another film",
    );
    await expect(q(`update source_records set work_id = $1 where work_id = $2`, [b.id, a.id])).rejects.toThrow(
      "Source ownership can only move through an audited merge",
    );

    const p = await perfume("Shalimar", "Guerlain");
    const p2 = await perfume("Mitsouko", "Guerlain");
    await q(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_parfum')`, [p.id]);
    const shop = await organization("Shop", ["retailer"]);
    await q(`insert into perfume_retailer_links(work_id, organization_id, url) values ($1, $2, 'https://shop.example/shalimar')`, [p.id, shop]);
    await expect(q(`update perfume_variants set work_id = $1 where work_id = $2`, [p2.id, p.id])).rejects.toThrow(
      "A perfume profile or formulation cannot change work identity",
    );
    await expect(q(`update perfume_retailer_links set work_id = $1 where work_id = $2`, [p2.id, p.id])).rejects.toThrow(
      "Retailer listing identity is immutable",
    );

    const m = await painting("Water Lilies", "Claude Monet");
    const m2 = await painting("Haystacks", "Claude Monet");
    await q(`insert into art_objects(work_id, kind, ownership) values ($1, 'original', 'unknown')`, [m.id]);
    await expect(q(`update art_objects set work_id = $1 where work_id = $2`, [m2.id, m.id])).rejects.toThrow(
      "A painting profile or object cannot move to another painting",
    );
  });

  it("merges two films and moves every version, copy, company, country, credit and source", async () => {
    const kept = await film("The Thing", "John Carpenter", 1982);
    const merged = await film("The Thing", "John Carpenter", 1982, "Who Goes There?");
    await credit(merged.id, "film.composer", "Ennio Morricone");
    const universal = await organization("Universal", ["production_company", "distribution_company"]);
    for (const id of [kept.id, merged.id])
      await q(`insert into film_organizations(work_id, organization_id, role, sort_order) values ($1, $2, 'production_company', 0)`, [id, universal]);
    const country = await value(
      `insert into countries(name, alpha_2, alpha_3) values ('United States', 'US', 'USA') returning id`,
    );
    for (const id of [kept.id, merged.id])
      await q(`insert into film_countries(work_id, country_id, sort_order) values ($1, $2, 0)`, [id, country]);
    await q(`insert into film_versions(work_id, label, sort_order) values ($1, 'Director''s cut', 0)`, [kept.id]);
    const theatrical = await value(`insert into film_versions(work_id, label, sort_order) values ($1, 'Theatrical', 0) returning id`, [merged.id]);
    const release = await value(
      `insert into film_releases(version_id, country_id, format, distributor_id) values ($1, $2, 'theatrical', $3) returning id`,
      [theatrical, country, universal],
    );
    const shelf = await location("Shelf");
    const copy = await value(
      `insert into film_holdings(work_id, version_id, release_id, medium, format_label, status, location_id) values ($1, $2, $3, 'physical', 'Blu-ray', 'held', $4) returning id`,
      [merged.id, theatrical, release, shelf],
    );
    const observation = await source("film", merged.id, "tmdb");
    await q(`update film_details set source_record_id = $1 where work_id = $2`, [observation, merged.id]);
    await q(`insert into comments(entity_type, entity_id, content_html) values ('work', $1, '<p>Seen at the cinema</p>')`, [merged.id]);
    const before = await rowsOf([kept.id, merged.id]);

    const p = await preview(merged.id, kept.id);
    expect(p.blockers).toEqual([]);
    expect(p.source.href).toBe(`/films/${merged.slug}`);
    expect(p.fields.find((f) => f.key === "detail.original_title")).toMatchObject({ source: "Who Goes There?", conflict: false });
    expect(p.fields.find((f) => f.key === "detail.source_record_id")).toMatchObject({ display: { source: "tmdb", target: null } });
    expect(p.relationships.map((r) => r.label)).toEqual(expect.arrayContaining(["Film versions", "Film holdings"]));
    expect(p.relationships.map((r) => r.label)).not.toContain("Film details");

    await merge(merged.id, kept.id);
    expect(await value(`select count(*)::int from works where id = $1`, [merged.id])).toBe(0);
    const after = await rowsOf([kept.id]);
    // Duplicates collapse (the director, the company, the country); nothing else is lost
    expect(after).toEqual({
      ...before,
      work_credits: before.work_credits - 1,
      film_organizations: before.film_organizations - 1,
      film_countries: before.film_countries - 1,
    });
    expect(await one(`select work_id, version_id, release_id from film_holdings where id = $1`, [copy])).toEqual({
      work_id: kept.id,
      version_id: theatrical,
      release_id: release,
    });
    expect(await q(`select label from film_versions where work_id = $1 order by label`, [kept.id])).toEqual([
      { label: "Director's cut" },
      { label: "Theatrical" },
    ]);
    expect(await one(`select original_title, source_record_id from film_details where work_id = $1`, [kept.id])).toEqual({
      original_title: "Who Goes There?",
      source_record_id: observation,
    });
    expect(await value(`select work_id from source_records where id = $1`, [observation])).toBe(kept.id);
    expect(await value(`select entity_id from comments`)).toBe(kept.id);
    // The merged film's release date no longer belongs to anything
    expect(await value(`select count(*)::int from catalogue_dates`)).toBe(1);
    await expect(redirectMergedRecord("works", merged.slug)).rejects.toMatchObject({
      digest: expect.stringContaining(`/films/${kept.slug}`),
    });
  });

  it("merges two perfumes with their formulations, containers, listings and house", async () => {
    const kept = await perfume("Shalimar", "Guerlain", 1925);
    const merged = await perfume("Shalimar", "Guerlain", 1925);
    await q(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_toilette')`, [kept.id]);
    const edp = await value(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_parfum') returning id`, [merged.id]);
    const shelf = await location("Shelf");
    const bottle = await value(
      `insert into perfume_bottles(variant_id, container, capacity_value, volume_unit, location_id) values ($1, 'bottle', 50, 'ml', $2) returning id`,
      [edp, shelf],
    );
    const shop = await organization("Shop", ["retailer"]);
    await q(`insert into perfume_retailer_links(work_id, organization_id, url) values ($1, $2, 'https://shop.example/shalimar')`, [kept.id, shop]);
    const listing = await value(
      `insert into perfume_retailer_links(work_id, variant_id, organization_id, url) values ($1, $2, $3, 'https://shop.example/shalimar-edp') returning id`,
      [merged.id, edp, shop],
    );
    const before = await rowsOf([kept.id, merged.id]);
    await merge(merged.id, kept.id);
    expect(await rowsOf([kept.id])).toEqual({ ...before, perfume_organizations: before.perfume_organizations - 1 });
    expect(await value(`select work_id from perfume_variants where id = $1`, [edp])).toBe(kept.id);
    expect(await value(`select variant_id from perfume_bottles where id = $1`, [bottle])).toBe(edp);
    expect(await one(`select work_id, variant_id from perfume_retailer_links where id = $1`, [listing])).toEqual({
      work_id: kept.id,
      variant_id: edp,
    });
  });

  it("merges two paintings and keeps reproductions and locations with their objects", async () => {
    const kept = await painting("The Scream", "Edvard Munch", 1893);
    const merged = await painting("The Scream", "Edvard Munch");
    await q(`insert into art_objects(work_id, kind, label, ownership) values ($1, 'version', 'Pastel', 'unknown')`, [kept.id]);
    const original = await value(`insert into art_objects(work_id, kind, ownership) values ($1, 'original', 'unknown') returning id`, [merged.id]);
    const print = await value(
      `insert into art_objects(work_id, kind, reproduces_object_id, ownership) values ($1, 'reproduction', $2, 'unknown') returning id`,
      [merged.id, original],
    );
    const museum = await value(`insert into venues(name, slug, type) values ('National Museum', 'national-museum', 'museum') returning id`);
    const record = await value(
      `insert into art_object_whereabouts(object_id, place_kind, venue_id, custody, certainty) values ($1, 'venue', $2, 'permanent_collection', 'confirmed') returning id`,
      [original, museum],
    );
    const p = await preview(merged.id, kept.id);
    // The kept painting's creation date stays: the merged one has none
    expect(p.fields.some((f) => f.key === "detail.creation_date_id")).toBe(false);
    await merge(merged.id, kept.id);
    expect(await q(`select id, work_id, reproduces_object_id from art_objects where id = any($1::uuid[]) order by kind`, [[original, print]])).toEqual([
      { id: original, work_id: kept.id, reproduces_object_id: null },
      { id: print, work_id: kept.id, reproduces_object_id: original },
    ]);
    expect(await value(`select object_id from art_object_whereabouts where id = $1`, [record])).toBe(original);
    expect(await value(`select count(*)::int from work_credits where work_id = $1`, [kept.id])).toBe(1);
  });

  it("shows a profile date as text and the chosen value wins", async () => {
    const kept = await film("Solaris", "Andrei Tarkovsky", 1971);
    const merged = await film("Solaris", "Andrei Tarkovsky", 1972);
    const p = await preview(merged.id, kept.id);
    const field = p.fields.find((f) => f.key === "detail.release_date_id")!;
    expect(field).toMatchObject({ conflict: true, display: { source: "1972", target: "1971" } });
    await merge(merged.id, kept.id, { "detail.release_date_id": "source" });
    expect(
      await value(`select d.start_year from film_details f join catalogue_dates d on d.id = f.release_date_id where f.work_id = $1`, [kept.id]),
    ).toBe(1972);
    expect(await value(`select count(*)::int from catalogue_dates`)).toBe(1);
  });

  it("refuses identities that would collide, and a pair of two kinds", async () => {
    const a = await film("Psycho", "Alfred Hitchcock");
    const b = await film("Psycho", "Alfred Hitchcock");
    for (const id of [a.id, b.id]) await q(`insert into film_versions(work_id, label, sort_order) values ($1, 'Theatrical', 0)`, [id]);
    expect((await preview(a.id, b.id)).blockers).toEqual([
      "Both films have a version labelled “Theatrical”. Rename or remove one of them first.",
    ]);

    const p = await perfume("Aventus", "Creed");
    const p2 = await perfume("Aventus", "Creed");
    for (const id of [p.id, p2.id]) await q(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_parfum')`, [id]);
    expect((await preview(p.id, p2.id)).blockers).toEqual([
      "Both perfumes have the formulation Eau de Parfum. Move its containers to one and remove the other first.",
    ]);

    const m = await painting("Sunflowers", "Vincent van Gogh");
    const m2 = await painting("Sunflowers", "Vincent van Gogh");
    for (const id of [m.id, m2.id]) await q(`insert into art_objects(work_id, kind, ownership) values ($1, 'original', 'unknown')`, [id]);
    const blocked = await preview(m.id, m2.id);
    expect(blocked.blockers).toEqual([
      "Both paintings record an original or version with no label. Label one of them, or remove the duplicate, first.",
    ]);
    await expect(
      executeMerge({ entity: "works", sourceId: m.id, targetId: m2.id, fingerprint: blocked.fingerprint, choices: {} }),
    ).rejects.toThrow("Both paintings record an original");

    const book = await work("book", "Psycho");
    expect((await preview(book.id, a.id)).blockers).toContain(
      "A book and a film cannot be merged. Choose two records of one kind.",
    );
  });

  it("moves nothing when a record changes after the preview", async () => {
    const kept = await film("Vertigo", "Alfred Hitchcock");
    const merged = await film("Vertigo", "Alfred Hitchcock");
    await q(`insert into film_versions(work_id, label, sort_order) values ($1, 'Restored', 0)`, [merged.id]);
    const p = await preview(merged.id, kept.id);
    // A clash appears after the preview: the merge stops before it moves anything
    await q(`insert into film_versions(work_id, label, sort_order) values ($1, 'Restored', 0)`, [kept.id]);
    await expect(
      executeMerge({ entity: "works", sourceId: merged.id, targetId: kept.id, fingerprint: p.fingerprint, choices: {} }),
    ).rejects.toThrow("Review a fresh merge preview");
    expect(await value(`select count(*)::int from film_versions where work_id = $1`, [merged.id])).toBe(1);
    expect(await value(`select count(*)::int from harmonization_operations`)).toBe(0);
  });

  it("finds duplicates by title and maker, never a remake or a linked work", async () => {
    const thing = await film("The Thing", "John Carpenter", 1982);
    const thing2 = await film("The Thing", "John Carpenter", 1982);
    await film("The Thing", "Matthijs van Heijningen Jr.", 2011);
    await film("Scarface", "Howard Hawks", 1932);
    await film("Scarface", "Brian De Palma", 1983);
    await film("The Man Who Knew Too Much", "Alfred Hitchcock", 1934);
    await film("The Man Who Knew Too Much", "Alfred Hitchcock", 1956);
    const fly = await film("The Fly", "Kurt Neumann");
    const fly2 = await film("The Fly", "Kurt Neumann");
    await q(`insert into work_relations(type, from_work_id, from_kind, to_work_id, to_kind) values ('remake', $1, 'film', $2, 'film')`, [fly2.id, fly.id]);
    await perfume("Shalimar", "Guerlain");
    await perfume("Shalimar", "Guerlain");
    await perfume("Aqua", "House One");
    await perfume("Aqua", "House Two");
    await painting("Untitled", "Mark Rothko");
    await painting("Untitled", null);
    await work("book", "The Thing");

    const result = await scanLibrary({ category: "duplicates", entity: "all", limit: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = result.value.findings.filter((f) => f.rule === "duplicate-work");
    expect(
      found.map((f) => [f.entityLabel, f.records[0].name, f.confidence]).sort(),
    ).toEqual([
      ["Films", "The Thing", "high"],
      ["Paintings", "Untitled", "low"],
      ["Perfumes", "Shalimar", "medium"],
    ]);
    const films = found.find((f) => f.entityLabel === "Films")!;
    expect(films.records.map((r) => r.href).sort()).toEqual([`/films/${thing.slug}`, `/films/${thing2.slug}`].sort());
    expect(films.evidence).toContain("Same director: John Carpenter.");
    expect(films.resolution).toEqual({ kind: "merge" });
    const filtered = await scanLibrary({ entity: "Perfumes", limit: 100 });
    expect(filtered.ok && filtered.value.findings.map((f) => f.records[0].name)).toEqual(["Shalimar"]);
  });
});
