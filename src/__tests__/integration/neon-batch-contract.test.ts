import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { randomUUID } from "node:crypto";
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
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { drizzle as postgresDrizzle } from "drizzle-orm/postgres-js";
import { and, asc, count, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_NEON_BATCH_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln348_batch_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln348_batch_test"
  )
    throw new Error(
      "Neon batch contract tests require disposable local sln348_batch_test",
    );
}
const client = url ? postgres(url, { prepare: false, max: 1, onnotice: () => {} }) : null;
const httpDb = url ? neonDrizzle(neon(url), { schema }) : null;
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: (_, key) => {
        if (!httpDb) throw new Error("Local test database required");
        return Reflect.get(httpDb, key);
      },
    },
  ),
}));
import { atomic } from "@/lib/db/atomic";
import { createReadBatch } from "@/lib/db/read-query-batch";
import { getLibraryStats } from "@/lib/actions/works";
import { getCollectionsForWork } from "@/lib/actions/collections";
import {
  recordSourceObservation,
  refreshSourceObservation,
  reviewSourceObservation,
} from "@/lib/actions/catalogue-provenance";
vi.mock("@/lib/cache", () => ({
  invalidate: vi.fn(),
  cached: (fn: unknown) => fn,
  CACHE_TAGS: {},
}));
import { getWorkCuration, updateWorkCuration } from "@/lib/actions/curation";
vi.mock("@/lib/s3/cleanup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/s3/cleanup")>()),
  deleteUnusedObjects: vi.fn(async () => false),
}));
import {
  addPerfumeBottle,
  createPerfume,
  createPerfumeVariant,
  deletePerfume,
  deletePerfumeBottle,
  updatePerfume,
  updatePerfumeBottle,
} from "@/lib/actions/perfumes";
import {
  createFilm,
  createFilmVersion,
  deleteFilm,
  updateFilm,
  updateFilmVersion,
} from "@/lib/actions/films";
import {
  createArtObject,
  createPainting,
  deletePainting,
  updateArtObject,
} from "@/lib/actions/paintings";
import { getWhereabouts, recordWhereabouts } from "@/lib/actions/whereabouts";
import { createVenue } from "@/lib/actions/venues";

type Query = { query: string; params: (string | null)[] };

describe.skipIf(!url)("production Neon driver batch contract", () => {
  const c = client!;
  const requests: { queries?: Query[]; query?: string }[] = [];
  const previousFetch = neonConfig.fetchFunction;

  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln348_batch_test");
    // Neon has already encoded HTTP parameters as PostgreSQL text. postgres-js
    // normally serializes JS booleans with `value === true`; applying it again
    // would turn the valid wire value "true" into false.
    c.options.serializers[16] = (value: unknown) =>
      typeof value === "boolean" ? (value ? "t" : "f") : String(value);
    // JSON parameters arrive as encoded text too: encoding them again would
    // store a JSON string where Neon stores the object.
    c.options.serializers[114] = c.options.serializers[3802] = (value: unknown) =>
      typeof value === "string" ? value : JSON.stringify(value);
    // Use the actual Neon client and Drizzle driver. Only the HTTP endpoint is
    // replaced: its batch protocol executes against disposable PostgreSQL.
    // This verifies our driver path and SQL atomicity, not the hosted service.
    neonConfig.fetchFunction = async (
      _endpoint: string,
      options?: RequestInit,
    ) => {
      const body = JSON.parse(String(options?.body)) as
        | Query
        | { queries: Query[] };
      requests.push(body);
      try {
        const results = await c.begin(async (tx) => {
          const output = [];
          for (const query of "queries" in body ? body.queries : [body]) {
            const rows = await tx.unsafe(query.query, query.params).values();
            output.push({
              command: rows.command,
              rowCount: rows.count,
              // Statements such as LOCK TABLE return no columns.
              fields: (rows.columns ?? []).map((column) => ({
                name: column.name,
                dataTypeID: column.type,
              })),
              rows: rows.map((row) =>
                row.map((value: unknown) =>
                  value === null
                    ? null
                    : value instanceof Date
                      ? value.toISOString()
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : typeof value === "boolean"
                          ? value
                            ? "t"
                            : "f"
                          : String(value),
                ),
              ),
            });
          }
          return output;
        });
        return Response.json("queries" in body ? { results } : results[0]);
      } catch (error) {
        const pg = error as { message: string; code: string; detail?: string };
        return Response.json(
          { message: pg.message, code: pg.code, detail: pg.detail },
          { status: 400 },
        );
      }
    };
  }, 30000);
  afterAll(async () => {
    neonConfig.fetchFunction = previousFetch;
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln348_batch_test");
    requests.length = 0;
  }, 30000);

  it("maps mixed typed reads exactly like separate queries, including nested, empty and missing results", async () => {
    const id = randomUUID();
    const missingId = randomUUID();
    const createdAt = new Date("2025-02-03T04:05:06.000Z");
    await c`insert into works(id,title,rating,is_favourite,created_at) values (${id},'Mapped book',4.5,true,${createdAt})`;
    await c`insert into editions(work_id,title,page_count) values (${id},'Z edition',240),(${id},'A edition',null)`;
    const queries = () => [
      httpDb!.select({ title: schema.works.title, rating: schema.works.rating, favourite: schema.works.isFavourite, createdAt: schema.works.createdAt })
        .from(schema.works).where(eq(schema.works.id, id)),
      httpDb!.query.works.findMany({
        columns: { title: true, rating: true, isFavourite: true, createdAt: true },
        orderBy: asc(schema.works.title),
        with: { editions: { columns: { title: true, pageCount: true }, orderBy: asc(schema.editions.title) } },
      }),
      httpDb!.query.works.findFirst({ columns: { title: true }, where: eq(schema.works.id, id) }),
      httpDb!.query.works.findFirst({ where: eq(schema.works.id, missingId) }),
      httpDb!.select({ title: schema.works.title }).from(schema.works).where(eq(schema.works.id, missingId)),
      httpDb!.select({ count: count() }).from(schema.works),
      httpDb!.select({ work: { title: schema.works.title }, edition: { title: schema.editions.title } })
        .from(schema.works).leftJoin(schema.editions, and(eq(schema.editions.workId, schema.works.id), eq(schema.editions.title, "Missing edition"))),
    ] as const;
    const expected = await Promise.all(queries());
    requests.length = 0;
    const reads = createReadBatch(httpDb!);
    const actual = await Promise.all(queries().map((query) => reads.read(query)));
    expect(actual).toEqual(expected);
    expect(actual[0]).toEqual([{ title: "Mapped book", rating: 4.5, favourite: true, createdAt }]);
    expect(actual[1]).toEqual([{
      title: "Mapped book", rating: 4.5, isFavourite: true, createdAt,
      editions: [{ title: "A edition", pageCount: null }, { title: "Z edition", pageCount: 240 }],
    }]);
    expect(actual[2]).toEqual({ title: "Mapped book" });
    expect(actual[3]).toBeUndefined();
    expect(actual[4]).toEqual([]);
    expect(actual[5]).toEqual([{ count: 1 }]);
    expect(actual[6]).toEqual([{ work: { title: "Mapped book" }, edition: null }]);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toHaveLength(7);
  });

  it("keeps HTTP batches bounded and returns results in input order", async () => {
    const reads = createReadBatch(httpDb!);
    const result = await Promise.all(Array.from({ length: 17 }, (_, index) =>
      reads.read(httpDb!.select({ index: sql<number>`${index}::int` }).from(sql`(values (1)) as seed(n)`))));
    expect(result).toEqual(Array.from({ length: 17 }, (_, index) => [{ index }]));
    expect(requests.map((request) => request.queries?.length)).toEqual([6, 6, 5]);
  });

  it("settles a failed HTTP chunk without failing another chunk", async () => {
    const reads = createReadBatch(httpDb!);
    const result = await Promise.allSettled(Array.from({ length: 10 }, (_, index) =>
      reads.read(httpDb!.select({ value: index === 0 ? sql<number>`missing_batch_column` : sql<number>`${index}::int` })
        .from(sql`(values (1)) as seed(n)`))));
    expect(result.map((item) => item.status)).toEqual([
      ...Array(5).fill("rejected"), ...Array(5).fill("fulfilled"),
    ]);
    expect(result[5]).toEqual({ status: "fulfilled", value: [{ value: 5 }] });
    expect(requests.map((request) => request.queries?.length)).toEqual([5, 5]);
  });

  it("uses ordinary execution for one read and keeps independent instances separate", async () => {
    expect(await createReadBatch(httpDb!).read(httpDb!.query.works.findMany())).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toBeUndefined();
    requests.length = 0;
    const a = createReadBatch(httpDb!);
    const b = createReadBatch(httpDb!);
    await Promise.all([
      a.read(httpDb!.query.works.findMany()), a.read(httpDb!.query.editions.findMany()),
      b.read(httpDb!.query.works.findMany()), b.read(httpDb!.query.editions.findMany()),
    ]);
    expect(requests.map((request) => request.queries?.length)).toEqual([2, 2]);
  });

  it("awaits each original PostgreSQL builder once when the driver has no batch", async () => {
    await c`insert into works(title) values ('Fallback book')`;
    const localDb = postgresDrizzle(c, { schema });
    const a = localDb.select({ title: schema.works.title }).from(schema.works);
    const b = localDb.query.works.findFirst({ columns: { title: true } });
    const executeA = vi.spyOn(a, "execute");
    const executeB = vi.spyOn(b, "execute");
    const reads = createReadBatch(localDb);
    expect(await Promise.all([reads.read(a), reads.read(b)]))
      .toEqual([[{ title: "Fallback book" }], { title: "Fallback book" }]);
    expect(executeA).toHaveBeenCalledTimes(1);
    expect(executeB).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(0);
  });

  it("keeps a tied top-rated shelf bounded and typed inside the eight-read HTTP batch", async () => {
    const shelf = 10;
    const workId = (i: number) => `88510000-0000-4000-8000-${String(17 - i).padStart(12, "0")}`;
    const editionUpdatedAt = new Date("2025-02-03T04:05:06.000Z");
    const fixtures = new Map<string, { i: number; authorId: string; editionId: string; copyId: string }>();
    const homeId = randomUUID();
    await c`insert into locations(id,name,type) values (${homeId},'Batch shelf home','physical')`;
    for (let i = 1; i <= 16; i++) {
      const id = workId(i), authorId = randomUUID(), editionId = randomUUID(), copyId = randomUUID();
      // Reverse ID insertion makes heap order disagree with the tie-breaker.
      const createdAt = i <= 2 ? "2026-01-02T12:00:00Z" : "2026-01-01T12:00:00Z";
      await c`insert into works(id,title,slug,rating,catalogue_status,created_at,is_favourite)
        values (${id},${`Rated ${i}`},${`neon-tied-rating-${i}`},${i % 3 === 0 ? 5 : 4},'accessioned',${createdAt}::timestamptz,${i % 2 === 0})`;
      await c`insert into authors(id,name) values (${authorId},${`Author ${i}`})`;
      await c`insert into work_authors(work_id,author_id,sort_order) values (${id},${authorId},0)`;
      await c`insert into editions(id,work_id,title,language,publication_year,updated_at)
        values (${editionId},${id},${`Edition ${i}`},'en',${2000 + i},${editionUpdatedAt.toISOString()}::timestamptz)`;
      await c`insert into instances(id,edition_id,location_id,status)
        values (${copyId},${editionId},${homeId},'available')`;
      fixtures.set(id, { i, authorId, editionId, copyId });
    }
    await c`insert into works(title) values ('Unrated')`;
    await c`alter table works drop constraint works_kind_enabled_check`;
    try {
      await c`insert into works(title,kind,rating,original_language) values ('Excluded film','film',5,null)`;
      const expected = [15, 12, 9, 6, 3, 2, 1, 16, 14, 13].map(workId);
      let topQuery: Query | undefined;
      for (let run = 0; run < 2; run++) {
        requests.length = 0;
        const stats = await getLibraryStats({ shelf });
        expect(stats.topRatedWorks.map((row) => row.id)).toEqual(expected);
        expect(stats.topRatedWorks).toHaveLength(shelf);
        expect(stats).toMatchObject({ works: 17, authors: 16, editions: 16, instances: 16 });
        // The existing wanted-ID dependency, then exactly eight independent
        // reads. Top-rated IDs are a subquery, never a ninth HTTP request.
        expect(requests).toHaveLength(2);
        expect(requests[0].queries).toBeUndefined();
        expect(requests[1].queries).toHaveLength(8);
        topQuery = requests[1].queries![5];
        expect(topQuery.query).toMatch(/\bin\s*\(\s*select\b/i);
        for (const row of stats.topRatedWorks) {
          const { i, authorId, editionId, copyId } = fixtures.get(row.id)!;
          expect(row).toMatchObject({
            rating: i % 3 === 0 ? 5 : 4,
            isFavourite: i % 2 === 0,
            createdAt: new Date(i <= 2 ? "2026-01-02T12:00:00Z" : "2026-01-01T12:00:00Z"),
            workAuthors: [{ author: { id: authorId, name: `Author ${i}` } }],
            editions: [{ id: editionId, language: "en", publicationYear: 2000 + i,
              updatedAt: editionUpdatedAt, instances: [{ id: copyId }] }],
            media: [],
          });
        }
      }
      const [explained] = await c.unsafe<{ "QUERY PLAN": { Plan: Record<string, unknown> }[] }[]>(
        `explain (analyze, format json) ${topQuery!.query}`, topQuery!.params,
      );
      const relatedNodes: Record<string, unknown>[] = [];
      const visit = (plan: Record<string, unknown>) => {
        if (["authors", "editions", "instances", "media"].includes(String(plan["Relation Name"]))) relatedNodes.push(plan);
        for (const child of (plan.Plans ?? []) as Record<string, unknown>[]) visit(child);
      };
      visit(explained["QUERY PLAN"][0].Plan);
      expect(relatedNodes.length).toBeGreaterThan(0);
      for (const node of relatedNodes) expect(Number(node["Actual Loops"])).toBeLessThanOrEqual(shelf);
    } finally {
      await c`delete from works where kind = 'film'`;
      await c`alter table works add constraint works_kind_enabled_check check (kind = 'book')`;
    }
  }, 30000);

  it("batches the eight library reads and two independent collection reads", async () => {
    const stats = await getLibraryStats();
    expect(stats.works).toBe(0);
    expect(stats.recentWorks).toEqual([]);
    expect(requests.filter((request) => request.queries).map((request) => request.queries?.length)).toEqual([8]);
    requests.length = 0;
    expect(await getCollectionsForWork(randomUUID())).toEqual([]);
    expect(requests.map((request) => request.queries?.length)).toEqual([2]);
  });

  it("sends one HTTP batch with ordered queries and maps returning rows", async () => {
    const id = randomUUID();
    const results = await atomic((d) => [
      d
        .insert(schema.works)
        .values({ id, title: "Batch book" })
        .returning({ id: schema.works.id, kind: schema.works.kind }),
      d
        .insert(schema.editions)
        .values({ workId: id, title: "Batch edition" })
        .returning({ workId: schema.editions.workId }),
      d.execute(
        sql`select count(*)::int as count from editions where work_id = ${id}`,
      ),
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toHaveLength(3);
    expect(results[0]).toEqual([{ id, kind: "book" }]);
    expect(results[1]).toEqual([{ workId: id }]);
    expect(results[2]).toMatchObject({ rows: [{ count: 1 }] });
    expect(await c`select title from works`).toEqual([{ title: "Batch book" }]);
  });
  it("rolls back earlier writes when a later statement violates a database constraint", async () => {
    const id = randomUUID();
    await expect(
      atomic((d) => [
        d.insert(schema.works).values({ id, title: "Must roll back" }),
        d
          .insert(schema.editions)
          .values({ workId: randomUUID(), title: "Missing parent" }),
        d.insert(schema.works).values({ title: "Must not run" }),
      ]),
    ).rejects.toThrow(/requires an existing book/);
    expect(requests).toHaveLength(1);
    expect(requests[0].queries).toHaveLength(3);
    expect(await c`select id from works`).toHaveLength(0);
    expect(await c`select id from editions`).toHaveLength(0);
  });
  it("does not send empty batches or fall back to unsupported interactive transactions", async () => {
    expect(await atomic(() => [])).toEqual([]);
    expect(requests).toHaveLength(0);
    await expect(httpDb!.transaction(async () => undefined)).rejects.toThrow(
      "No transactions support",
    );
  });
  it("appends source history through Neon batches and preserves locked observations", async () => {
    const [book] =
      await c`insert into works(title) values ('Sourced book') returning id`;
    const observation = await recordSourceObservation({
      owner: { kind: "book", id: book.id },
      provider: "test",
      retrievedAt: new Date("2026-01-01"),
      payload: { title: "Provider title" },
    });
    // Stored as Neon stores it: a JSON object, not a JSON string
    const [stored] =
      await c`select jsonb_typeof(payload) as type from source_records where id=${observation.id}`;
    expect(stored.type).toBe("object");
    requests.length = 0;
    const next = await refreshSourceObservation({
      id: observation.id,
      expectedRevision: 0,
      retrievedAt: new Date("2026-02-01"),
      payload: { title: "Refreshed title" },
    });
    expect(
      requests.filter((r) => r.queries).map((r) => r.queries?.length),
    ).toEqual([3]);
    expect(next).toMatchObject({
      supersedesId: observation.id,
      reviewStatus: "pending",
      payload: { title: "Refreshed title" },
    });
    const reviewed = await reviewSourceObservation({
      id: next.id,
      expectedRevision: 0,
      reviewStatus: "accepted",
      locked: true,
      verifiedAt: new Date("2026-03-01"),
    });
    expect(reviewed.locked).toBe(true);
    expect(
      (
        await c`select locked::text as locked from source_records where id=${reviewed.id}`
      )[0].locked,
    ).toBe("true");
    await expect(
      refreshSourceObservation({
        id: reviewed.id,
        expectedRevision: reviewed.revision,
        retrievedAt: new Date("2026-04-01"),
        payload: {},
      }),
    ).rejects.toThrow();
    expect(await c`select id from source_records`).toHaveLength(2);
  });
  it("keeps curation and recommendation changes atomic through the Neon driver", async () => {
    const [book] =
      await c`insert into works(title,notes) values ('Curated book','Keep this') returning id`;
    const owner = { kind: "book" as const, id: book.id as string };
    const before = (await getWorkCuration(owner))!;
    await expect(
      updateWorkCuration({
        owner,
        fingerprint: before.fingerprint,
        patch: {
          notes: "Must roll back",
          isFavourite: true,
          recommenderIds: [randomUUID()],
        },
      }),
    ).rejects.toThrow();
    expect(await getWorkCuration(owner)).toEqual(before);
    const saved = await updateWorkCuration({
      owner,
      fingerprint: before.fingerprint,
      patch: { isFavourite: true, rating: 5 },
    });
    expect(saved).toMatchObject({
      notes: "Keep this",
      isFavourite: true,
      rating: 5,
    });
    expect(await c`select id from editions`).toHaveLength(0);
  });

  it("writes perfumes, formulations and containers as single Neon batches with readable errors", async () => {
    await c`alter table works drop constraint works_kind_enabled_check`;
    try {
      const [family] =
        await c`select id from taxonomy_families where slug='perfume-notes'`;
      const [note] =
        await c`insert into custom_taxonomy_items(family_id,name,slug) values (${family.id},'Iris',${`iris-${randomUUID()}`}) returning id`;
      const year = (value: number) => ({
        precision: "year" as const,
        start: { year: value },
      });
      await expect(
        createPerfume({
          title: "Rolled back",
          releaseDate: year(1990),
          classificationItemIds: [note.id],
        }),
      ).rejects.toThrow(
        /^Use positioned perfume notes instead of generic taxonomy assignment$/,
      );
      expect(await c`select id from works`).toHaveLength(0);
      expect(await c`select id from catalogue_dates`).toHaveLength(0);
      requests.length = 0;
      const perfume = await createPerfume({
        title: "Iris Poudre",
        releaseDate: year(2000),
        notePyramid: [{ itemId: note.id, position: "heart" }],
      });
      expect(requests.filter((request) => request.queries)).toHaveLength(1);
      await expect(
        updatePerfume(
          perfume.id,
          { discontinuedDate: year(1999) },
          perfume.fingerprint,
        ),
      ).rejects.toThrow(/^The end date cannot precede the start date$/);
      const variant = await createPerfumeVariant({
        workId: perfume.id,
        concentration: "eau_de_parfum",
      });
      const bottle = await addPerfumeBottle({
        variantId: variant.id,
        container: "bottle",
        capacityValue: 100,
        volumeUnit: "ml",
        acquisitionDate: year(2020),
      });
      const disposed = await updatePerfumeBottle(
        bottle.id,
        { status: "disposed", dispositionReason: "Gift" },
        bottle.fingerprint,
      );
      expect(disposed).toMatchObject({ status: "disposed", capacityMl: 100 });
      await expect(deletePerfume(perfume.id)).rejects.toThrow(
        /^Delete or move this perfume's bottles, samples and decants first$/,
      );
      await deletePerfumeBottle(bottle.id);
      expect(await deletePerfume(perfume.id)).toMatchObject({ id: perfume.id });
      expect(await c`select id from works`).toHaveLength(0);
      expect(await c`select id from catalogue_dates`).toHaveLength(0);
    } finally {
      await c`delete from works where kind<>'book'`;
      await c`alter table works add constraint works_kind_enabled_check check (kind = 'book')`;
    }
  });

  it("writes films, reordered versions and release lists as single Neon batches", async () => {
    await c`alter table works drop constraint works_kind_enabled_check`;
    try {
      const year = (value: number) => ({
        precision: "year" as const,
        start: { year: value },
      });
      requests.length = 0;
      const film = await createFilm({ title: "Stalker", releaseDate: year(1979) });
      expect(requests.filter((request) => request.queries)).toHaveLength(1);
      const first = await createFilmVersion({
        workId: film.id,
        label: "Theatrical",
        runtimeSeconds: 9660,
        releases: [{ format: "theatrical", releaseDate: year(1979) }],
      });
      const second = await createFilmVersion({ workId: film.id, label: "Restoration" });
      expect([first.sortOrder, second.sortOrder]).toEqual([0, 1]);
      await expect(
        createFilmVersion({ workId: film.id, label: "Theatrical" }),
      ).rejects.toThrow(/^This film already has a version with this label$/);
      const reordered = await updateFilm(
        film.id,
        { versionOrder: [second.id, first.id] },
        film.fingerprint,
      );
      expect(reordered.versions.map((v) => v.id)).toEqual([second.id, first.id]);
      const edited = await updateFilmVersion(
        first.id,
        { releases: [{ format: "festival", territoryLabel: "Cannes" }] },
        first.fingerprint,
      );
      expect(edited.releases).toEqual([
        expect.objectContaining({ format: "festival", territoryLabel: "Cannes" }),
      ]);
      expect(await deleteFilm(film.id)).toMatchObject({ id: film.id });
      expect(await c`select id from catalogue_dates`).toHaveLength(0);
    } finally {
      await c`delete from works where kind<>'book'`;
      await c`alter table works add constraint works_kind_enabled_check check (kind = 'book')`;
    }
  });

  it("writes paintings and measured art objects as single Neon batches", async () => {
    await c`alter table works drop constraint works_kind_enabled_check`;
    try {
      requests.length = 0;
      const painting = await createPainting({
        title: "Girl with a Pearl Earring",
        creationDate: { precision: "year", start: { year: 1665 }, approximate: true },
      });
      expect(requests.filter((request) => request.queries)).toHaveLength(1);
      const object = await createArtObject({
        workId: painting.id,
        kind: "original",
        height: 44.5,
        width: 39,
        dimensionUnit: "cm",
      });
      expect(object).toMatchObject({ height: 44.5, heightCm: 44.5, widthCm: 39 });
      const inches = await updateArtObject(
        object.id,
        { height: 17.5, width: 15.375, dimensionUnit: "in" },
        object.fingerprint,
      );
      expect(inches).toMatchObject({ heightCm: 44.45, widthCm: 39.0525 });
      await expect(
        createArtObject({ workId: painting.id, kind: "original" }),
      ).rejects.toThrow(
        /^Label each original or version when the painting has more than one$/,
      );
      expect(await deletePainting(painting.id)).toMatchObject({ id: painting.id });
      expect(await c`select id from catalogue_dates`).toHaveLength(0);
    } finally {
      await c`delete from works where kind<>'book'`;
      await c`alter table works add constraint works_kind_enabled_check check (kind = 'book')`;
    }
  });

  it("closes and opens confirmed locations in one Neon batch", async () => {
    await c`alter table works drop constraint works_kind_enabled_check`;
    try {
      const year = (value: number) => ({
        precision: "year" as const,
        start: { year: value },
      });
      const home = (await createVenue({ name: "Home museum", type: "museum" })).id;
      const away = (await createVenue({ name: "Borrowing museum", type: "museum" })).id;
      const painting = await createPainting({ title: "The Night Watch" });
      const object = await createArtObject({ workId: painting.id, kind: "original" });
      const first = await recordWhereabouts(
        { objectId: object.id, placeKind: "venue", venueId: home, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1885) },
        (await getWhereabouts(object.id))!.fingerprint,
      );
      requests.length = 0;
      const moved = await recordWhereabouts(
        { objectId: object.id, placeKind: "venue", venueId: away, custody: "temporary_loan", certainty: "confirmed", startsOn: year(2030) },
        first.fingerprint,
      );
      expect(requests.filter((request) => request.queries)).toHaveLength(1);
      expect(moved.current!.venueId).toBe(away);
      expect(moved.records.find((r) => r.venueId === home)!.endsOn!.value.start).toEqual({ year: 2030, month: null, day: null });
      await expect(
        recordWhereabouts(
          { objectId: object.id, placeKind: "venue", venueId: home, custody: "permanent_collection", certainty: "confirmed", startsOn: year(1900) },
          moved.fingerprint,
        ),
      ).rejects.toThrow(/^The end date cannot precede the start date$/);
      expect((await getWhereabouts(object.id))!.fingerprint).toBe(moved.fingerprint);
      expect(await deletePainting(painting.id)).toMatchObject({ id: painting.id });
      expect(await c`select id from catalogue_dates`).toHaveLength(0);
    } finally {
      await c`delete from works where kind<>'book'`;
      await c`delete from venues`;
      await c`alter table works add constraint works_kind_enabled_check check (kind = 'book')`;
    }
  });
});
