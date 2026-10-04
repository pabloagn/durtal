import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_TYPED_ACQUISITIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln374_test")
    throw new Error("Typed acquisition tests require a disposable local sln374_test database");
}
const client = url ? postgres(url, { max: 5, onnotice: () => {} }) : null;
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import { createOrder, getProvenanceStats, updateOrderStatus } from "@/lib/actions/orders";
import {
  createTypedTarget,
  getTypedTargets,
  orderTypedTarget,
  removeTypedTarget,
} from "@/lib/actions/acquisitions";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { deleteFilm, deleteFilmVersion } from "@/lib/actions/films";
import { deletePerfume, deletePerfumeVariant } from "@/lib/actions/perfumes";
import { deleteArtObject, deletePainting } from "@/lib/actions/paintings";

describe.skipIf(!url)("acquisition targets for films, perfumes and paintings", () => {
  const db = testDb!;
  const q = (text: string, params: unknown[] = []) =>
    client!.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
  const value = async <T = string>(text: string, params: unknown[] = []) =>
    Object.values((await q(text, params))[0] ?? {})[0] as T;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await q(`truncate works, authors, publishing_houses, locations, venues, catalogue_dates, countries cascade`);
  });

  let serial = 0;
  async function work(kind: string, title: string) {
    return value(
      kind === "book"
        ? `insert into works(title, slug) values ($1, $2) returning id`
        : `insert into works(kind, title, slug, original_language) values ($3, $1, $2, null) returning id`,
      kind === "book" ? [title, `${title}-${++serial}`] : [title, `${title}-${++serial}`, kind],
    );
  }
  async function place(name: string, type: "physical" | "digital" = "physical") {
    return value(`insert into locations(name, type) values ($1, $2) returning id`, [name, type]);
  }
  async function perfume() {
    const id = await work("perfume", "Shalimar");
    await q(`insert into perfume_details(work_id) values ($1)`, [id]);
    const edp = await value(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_parfum') returning id`, [id]);
    const edt = await value(`insert into perfume_variants(work_id, concentration) values ($1, 'eau_de_toilette') returning id`, [id]);
    return { id, edp, edt };
  }
  async function film() {
    const id = await work("film", "Stalker");
    await q(`insert into film_details(work_id) values ($1)`, [id]);
    const version = await value(`insert into film_versions(work_id, label, sort_order) values ($1, 'Restored', 0) returning id`, [id]);
    const country = await value(`insert into countries(name, alpha_2, alpha_3) values ('France', 'FR', 'FRA') returning id`);
    const release = await value(
      `insert into film_releases(version_id, country_id, format) values ($1, $2, 'home_media') returning id`,
      [version, country],
    );
    return { id, version, release };
  }
  async function painting() {
    const id = await work("painting", "The Kiss");
    await q(`insert into painting_details(work_id) values ($1)`, [id]);
    return id;
  }
  const bottles = () => value<number>(`select count(*)::int from perfume_bottles`);

  it("keeps book targets as they were, and refuses an untyped target or order on another kind", async () => {
    const book = await work("book", "Watt");
    const edition = await value(`insert into editions(work_id, title, language) values ($1, 'Watt', 'en') returning id`, [book]);
    const target = await value(`insert into acquisition_targets(work_id) values ($1) returning id`, [book]);
    const order = await createOrder({
      workId: book,
      acquisitionTargetId: target,
      editionId: edition,
      acquisitionMethod: "in_store_purchase",
      status: "purchased",
      orderDate: "2026-10-01",
    });
    expect(order.status).toBe("purchased");
    expect(await value(`select count(*)::int from instances`)).toBe(0);
    const { id: perfumeId } = await perfume();
    for (const statement of [
      () => q(`insert into acquisition_targets(work_id) values ($1)`, [perfumeId]),
      () => q(`insert into orders(work_id, acquisition_method, order_date) values ($1, 'gift', '2026-10-01')`, [perfumeId]),
    ])
      await expect(statement()).rejects.toMatchObject({ code: "23514", constraint_name: "book_parent_required" });
    await expect(
      q(`insert into acquisition_targets(work_id, perfume_variant_id, perfume_container, perfume_capacity_value, perfume_volume_unit)
        select $1, id, 'bottle', 50, 'ml' from perfume_variants limit 1`, [book]),
    ).rejects.toThrow("A book target names an edition or a publisher");
  });

  it("receives a perfume once: one bottle of the target's formulation, size and place", async () => {
    const p = await perfume();
    const shelf = await place("Dressing table");
    const target = await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 50, volumeUnit: "ml" });
    await expect(
      createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 0.05, volumeUnit: "l" }),
    ).rejects.toThrow("This is already on your list");
    const order = await orderTypedTarget({
      targetId: target.id,
      acquisitionMethod: "online_order",
      status: "placed",
      orderDate: "2026-10-01",
      price: "110.00",
      shippingCost: "10.00",
      totalCost: "120.00",
      currency: "EUR",
      destinationLocationId: shelf,
    });
    expect((await getTypedTargets(p.id))[0]).toMatchObject({ title: "Eau de Parfum · Bottle · 50 ml", state: "on_order" });
    expect(await bottles()).toBe(0);
    await updateOrderStatus(order.id, "shipped");
    const received = await updateOrderStatus(order.id, "delivered");
    const [bottle] = await q(
      `select b.id, b.variant_id, b.container, b.capacity_ml::float as ml, b.status, b.location_id, b.acquisition_price::float as price, b.acquisition_currency, d.start_year
       from perfume_bottles b join catalogue_dates d on d.id = b.acquisition_date_id`,
    );
    expect(bottle).toMatchObject({ variant_id: p.edp, container: "bottle", ml: 50, status: "held", location_id: shelf, price: 120, acquisition_currency: "EUR" });
    expect(received.perfumeBottleId).toBe(bottle.id);
    expect((await getTypedTargets(p.id))[0]).toMatchObject({ state: "received", orders: [{ status: "delivered", cost: "€120.00", received: true }] });
    // A replayed receipt brings in nothing more
    await expect(updateOrderStatus(order.id, "delivered")).rejects.toThrow("Invalid transition");
    await expect(updateOrderStatus(order.id, "received")).rejects.toThrow("Invalid transition");
    expect(await bottles()).toBe(1);
    // Another formulation's bottle never stands for this order or target
    const other = await value(
      `insert into perfume_bottles(variant_id, container, capacity_value, volume_unit) values ($1, 'bottle', 50, 'ml') returning id`,
      [p.edt],
    );
    await expect(q(`update orders set perfume_bottle_id = $1 where id = $2`, [other, order.id])).rejects.toThrow(
      "The received container is another formulation than the target",
    );
    // What a received order brought in is kept while the order stands
    await expect(q(`delete from perfume_bottles where id = $1`, [bottle.id])).rejects.toThrow(
      "return the order before deleting it",
    );
    // A return disposes of it, and the formulation is wanted again
    await updateOrderStatus(order.id, "returned");
    expect(await q(`select status, disposition_reason from perfume_bottles where id = $1`, [bottle.id])).toEqual([
      { status: "disposed", disposition_reason: "Returned to the seller" },
    ]);
    expect((await getTypedTargets(p.id))[0].state).toBe("wanted");
  });

  it("keeps two orders of one target apart: a cancelled one, a gift received at once", async () => {
    const p = await perfume();
    const target = await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edt, container: "sample", capacityValue: 2, volumeUnit: "ml" });
    const first = await orderTypedTarget({ targetId: target.id, acquisitionMethod: "online_order", orderDate: "2026-09-01" });
    await updateOrderStatus(first.id, "cancelled");
    expect((await getTypedTargets(p.id))[0].state).toBe("wanted");
    const gift = await orderTypedTarget({ targetId: target.id, acquisitionMethod: "gift", status: "received", orderDate: "2026-09-15" });
    expect(gift.perfumeBottleId).toBeTruthy();
    expect(await q(`select variant_id, container, capacity_ml::float as ml from perfume_bottles`)).toEqual([
      { variant_id: p.edt, container: "sample", ml: 2 },
    ]);
    const [view] = await getTypedTargets(p.id);
    expect(view.state).toBe("received");
    expect(view.orders.map((o) => o.status)).toEqual(["received", "cancelled"]);
    // A target with an order in hand stays as a record
    await expect(removeTypedTarget(target.id)).rejects.toThrow("Cancel or return the linked order");
  });

  it("receives a film copy of the target's version, release and medium, in a place of that medium", async () => {
    const f = await film();
    const shelf = await place("Living room");
    const drive = await place("NAS", "digital");
    const target = await createTypedTarget({ kind: "film", workId: f.id, versionId: f.version, releaseId: f.release, medium: "digital", formatLabel: "MKV file" });
    expect((await getTypedTargets(f.id))[0].title).toBe("Restored · France, Home media · Digital, MKV file");
    const order = await orderTypedTarget({ targetId: target.id, acquisitionMethod: "digital_purchase", orderDate: "2026-10-02", destinationLocationId: shelf });
    await expect(updateOrderStatus(order.id, "delivered")).rejects.toThrow("a digital copy goes to a digital location");
    expect(await value(`select count(*)::int from film_holdings`)).toBe(0);
    await q(`update orders set destination_location_id = $1 where id = $2`, [drive, order.id]);
    await updateOrderStatus(order.id, "delivered");
    expect(await q(`select work_id, version_id, release_id, medium, format_label, location_id, status from film_holdings`)).toEqual([
      { work_id: f.id, version_id: f.version, release_id: f.release, medium: "digital", format_label: "MKV file", location_id: drive, status: "held" },
    ]);
  });

  it("buys an object in private hands without touching where it is shown; a museum's object is not for sale", async () => {
    const id = await painting();
    const museum = await value(`insert into venues(name, slug, type) values ('Belvedere', 'belvedere', 'museum') returning id`);
    const owner = await value(`insert into publishing_houses(name, slug) values ('Belvedere Museum', 'belvedere-museum') returning id`);
    await q(`insert into organization_roles(organization_id, role) values ($1, 'museum')`, [owner]);
    const held = await value(
      `insert into art_objects(work_id, kind, ownership, owner_organization_id) values ($1, 'original', 'institutional', $2) returning id`,
      [id, owner],
    );
    const study = await value(
      `insert into art_objects(work_id, kind, label, ownership, owner_label) values ($1, 'version', 'Study', 'private', 'Private collection, Vienna') returning id`,
      [id],
    );
    // On loan to a museum: custody, not a purchase
    await q(
      `insert into art_object_whereabouts(object_id, place_kind, venue_id, custody, certainty) values ($1, 'venue', $2, 'temporary_loan', 'confirmed')`,
      [study, museum],
    );
    const custodyBefore = await q(`select * from art_object_whereabouts order by id`);
    expect(await value(`select count(*)::int from orders`)).toBe(0);
    await expect(createTypedTarget({ kind: "painting", workId: id, objectId: held, reproduction: false })).rejects.toThrow(
      "This object belongs to an institution",
    );
    const buy = await createTypedTarget({ kind: "painting", workId: id, objectId: study, reproduction: false });
    const print = await createTypedTarget({ kind: "painting", workId: id, objectId: held, reproduction: true });
    expect((await getTypedTargets(id)).map((t) => t.title)).toEqual(["Version: Study", "Reproduction of the original"]);
    const hall = await place("Hall");
    await orderTypedTarget({ targetId: buy.id, acquisitionMethod: "auction", status: "won", orderDate: "2026-10-03" });
    expect(await value(`select ownership from art_objects where id = $1`, [study])).toBe("private");
    const bought = await orderTypedTarget({ targetId: print.id, acquisitionMethod: "in_store_purchase", status: "purchased", orderDate: "2026-10-03", destinationLocationId: hall });
    expect(await q(`select kind, reproduces_object_id, ownership, holding_status, location_id from art_objects where id = $1`, [bought.artObjectId])).toEqual([
      { kind: "reproduction", reproduces_object_id: held, ownership: "personal", holding_status: "held", location_id: hall },
    ]);
    const auction = await value(`select id from orders where acquisition_target_id = $1`, [buy.id]);
    for (const status of ["shipped", "delivered"] as const) await updateOrderStatus(auction, status);
    expect(await q(`select ownership, owner_label, holding_status from art_objects where id = $1`, [study])).toEqual([
      { ownership: "personal", owner_label: null, holding_status: "held" },
    ]);
    expect(await q(`select * from art_object_whereabouts order by id`)).toEqual(custodyBefore);
    expect(await value(`select ownership from art_objects where id = $1`, [held])).toBe("institutional");
  });

  it("never orders from a retailer listing, and keeps each currency's and each kind's totals apart", async () => {
    const book = await work("book", "Molloy");
    await createOrder({ workId: book, acquisitionMethod: "online_order", orderDate: "2026-10-01", totalCost: "20.00", currency: "EUR" });
    const before = await getProvenanceStats({ kind: "book" });
    const p = await perfume();
    const shop = await value(`insert into publishing_houses(name, slug) values ('Shop', 'shop') returning id`);
    await q(`insert into organization_roles(organization_id, role) values ($1, 'retailer')`, [shop]);
    await q(`insert into perfume_retailer_links(work_id, organization_id, url) values ($1, $2, 'https://shop.example/shalimar')`, [p.id, shop]);
    const target = await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 100, volumeUnit: "ml" });
    expect((await getTypedTargets(p.id))[0]).toMatchObject({ state: "wanted", orders: [] });
    await orderTypedTarget({ targetId: target.id, acquisitionMethod: "in_store_purchase", status: "purchased", orderDate: "2026-10-02", totalCost: "150.00", currency: "GBP" });
    expect(await getProvenanceStats({ kind: "book" })).toEqual(before);
    expect((await getProvenanceStats()).spentByCurrency).toEqual([
      { currency: "EUR", total: "20.00" },
      { currency: "GBP", total: "150.00" },
    ]);
    expect((await getProvenanceStats({ kind: "perfume" })).spentByCurrency).toEqual([{ currency: "GBP", total: "150.00" }]);
  });
  const DUPLICATE = "Both records have the same active acquisition target";
  async function merge(sourceId: string, targetId: string) {
    const p = await previewMerge("works", sourceId, targetId);
    return executeMerge({
      entity: "works",
      sourceId,
      targetId,
      fingerprint: p.fingerprint,
      choices: Object.fromEntries(p.fields.filter((f) => f.conflict).map((f) => [f.key, "target"])),
    });
  }
  async function filmWith(title: string, ...labels: string[]) {
    const id = await work("film", title);
    await q(`insert into film_details(work_id) values ($1)`, [id]);
    const versions: string[] = [];
    for (const [i, label] of labels.entries())
      versions.push(await value(`insert into film_versions(work_id, label, sort_order) values ($1, $2, $3) returning id`, [id, label, i]));
    return { id, versions };
  }
  const wantFilm = (workId: string, versionId: string) => createTypedTarget({ kind: "film", workId, versionId, medium: "digital" });

  it("merges films and perfumes that want their own versions and formulations", async () => {
    const blockers = async (a: string, b: string) => (await previewMerge("works", a, b)).blockers.filter((m) => m.startsWith(DUPLICATE));
    // Two films that each want their own version
    const a = await filmWith("Nosferatu", "Restored");
    const b = await filmWith("Nosferatu", "Theatrical");
    await wantFilm(a.id, a.versions[0]);
    await wantFilm(b.id, b.versions[0]);
    expect(await blockers(a.id, b.id)).toEqual([]);
    // A film that wants two of its versions, merged into another film
    const c = await filmWith("Faust", "Silent", "Scored");
    const d = await filmWith("Faust", "Tinted");
    for (const v of c.versions) await wantFilm(c.id, v);
    expect(await blockers(c.id, d.id)).toEqual([]);
    expect(await blockers(d.id, c.id)).toEqual([]);
    // Two perfumes that each want their own formulation and size
    const p = await perfume();
    const r = await perfume();
    await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 50, volumeUnit: "ml" });
    await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 100, volumeUnit: "ml" });
    await createTypedTarget({ kind: "perfume", workId: r.id, variantId: r.edt, container: "decant", capacityValue: 10, volumeUnit: "ml" });
    expect(await blockers(p.id, r.id)).toEqual([]);
  });

  it("moves a wanted version with its open order to the kept film", async () => {
    const a = await filmWith("Vampyr", "Restored");
    const b = await filmWith("Vampyr", "Theatrical");
    const target = await wantFilm(a.id, a.versions[0]);
    await wantFilm(b.id, b.versions[0]);
    const order = await orderTypedTarget({ targetId: target.id, acquisitionMethod: "online_order", status: "placed", orderDate: "2026-10-01" });
    await merge(a.id, b.id);
    expect(await q(`select work_id, film_version_id from acquisition_targets where id = $1`, [target.id])).toEqual([
      { work_id: b.id, film_version_id: a.versions[0] },
    ]);
    expect(await value(`select work_id from film_versions where id = $1`, [a.versions[0]])).toBe(b.id);
    expect(await q(`select work_id, acquisition_target_id, status from orders where id = $1`, [order.id])).toEqual([
      { work_id: b.id, acquisition_target_id: target.id, status: "placed" },
    ]);
    expect((await getTypedTargets(b.id)).map((t) => [t.title, t.state])).toEqual([
      ["Restored · Digital", "on_order"],
      ["Theatrical · Digital", "wanted"],
    ]);
  });

  it("deletes a formulation, version or object that was removed from the Wanted list", async () => {
    const p = await perfume();
    const bottle = await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 50, volumeUnit: "ml" });
    await expect(deletePerfumeVariant(p.edp)).rejects.toThrow("This formulation is on your Wanted list. Remove it from the list first");
    await removeTypedTarget(bottle.id);
    await deletePerfumeVariant(p.edp);
    expect(await value<number>(`select count(*)::int from acquisition_targets where id = $1`, [bottle.id])).toBe(0);

    const f = await film();
    const copy = await createTypedTarget({ kind: "film", workId: f.id, versionId: f.version, releaseId: f.release, medium: "digital" });
    await removeTypedTarget(copy.id);
    await deleteFilmVersion(f.version);
    expect(await value<number>(`select count(*)::int from film_versions`)).toBe(0);

    const id = await painting();
    const original = await value(`insert into art_objects(work_id, kind, ownership) values ($1, 'original', 'private') returning id`, [id]);
    const buy = await createTypedTarget({ kind: "painting", workId: id, objectId: original, reproduction: false });
    const print = await createTypedTarget({ kind: "painting", workId: id, objectId: original, reproduction: true });
    await removeTypedTarget(buy.id);
    await expect(deleteArtObject(original)).rejects.toThrow("This object is on your Wanted list");
    await removeTypedTarget(print.id);
    await deleteArtObject(original);
    expect(await value<number>(`select count(*)::int from acquisition_targets`)).toBe(0);
  });

  it("keeps a formulation an order names, and says so", async () => {
    const p = await perfume();
    const target = await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edt, container: "sample", capacityValue: 2, volumeUnit: "ml" });
    const order = await orderTypedTarget({ targetId: target.id, acquisitionMethod: "online_order", orderDate: "2026-09-01" });
    await updateOrderStatus(order.id, "cancelled");
    await removeTypedTarget(target.id);
    await expect(deletePerfumeVariant(p.edt)).rejects.toThrow(
      "An order on your Wanted list names this formulation. Delete the order first, or keep the formulation",
    );
    expect(await value<number>(`select count(*)::int from perfume_variants where id = $1`, [p.edt])).toBe(1);
  });

  it("names the order, not the list, for a wish that was received", async () => {
    const id = await painting();
    const study = await value(`insert into art_objects(work_id, kind, label, ownership) values ($1, 'version', 'Study', 'private') returning id`, [id]);
    const buy = await createTypedTarget({ kind: "painting", workId: id, objectId: study, reproduction: false });
    const order = await orderTypedTarget({ targetId: buy.id, acquisitionMethod: "auction", status: "won", orderDate: "2026-10-03" });
    for (const status of ["shipped", "delivered"] as const) await updateOrderStatus(order.id, status);
    expect((await getTypedTargets(id))[0].state).toBe("received");
    await expect(deleteArtObject(study)).rejects.toThrow("An order on your Wanted list names this object. Delete the order first, or keep the object");
  });

  it("deletes a film, perfume or painting that has wishes and orders", async () => {
    const f = await film();
    const wanted = await createTypedTarget({ kind: "film", workId: f.id, versionId: f.version, releaseId: f.release, medium: "digital" });
    await orderTypedTarget({ targetId: wanted.id, acquisitionMethod: "online_order", orderDate: "2026-09-01" });
    await deleteFilm(f.id);
    const p = await perfume();
    await createTypedTarget({ kind: "perfume", workId: p.id, variantId: p.edp, container: "bottle", capacityValue: 50, volumeUnit: "ml" });
    await deletePerfume(p.id);
    const id = await painting();
    const original = await value(`insert into art_objects(work_id, kind, ownership) values ($1, 'original', 'private') returning id`, [id]);
    await createTypedTarget({ kind: "painting", workId: id, objectId: original, reproduction: true });
    await createTypedTarget({ kind: "painting", workId: id, objectId: original, reproduction: false });
    await deletePainting(id);
    expect(await value<number>(`select count(*)::int from acquisition_targets`)).toBe(0);
    expect(await value<number>(`select count(*)::int from works`)).toBe(0);
  });
});
