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
import * as schema from "@/lib/db/schema";
import {
  dateColumns,
  normalizeCatalogueDate,
  type CatalogueDateInput,
} from "@/lib/catalogue/dates";
import type { SourceOwner } from "@/lib/catalogue/provenance";

const url = process.env.DURTAL_CATALOGUE_PROVENANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln355_test"
  )
    throw new Error(
      "Catalogue provenance tests require disposable local sln355_test",
    );
}
const client = url ? postgres(url, { max: 6, onnotice: () => {} }) : null;
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
  registerCatalogueIdentifier,
  recordSourceObservation,
  refreshSourceObservation,
  reviewSourceObservation,
  getCatalogueProvenance,
} from "@/lib/actions/catalogue-provenance";
import { previewMerge, executeMerge } from "@/lib/harmonization/merge";

describe.skipIf(!url)("typed provenance and uncertain dates", () => {
  const c = client!;
  let owners: Record<SourceOwner["kind"], SourceOwner>;
  const retrievedAt = new Date("2026-01-01T12:00:00Z");
  const refreshedAt = new Date("2026-02-01T12:00:00Z");
  const source = (owner = owners.book) => ({
    owner,
    provider: "museum.test",
    url: "https://example.com/collection/42",
    attribution: "Collection catalogue",
    retrievedAt,
    payload: { title: "Source title", date: "c. 1900" },
  });
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    // Test future domains only inside this explicitly guarded disposable DB.
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, publishing_houses, venues, catalogue_dates, harmonization_operations, harmonization_redirects cascade`;
    owners = {} as typeof owners;
    for (const kind of ["book", "film", "perfume", "painting"] as const) {
      const [row] =
        await c`insert into works(title,slug,kind) values (${kind},${kind},${kind}) returning id`;
      owners[kind] = { kind, id: row.id };
    }
    const [edition] =
      await c`insert into editions(work_id,title) values (${owners.book.id},'Edition') returning id`;
    const [person] =
      await c`insert into authors(name,slug) values ('Person','person') returning id`;
    const [org] =
      await c`insert into publishing_houses(name,slug,kind) values ('Museum','museum',null) returning id`;
    const [venue] =
      await c`insert into venues(name,type) values ('Gallery','gallery') returning id`;
    owners.edition = { kind: "edition", id: edition.id };
    owners.person = { kind: "person", id: person.id };
    owners.organization = { kind: "organization", id: org.id };
    owners.venue = { kind: "venue", id: venue.id };
  });
  it("namespaces identical external IDs by provider and entity kind, never by title", async () => {
    const input = {
      owner: owners.book,
      provider: "provider.one",
      externalId: "42",
    };
    const first = await registerCatalogueIdentifier(input);
    expect((await registerCatalogueIdentifier(input)).id).toBe(first.id);
    for (const owner of Object.values(owners))
      await registerCatalogueIdentifier({ ...input, owner });
    await registerCatalogueIdentifier({ ...input, provider: "provider.two" });
    expect(
      (await c`select count(*)::int as count from catalogue_identifiers`)[0]
        .count,
    ).toBe(9);
    const [other] =
      await c`insert into works(title) values ('book') returning id`;
    await expect(
      registerCatalogueIdentifier({
        ...input,
        owner: { kind: "book", id: other.id },
      }),
    ).rejects.toThrow("already belongs");
    expect(
      (await getCatalogueProvenance({ owner: owners.book })).identifiers.map(
        (r) => r.id,
      ),
    ).toContain(first.id);
  });
  it("serializes concurrent identifier claims and rejects wrong or absent owners", async () => {
    const [other] =
      await c`insert into works(title) values ('Other') returning id`;
    const outcomes = await Promise.allSettled(
      [owners.book, { kind: "book" as const, id: other.id }].map((owner) =>
        registerCatalogueIdentifier({
          owner,
          provider: "claims",
          externalId: "unique",
        }),
      ),
    );
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      registerCatalogueIdentifier({
        owner: { kind: "film", id: owners.book.id },
        provider: "claims",
        externalId: "wrong-kind",
      }),
    ).rejects.toThrow();
    await expect(
      registerCatalogueIdentifier({
        owner: { kind: "person", id: randomUUID() },
        provider: "claims",
        externalId: "missing",
      }),
    ).rejects.toThrow();
    await expect(
      c`insert into catalogue_identifiers(entity_kind,person_id,venue_id,provider,external_id) values ('person',${owners.person.id},${owners.venue.id},'claims','two')`,
    ).rejects.toThrow();
  });
  it("keeps immutable history and review locks without altering canonical metadata", async () => {
    const initial = await recordSourceObservation(source());
    const reviewed = await reviewSourceObservation({
      id: initial.id,
      expectedRevision: 0,
      reviewStatus: "accepted",
      locked: true,
      verifiedAt: refreshedAt,
    });
    expect(reviewed.revision).toBe(1);
    await expect(
      refreshSourceObservation({
        id: reviewed.id,
        expectedRevision: 1,
        retrievedAt: refreshedAt,
        payload: { title: "Changed" },
      }),
    ).rejects.toThrow();
    await expect(
      reviewSourceObservation({
        id: initial.id,
        expectedRevision: 0,
        reviewStatus: "rejected",
        locked: false,
        verifiedAt: null,
      }),
    ).rejects.toThrow("changed");
    const unlocked = await reviewSourceObservation({
      id: reviewed.id,
      expectedRevision: 1,
      reviewStatus: "accepted",
      locked: false,
      verifiedAt: refreshedAt,
    });
    const next = await refreshSourceObservation({
      id: initial.id,
      expectedRevision: unlocked.revision,
      retrievedAt: refreshedAt,
      payload: { title: "A conflicting title" },
    });
    expect(next).toMatchObject({
      supersedesId: initial.id,
      reviewStatus: "pending",
      locked: false,
      verifiedAt: null,
      attribution: initial.attribution,
    });
    expect(
      (await c`select payload from source_records where id=${initial.id}`)[0]
        .payload,
    ).toEqual(initial.payload);
    expect(
      (await c`select title from works where id=${owners.book.id}`)[0].title,
    ).toBe("book");
    expect(
      (await getCatalogueProvenance({ owner: owners.book, limit: 1 })).hasMore,
    ).toBe(true);
  });
  it("rejects older refreshes, changed provider identity and direct snapshot mutation", async () => {
    const identifier = await registerCatalogueIdentifier({
      owner: owners.book,
      provider: "museum.test",
      externalId: "42",
    });
    const initial = await recordSourceObservation({
      ...source(),
      identifierId: identifier.id,
    });
    await expect(
      refreshSourceObservation({
        id: initial.id,
        expectedRevision: 0,
        retrievedAt: new Date("2025-01-01"),
        payload: {},
      }),
    ).rejects.toThrow();
    await expect(
      c`update source_records set payload='{}' where id=${initial.id}`,
    ).rejects.toThrow("immutable");
    await expect(
      c`update source_records set identifier_id=null where id=${initial.id}`,
    ).rejects.toThrow("immutable");
    await expect(
      c`update catalogue_identifiers set external_id='replacement' where id=${identifier.id}`,
    ).rejects.toThrow("immutable");
    await expect(
      c`update source_records set work_id=${owners.film.id} where id=${initial.id}`,
    ).rejects.toThrow();
    await expect(
      c`update source_records set verified_at='2025-01-01' where id=${initial.id}`,
    ).rejects.toThrow("Verification");
    await expect(
      c`insert into source_records(entity_kind,work_id,provider,retrieved_at,payload,payload_hash,supersedes_id) values ('book',${owners.book.id},'other',${refreshedAt.toISOString()},'{}',${"a".repeat(64)},${initial.id})`,
    ).rejects.toThrow("identity");
    expect(
      (await c`select count(*)::int as count from source_records`)[0].count,
    ).toBe(1);
  });
  it("allows exactly one concurrent successor and checks locks on direct inserts", async () => {
    const initial = await recordSourceObservation(source());
    const results = await Promise.allSettled(
      [1, 2].map((value) =>
        refreshSourceObservation({
          id: initial.id,
          expectedRevision: 0,
          retrievedAt: refreshedAt,
          payload: { value },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const locked = await recordSourceObservation(source(owners.painting));
    await reviewSourceObservation({
      id: locked.id,
      expectedRevision: 0,
      reviewStatus: "accepted",
      locked: true,
      verifiedAt: null,
    });
    await expect(
      c`insert into source_records(entity_kind,work_id,provider,url,retrieved_at,payload,payload_hash,supersedes_id) values ('painting',${owners.painting.id},'museum.test',${locked.url},${refreshedAt.toISOString()},'{}',${"a".repeat(64)},${locked.id})`,
    ).rejects.toThrow("locked");
  });
  it("validates provider references, source links and payloads before accepting observations", async () => {
    const identifier = await registerCatalogueIdentifier({
      owner: owners.person,
      provider: "museum.test",
      externalId: "42",
    });
    await expect(
      recordSourceObservation({ ...source(), identifierId: identifier.id }),
    ).rejects.toThrow();
    await expect(
      recordSourceObservation({
        ...source(owners.person),
        identifierId: identifier.id,
        provider: "another",
      }),
    ).rejects.toThrow();
    await expect(
      recordSourceObservation({
        ...source(),
        url: "https://user:secret@example.com",
      }),
    ).rejects.toThrow();
    await expect(
      recordSourceObservation({
        ...source(),
        payload: { enormous: "a".repeat(1_000_001) },
      }),
    ).rejects.toThrow("1 MB");
    await expect(
      c`insert into source_records(entity_kind,work_id,provider,url,retrieved_at,payload,payload_hash) values ('book',${owners.book.id},'test','https://user:secret@example.com',${retrievedAt.toISOString()},'{}',${"a".repeat(64)})`,
    ).rejects.toThrow("credentials");
    expect(await c`select id from source_records`).toHaveLength(0);
  });
  it("preserves identifiers, locks and source history through an audited person merge", async () => {
    const [other] =
      await c`insert into authors(name,slug) values ('Other person','other') returning id`;
    const identifier = await registerCatalogueIdentifier({
      owner: owners.person,
      provider: "museum.test",
      externalId: "artist",
    });
    const initial = await recordSourceObservation({
      ...source(owners.person),
      identifierId: identifier.id,
    });
    const next = await refreshSourceObservation({
      id: initial.id,
      expectedRevision: 0,
      retrievedAt: refreshedAt,
      payload: { name: "Other person" },
    });
    await reviewSourceObservation({
      id: next.id,
      expectedRevision: 0,
      reviewStatus: "accepted",
      locked: true,
      verifiedAt: refreshedAt,
    });
    const preview = await previewMerge("authors", owners.person.id, other.id);
    const result = await executeMerge({
      entity: "authors",
      sourceId: owners.person.id,
      targetId: other.id,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(
        preview.fields
          .filter((f) => f.conflict)
          .map((f) => [f.key, "target" as const]),
      ),
    });
    const sources = await getCatalogueProvenance({
      owner: { kind: "person", id: other.id },
    });
    expect(sources.identifiers[0]).toMatchObject({
      id: identifier.id,
      personId: other.id,
    });
    expect(sources.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: initial.id, payload: initial.payload }),
        expect.objectContaining({
          id: next.id,
          supersedesId: initial.id,
          locked: true,
        }),
      ]),
    );
    const [audit] =
      await c`select "before" from harmonization_operations where id=${result.operationId}`;
    expect(audit.before.references.source_records).toHaveLength(2);
  });
  it("adapts historic provenance without rewriting provider IDs or manual locks", async () => {
    await c`update works set metadata_source='Historic Provider / mixed',metadata_source_id='raw:work/42' where id=${owners.book.id}`;
    await c`update authors set metadata_source='wikidata',metadata_source_id='Q42' where id=${owners.person.id}`;
    await c`update editions set metadata_source='openlibrary',metadata_last_fetched=${retrievedAt.toISOString()},metadata_locked=true where id=${owners.edition.id}`;
    expect(
      (await getCatalogueProvenance({ owner: owners.book })).legacy,
    ).toMatchObject({
      provider: "Historic Provider / mixed",
      externalId: "raw:work/42",
    });
    expect(
      (await getCatalogueProvenance({ owner: owners.person })).legacy
        ?.externalId,
    ).toBe("Q42");
    expect(
      (await getCatalogueProvenance({ owner: owners.edition })).legacy,
    ).toMatchObject({ provider: "openlibrary", locked: true, retrievedAt });
    expect(await c`select id from catalogue_identifiers`).toHaveLength(0);
  });
  it("cascades only an explicitly deleted owner and supports every typed source owner", async () => {
    for (const owner of Object.values(owners)) {
      const identifier = await registerCatalogueIdentifier({
        owner,
        provider: "test",
        externalId: owner.kind,
      });
      await recordSourceObservation({
        ...source(owner),
        provider: "test",
        identifierId: identifier.id,
      });
    }
    await c`delete from works where id=${owners.book.id}`;
    expect(
      (
        await c`select entity_kind from source_records order by entity_kind`
      ).map((r) => r.entity_kind),
    ).toEqual([
      "film",
      "organization",
      "painting",
      "perfume",
      "person",
      "venue",
    ]);
  });
  it("matches database date bounds to validated components, preserving null precision", async () => {
    const dates: CatalogueDateInput[] = [
      { precision: "unknown", label: "Undated" },
      { precision: "year", start: { year: 1900 } },
      { precision: "month", start: { year: 2000, month: 2 } },
      { precision: "day", start: { year: -1, month: 2, day: 29 } },
      {
        precision: "range",
        start: { year: -100 },
        end: { year: 200, month: 2 },
        approximate: true,
      },
      { precision: "year", start: { year: 999999 } },
    ];
    for (const input of dates) {
      const [row] = await testDb!
        .insert(schema.catalogueDates)
        .values(dateColumns(input))
        .returning();
      const normalized = normalizeCatalogueDate(input);
      expect(row).toMatchObject({
        ...dateColumns(input),
        lowerBound: normalized.lowerBound,
        upperBound: normalized.upperBound,
      });
    }
    for (const values of [
      { precision: "day", start_year: 1900, start_month: 2, start_day: 29 },
      { precision: "range", start_year: 2025, end_year: 2024 },
      { precision: "year", start_year: 0 },
      { precision: "unknown", start_month: 2 },
      { precision: "year", start_year: 1900, end_day: 2 },
      { precision: "day", start_year: 1900 },
    ])
      await expect(
        c`insert into catalogue_dates ${c(values)}`,
      ).rejects.toThrow();
  });
});
