import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { dateColumns } from "@/lib/catalogue/dates";
import {
  perfumeVariantSchema,
  perfumeBottleSchema,
} from "@/lib/catalogue/perfumes";

const url = process.env.DURTAL_PERFUME_MODEL_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln356_test"
  )
    throw new Error("Perfume model tests require disposable local sln356_test");
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
import {
  loadPerfumeHoldings,
  loadPerfumeClassification,
  loadPerfumePerfumers,
} from "@/lib/catalogue/perfume-model";
import { recordSourceObservation } from "@/lib/actions/catalogue-provenance";
import {
  saveOrganization,
  getOrganizationMergePreview,
  mergeOrganizations,
} from "@/lib/actions/organizations";
import {
  createPerson,
  deletePerson,
  getPersonMergePreview,
  mergePeople,
} from "@/lib/actions/people";

describe.skipIf(!url)("perfume relational model", () => {
  const c = client!;
  let workId: string, bookId: string, otherId: string, variantId: string;
  let family: Record<string, string>, items: Record<string, string>;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, locations, custom_taxonomy_items, catalogue_dates, harmonization_operations, harmonization_redirects cascade`;
    const [book] =
      await c`insert into works(title) values ('Book') returning id`;
    bookId = book.id;
    const perfumes =
      await c`insert into works(title,kind,original_language) values ('Fragrance','perfume',null),('Other fragrance','perfume',null) returning id`;
    workId = perfumes[0].id;
    otherId = perfumes[1].id;
    await c`insert into perfume_details(work_id) values (${workId}),(${otherId})`;
    const [variant] = await testDb!
      .insert(schema.perfumeVariants)
      .values(perfumeVariantSchema.parse({ workId }))
      .returning();
    variantId = variant.id;
    family = Object.fromEntries(
      (
        await c`select id,slug from taxonomy_families where slug like 'perfume-%'`
      ).map((r) => [r.slug, r.id]),
    );
    items = {};
    for (const [key, familySlug] of [
      ["rose", "perfume-notes"],
      ["wood", "perfume-notes"],
      ["amber", "perfume-families"],
      ["fresh", "perfume-accords"],
    ]) {
      const [item] =
        await c`insert into custom_taxonomy_items(family_id,name,slug) values (${family[familySlug]},${key},${key}) returning id`;
      items[key] = item.id;
    }
  });
  it("supports unknown formulations and multiple concentrations without a dummy edition", async () => {
    const unknown = await testDb!.query.perfumeVariants.findFirst({
      where: eq(schema.perfumeVariants.id, variantId),
    });
    expect(unknown).toMatchObject({
      concentration: null,
      formulationLabel: null,
    });
    for (const concentration of ["eau_de_parfum", "extrait"] as const)
      await testDb!
        .insert(schema.perfumeVariants)
        .values(perfumeVariantSchema.parse({ workId, concentration }));
    const details = await testDb!.query.perfumeDetails.findFirst({
      where: eq(schema.perfumeDetails.workId, workId),
      with: {
        variants: {
          with: { bottles: true, notes: true, overrides: true, taxa: true },
        },
        organizations: true,
        notes: true,
      },
    });
    expect(details?.variants).toHaveLength(3);
    expect(await c`select id from editions`).toHaveLength(0);
    expect(await c`select id from instances`).toHaveLength(0);
    await expect(
      c`insert into perfume_variants(work_id) values (${workId})`,
    ).rejects.toThrow("unique");
  });
  it("retains formulation-specific perfumers, unknown attribution and stable credits through person merges", async () => {
    const original = await createPerson({
      name: "Original perfumer",
      domains: ["perfume"],
    });
    const reformulator = await createPerson({
      name: "Reformulator",
      domains: ["perfume"],
    });
    const survivor = await createPerson({
      name: "Canonical reformulator",
      domains: ["perfume"],
    });
    await c`insert into work_credits(work_id,person_id,role_id,attribution) values (${workId},${original.id},'perfume.perfumer','confirmed')`;
    expect(await loadPerfumePerfumers(workId, variantId)).toEqual([
      expect.objectContaining({ personId: original.id, inherited: true }),
    ]);
    await expect(
      c`insert into perfume_variant_perfumers(variant_id,person_id) values (${variantId},${reformulator.id})`,
    ).rejects.toThrow("override");
    await c`update perfume_variants set perfumers_override=true where id=${variantId}`;
    expect(await loadPerfumePerfumers(workId, variantId)).toEqual([]);
    const [credit] =
      await c`insert into perfume_variant_perfumers(variant_id,person_id,credited_as,attribution) values (${variantId},${reformulator.id},'Credited name','attributed') returning id`;
    await c`insert into perfume_variant_perfumers(variant_id,attribution,sort_order) values (${variantId},'unknown',1)`;
    expect(await loadPerfumePerfumers(workId, variantId)).toEqual([
      expect.objectContaining({
        personId: reformulator.id,
        inherited: false,
        creditedAs: "Credited name",
      }),
      expect.objectContaining({ personId: null, attribution: "unknown" }),
    ]);
    await expect(deletePerson(reformulator.id)).rejects.toThrow();
    await expect(
      c`update perfume_variants set perfumers_override=false where id=${variantId}`,
    ).rejects.toThrow("Remove formulation perfumers");
    const preview = await getPersonMergePreview(reformulator.id, survivor.id);
    await mergePeople({
      sourceId: reformulator.id,
      targetId: survivor.id,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(
        preview.fields
          .filter((f) => f.conflict)
          .map((f) => [f.key, "target" as const]),
      ),
    });
    expect((await loadPerfumePerfumers(workId, variantId))[0]).toMatchObject({
      id: credit.id,
      personId: survivor.id,
      creditedAs: "Credited name",
      attribution: "attributed",
    });
    expect((await loadPerfumePerfumers(workId))[0].personId).toBe(original.id);
  });
  it("rejects cross-domain profiles, invalid parent moves and fictional language defaults", async () => {
    await expect(
      c`insert into perfume_details(work_id) values (${bookId})`,
    ).rejects.toThrow("perfume work");
    await expect(
      c`insert into perfume_variants(work_id) values (${bookId})`,
    ).rejects.toThrow();
    await expect(
      c`update perfume_variants set work_id=${otherId} where id=${variantId}`,
    ).rejects.toThrow("identity");
    await expect(
      c`insert into works(title,kind) values ('No fictional language','perfume')`,
    ).rejects.toThrow("language_domain");
    await expect(
      c`update works set original_language=null where id=${bookId}`,
    ).rejects.toThrow("language_domain");
    expect(
      (await c`select original_language from works where id=${workId}`)[0]
        .original_language,
    ).toBeNull();
  });
  it("supports sourced dated reformulation without modifying earlier date values", async () => {
    const [start] = await testDb!
      .insert(schema.catalogueDates)
      .values(
        dateColumns({
          precision: "year",
          start: { year: 1990 },
          approximate: true,
        }),
      )
      .returning();
    const [end] = await testDb!
      .insert(schema.catalogueDates)
      .values(
        dateColumns({
          precision: "range",
          start: { year: 2000 },
          end: { year: 2002 },
        }),
      )
      .returning();
    const source = await recordSourceObservation({
      owner: { kind: "perfume", id: workId },
      provider: "archive",
      retrievedAt: new Date("2026-01-01"),
      payload: { formulation: "circa 1990" },
    });
    await testDb!.insert(schema.perfumeVariants).values(
      perfumeVariantSchema.parse({
        workId,
        formulationLabel: "Circa 1990",
        releaseDateId: start.id,
        discontinuedDateId: end.id,
        sourceRecordId: source.id,
      }),
    );
    await expect(
      c`update perfume_details set release_date_id=${end.id},discontinued_date_id=${start.id} where work_id=${workId}`,
    ).rejects.toThrow("end date");
    await expect(
      c`update catalogue_dates set start_year=2100 where id=${start.id}`,
    ).rejects.toThrow("immutable");
    await expect(
      c`update perfume_details set source_record_id=${source.id} where work_id=${otherId}`,
    ).rejects.toThrow("source must belong");
  });
  it("retains ordered top/heart/base notes, per-family inheritance and empty replacements", async () => {
    await c`insert into perfume_notes(work_id,item_id,position,sort_order) values (${workId},${items.rose},'top',0),(${workId},${items.rose},'heart',0),(${workId},${items.wood},'base',0)`;
    await c`insert into custom_taxonomy_item_works(work_id,item_id) values (${workId},${items.amber}),(${workId},${items.fresh})`;
    const inherited = await loadPerfumeClassification(workId, variantId);
    expect(inherited).toHaveLength(5);
    expect(inherited.every((r) => r.inherited)).toBe(true);
    expect(
      inherited
        .filter((r) => r.familySlug === "perfume-notes")
        .map((r) => r.position),
    ).toEqual(["top", "heart", "base"]);
    await c`insert into perfume_variant_overrides(variant_id,family_id) values (${variantId},${family["perfume-notes"]})`;
    expect(await loadPerfumeClassification(workId, variantId)).toHaveLength(2);
    await c`insert into perfume_variant_notes(variant_id,item_id,position) values (${variantId},${items.wood},'heart')`;
    const selected = await loadPerfumeClassification(workId, variantId);
    expect(selected).toHaveLength(3);
    expect(selected.find((r) => r.position)).toMatchObject({
      itemId: items.wood,
      position: "heart",
      inherited: false,
    });
    expect(await loadPerfumeClassification(workId)).toHaveLength(5);
    await expect(loadPerfumeClassification(otherId, variantId)).rejects.toThrow(
      "does not belong",
    );
  });
  it("enforces vocabulary and scope boundaries, protecting used items and overrides", async () => {
    await expect(
      c`insert into perfume_notes(work_id,item_id) values (${workId},${items.amber})`,
    ).rejects.toThrow("note vocabulary");
    await expect(
      c`insert into custom_taxonomy_item_works(work_id,item_id) values (${workId},${items.rose})`,
    ).rejects.toThrow("positioned");
    await expect(
      c`insert into perfume_variant_notes(variant_id,item_id) values (${variantId},${items.rose})`,
    ).rejects.toThrow("override");
    await c`insert into perfume_variant_overrides(variant_id,family_id) values (${variantId},${family["perfume-notes"]}),(${variantId},${family["perfume-families"]})`;
    await c`insert into perfume_variant_notes(variant_id,item_id) values (${variantId},${items.rose})`;
    await c`insert into perfume_variant_taxa(variant_id,item_id) values (${variantId},${items.amber})`;
    await expect(
      c`insert into perfume_variant_taxa(variant_id,item_id) values (${variantId},${items.rose})`,
    ).rejects.toThrow("positioned");
    await expect(
      c`delete from taxonomy_applicability where family_id=${family["perfume-families"]} and kind='perfume' and level='perfume_variant'`,
    ).rejects.toThrow("scope");
    await expect(
      c`delete from perfume_variant_overrides where variant_id=${variantId} and family_id=${family["perfume-notes"]}`,
    ).rejects.toThrow("assignments");
    await expect(
      c`delete from custom_taxonomy_items where id=${items.rose}`,
    ).rejects.toThrow();
    const [wrong] =
      await c`select id from taxonomy_families where slug='film-genres'`;
    await expect(
      c`insert into perfume_variant_overrides(variant_id,family_id) values (${variantId},${wrong.id})`,
    ).rejects.toThrow("does not apply");
    await c`delete from perfume_variants where id=${variantId}`;
    expect(await c`select * from perfume_variant_notes`).toHaveLength(0);
  });
  it("requires explicit house/manufacturer roles and preserves them through organization edits and merges", async () => {
    const house = (await saveOrganization({
      name: "Maison",
      roles: ["perfume_house", "brand"],
    }))!;
    const survivor = (await saveOrganization({
      name: "Maison canonical",
      roles: ["perfume_house"],
    }))!;
    await c`insert into perfume_organizations(work_id,organization_id,role) values (${workId},${house.id},'perfume_house')`;
    await expect(
      c`insert into perfume_organizations(work_id,organization_id,role) values (${workId},${house.id},'manufacturer')`,
    ).rejects.toThrow("required manufacturer role");
    await saveOrganization(
      { name: "Maison", roles: ["perfume_house", "brand"] },
      house.id,
    );
    await expect(
      saveOrganization({ name: "Maison", roles: ["brand"] }, house.id),
    ).rejects.toThrow();
    const preview = await getOrganizationMergePreview(house.id, survivor.id);
    await mergeOrganizations({
      sourceId: house.id,
      targetId: survivor.id,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(
        preview.fields
          .filter((f) => f.conflict)
          .map((f) => [f.key, "target" as const]),
      ),
    });
    expect(
      (await c`select organization_id from perfume_organizations`)[0]
        .organization_id,
    ).toBe(survivor.id);
  });
  it("stores bottle sizes as containers and converts liter samples without losing precision", async () => {
    for (const data of [
      {
        container: "bottle" as const,
        capacityValue: 100,
        volumeUnit: "ml" as const,
        remainingMl: 80,
      },
      {
        container: "sample" as const,
        capacityValue: 0.0005,
        volumeUnit: "l" as const,
        remainingMl: 0.5,
      },
      {
        container: "decant" as const,
        capacityValue: 5,
        volumeUnit: "ml" as const,
        remainingMl: null,
      },
    ])
      await testDb!
        .insert(schema.perfumeBottles)
        .values(perfumeBottleSchema.parse({ variantId, ...data }));
    const rows = await testDb!.select().from(schema.perfumeBottles);
    expect(rows.find((r) => r.container === "sample")).toMatchObject({
      capacityValue: 0.0005,
      capacityMl: 0.5,
    });
    expect(await loadPerfumeHoldings(workId)).toMatchObject({
      personallyOwned: true,
      activeCount: 3,
      bottles: 1,
      samples: 1,
      decants: 1,
      knownRemainingMl: 80.5,
      unknownRemainingCount: 1,
    });
    expect(await loadPerfumeHoldings(otherId)).toMatchObject({
      personallyOwned: false,
    });
    await c`update perfume_bottles set status='disposed' where container='sample'`;
    expect(await loadPerfumeHoldings(workId)).toMatchObject({
      activeCount: 2,
      disposedCount: 1,
      knownRemainingMl: 80,
    });
    expect(
      await c`select id from perfume_variants where work_id=${workId}`,
    ).toHaveLength(1);
    await expect(
      c`delete from perfume_variants where id=${variantId}`,
    ).rejects.toThrow();
    await expect(c`delete from works where id=${workId}`).rejects.toThrow();
  });
  it("rejects invalid quantities, currencies and cross-domain container parents", async () => {
    for (const values of [
      {
        variant_id: variantId,
        capacity_value: 0,
        remaining_ml: null,
        volume_unit: "ml",
        container: "sample",
      },
      {
        variant_id: variantId,
        capacity_value: 1,
        remaining_ml: 2,
        volume_unit: "ml",
        container: "sample",
      },
      {
        variant_id: variantId,
        capacity_value: 1,
        remaining_ml: -1,
        volume_unit: "ml",
        container: "sample",
      },
      {
        variant_id: variantId,
        capacity_value: 1,
        remaining_ml: null,
        volume_unit: "oz",
        container: "sample",
      },
      {
        variant_id: bookId,
        capacity_value: 1,
        remaining_ml: null,
        volume_unit: "ml",
        container: "sample",
      },
    ])
      await expect(
        c`insert into perfume_bottles ${c(values)}`,
      ).rejects.toThrow();
    await expect(
      c`insert into perfume_bottles(variant_id,container,capacity_value,volume_unit,acquisition_price) values (${variantId},'bottle',100,'ml',10)`,
    ).rejects.toThrow("price_check");
  });
  it("protects physical storage, supplier identity and partial acquisition/disposition dates", async () => {
    const supplier = (await saveOrganization({
      name: "Retailer",
      roles: ["retailer"],
    }))!;
    const [venue] =
      await c`insert into venues(name,type) values ('Online shop','online_store') returning id`;
    const [physical] =
      await c`insert into locations(name,type) values ('Home','physical') returning id`;
    const [digital] =
      await c`insert into locations(name,type) values ('Files','digital') returning id`;
    const [sublocation] =
      await c`insert into sub_locations(name,location_id) values ('Shelf',${physical.id}) returning id`;
    const [date] = await testDb!
      .insert(schema.catalogueDates)
      .values(
        dateColumns({ precision: "month", start: { year: 2026, month: 1 } }),
      )
      .returning();
    await testDb!.insert(schema.perfumeBottles).values(
      perfumeBottleSchema.parse({
        variantId,
        container: "bottle",
        capacityValue: 100,
        volumeUnit: "ml",
        acquisitionDateId: date.id,
        supplierId: supplier.id,
        venueId: venue.id,
        acquisitionPrice: 95,
        acquisitionCurrency: "EUR",
        locationId: physical.id,
        subLocationId: sublocation.id,
      }),
    );
    await expect(
      c`update perfume_bottles set location_id=${digital.id}`,
    ).rejects.toThrow("physical");
    await expect(
      c`update locations set type='digital' where id=${physical.id}`,
    ).rejects.toThrow("containers");
    await expect(
      c`update sub_locations set location_id=${digital.id} where id=${sublocation.id}`,
    ).rejects.toThrow("Move perfume");
    await expect(
      c`delete from organization_roles where organization_id=${supplier.id}`,
    ).rejects.toThrow("in use");
    await expect(c`delete from venues where id=${venue.id}`).rejects.toThrow();
    await expect(
      c`update perfume_bottles set disposition_date_id=${date.id}`,
    ).rejects.toThrow("disposition_check");
    await c`update perfume_bottles set status='disposed',disposition_date_id=${date.id},disposition_reason='Finished sample'`;
    expect(await loadPerfumeHoldings(workId)).toMatchObject({
      personallyOwned: false,
      disposedCount: 1,
    });
  });
  it("allows independent perfume creation to roll back without leaving a partial profile", async () => {
    const id = randomUUID();
    await expect(
      c.begin(async (tx) => {
        await tx.unsafe(
          "insert into works(id,title,kind,original_language) values ($1,'Rollback perfume','perfume',null)",
          [id],
        );
        await tx.unsafe("insert into perfume_details(work_id) values ($1)", [
          id,
        ]);
        await tx.unsafe(
          "insert into perfume_variants(work_id,concentration) values ($1,'invalid concentration')",
          [id],
        );
      }),
    ).rejects.toThrow();
    expect(await c`select id from works where id=${id}`).toHaveLength(0);
    expect(
      await c`select work_id from perfume_details where work_id=${id}`,
    ).toHaveLength(0);
  });
});
