import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "@/lib/db/schema";

const url = process.env.DURTAL_WORK_RELATIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln363_test")
    throw new Error("Work relation tests require disposable local sln363_test");
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
  CACHE_TAGS: { works: "data:works", sources: "data:sources" },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  createWorkRelation,
  deleteWorkRelation,
  getWorkRelations,
  getWorkSourceChoices,
  searchWorksForRelation,
} from "@/lib/actions/work-relations";
import { citeSource, deleteCitedSource } from "@/lib/actions/catalogue-provenance";
import { executeMerge, previewMerge } from "@/lib/harmonization/merge";
import { referencesTo } from "@/lib/harmonization/store";
import type { WorkKind } from "@/lib/catalogue/kinds";

describe.skipIf(!url)("sourced links between works", () => {
  const c = client!;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, source_records, comments, activity_events, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
  });

  const work = async (title: string, kind: WorkKind = "book") =>
    (
      await c`insert into works(title, kind, original_language) values (${title}, ${kind}, ${kind === "book" ? "en" : null}) returning id`
    )[0].id as string;
  const source = async (kind: WorkKind, id: string, attribution: string) =>
    (await citeSource({ owner: { kind, id }, attribution, retrievedOn: "2026-10-01" })).id;
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error("Expected the call to fail");
      },
      (e: Error) => e.message,
    );

  it("records an adaptation from the film and shows it from both works", async () => {
    const novel = await work("The Shining");
    const film = await work("The Shining", "film");
    const credits = await source("film", film, "The film's opening credits");
    await createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: novel, sourceRecordId: credits });
    const fromFilm = await getWorkRelations(film);
    expect(fromFilm).toEqual([
      expect.objectContaining({
        type: "adaptation",
        direction: "outgoing",
        other: expect.objectContaining({ id: novel, kind: "book", href: `/library/${novel}` }),
        source: expect.objectContaining({ id: credits, label: "The film's opening credits" }),
      }),
    ]);
    const fromNovel = await getWorkRelations(novel);
    expect(fromNovel).toEqual([
      expect.objectContaining({
        type: "adaptation",
        direction: "incoming",
        other: expect.objectContaining({ id: film, kind: "film", href: `/films/${film}` }),
      }),
    ]);
  });

  it("rejects self links, duplicates, inverse duplicates and kinds a type does not join", async () => {
    const novel = await work("Solaris");
    const film = await work("Solaris", "film");
    const remake = await work("Solaris", "film");
    expect(await failure(createWorkRelation({ type: "remake", fromWorkId: film, toWorkId: film }))).toBe(
      "A work cannot be linked to itself",
    );
    await expect(
      c`insert into work_relations(type,from_work_id,from_kind,to_work_id,to_kind) values ('remake',${film},'film',${film},'film')`,
    ).rejects.toMatchObject({ constraint_name: "work_relation_self_check" });
    await createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: novel });
    expect(await failure(createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: novel }))).toBe(
      "These two works are already linked this way",
    );
    // The same link pointing the other way: a novelization of the film
    expect(await failure(createWorkRelation({ type: "adaptation", fromWorkId: novel, toWorkId: film }))).toBe(
      "These two works are already linked this way",
    );
    expect(await failure(createWorkRelation({ type: "remake", fromWorkId: remake, toWorkId: novel }))).toBe(
      "A remake joins a film to a film",
    );
    expect(await failure(createWorkRelation({ type: "flanker", fromWorkId: remake, toWorkId: film }))).toBe(
      "A flanker joins a perfume to a perfume",
    );
    // The kind columns must match the works: a book cannot pose as a film
    await expect(
      c`insert into work_relations(type,from_work_id,from_kind,to_work_id,to_kind) values ('remake',${remake},'film',${novel},'film')`,
    ).rejects.toMatchObject({ constraint_name: "work_relation_to_fk" });
    await expect(
      c`insert into work_relations(type,from_work_id,from_kind,to_work_id,to_kind) values ('remake',${novel},'book',${film},'film')`,
    ).rejects.toMatchObject({ constraint_name: "work_relation_pair_check" });
    await createWorkRelation({ type: "remake", fromWorkId: remake, toWorkId: film });
    expect((await getWorkRelations(film)).map((r) => [r.type, r.direction, r.other.id])).toEqual([
      ["adaptation", "outgoing", novel],
      ["remake", "incoming", remake],
    ]);
  });

  it("needs a source of the first work for an inspiration, and keeps a source when the link goes", async () => {
    const painting = await work("The Night Watch", "painting");
    const perfume = await work("Ronde de Nuit", "perfume");
    const paintingSource = await source("painting", painting, "Rijksmuseum");
    expect(await failure(createWorkRelation({ type: "inspiration", fromWorkId: perfume, toWorkId: painting }))).toBe(
      "An inspiration needs a source: say where it is stated",
    );
    await expect(
      c`insert into work_relations(type,from_work_id,from_kind,to_work_id,to_kind) values ('inspiration',${perfume},'perfume',${painting},'painting')`,
    ).rejects.toMatchObject({ constraint_name: "work_relation_source_check" });
    // A source of the other work does not say what the perfume draws on
    expect(
      await failure(
        createWorkRelation({ type: "inspiration", fromWorkId: perfume, toWorkId: painting, sourceRecordId: paintingSource }),
      ),
    ).toBe("Cite a source of Ronde de Nuit");
    const { id } = await createWorkRelation({
      type: "inspiration",
      fromWorkId: perfume,
      toWorkId: painting,
      newSource: { attribution: "The house's press release", url: "https://example.com/ronde", retrievedOn: "2026-10-02" },
      notes: "The night colors",
    });
    const [link] = await getWorkRelations(perfume);
    expect(link).toMatchObject({ id, notes: "The night colors", source: { label: "The house's press release", url: "https://example.com/ronde" } });
    expect((await getWorkSourceChoices(perfume)).map((s) => s.label)).toEqual(["The house's press release"]);
    // A cited source cannot be removed; once the link goes, the source stays
    expect(await failure(deleteCitedSource(link.source!.id))).toBe(
      "A record still cites this source; choose another source there first",
    );
    await deleteWorkRelation(id);
    expect(await getWorkRelations(perfume)).toEqual([]);
    expect(await c`select 1 from source_records where id=${link.source!.id}`).toHaveLength(1);
    // A refused link removes the source it would have recorded
    expect(
      await failure(
        createWorkRelation({
          type: "flanker",
          fromWorkId: perfume,
          toWorkId: painting,
          newSource: { attribution: "Never kept", url: null, retrievedOn: "2026-10-02" },
        }),
      ),
    ).toBe("A flanker joins a perfume to a perfume");
    expect(await c`select 1 from source_records where attribution='Never kept'`).toHaveLength(0);
  });

  it("never links works because they share a title", async () => {
    const original = await work("The Thing", "film");
    const remake = await work("The Thing", "film");
    expect(await getWorkRelations(original)).toEqual([]);
    expect(await getWorkRelations(remake)).toEqual([]);
    const found = await searchWorksForRelation({ query: "the thing", kinds: ["film"], excludeId: original });
    expect(found.map((w) => w.id)).toEqual([remake]);
  });

  it("drops a work's links with it and leaves the other work as it was", async () => {
    const novel = await work("Dune");
    const film = await work("Dune", "film");
    const other = await work("Dune", "film");
    await createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: novel });
    await createWorkRelation({ type: "adaptation", fromWorkId: other, toWorkId: novel });
    await c`delete from works where id=${film}`;
    expect((await getWorkRelations(novel)).map((r) => r.other.id)).toEqual([other]);
    expect(await c`select 1 from works where id=${novel}`).toHaveLength(1);
  });

  it("moves a merged book's links to the kept book without self links or duplicates", async () => {
    expect(referencesTo("works")).toContainEqual({ table: "work_relations", columns: ["from_work_id", "to_work_id"] });
    const kept = await work("Dracula");
    const merged = await work("Dracula ");
    const film = await work("Nosferatu", "film");
    const remake = await work("Dracula", "film");
    const kept2 = await source("film", film, "Murnau's titles");
    await createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: kept, sourceRecordId: kept2 });
    await createWorkRelation({ type: "adaptation", fromWorkId: film, toWorkId: merged });
    await createWorkRelation({ type: "adaptation", fromWorkId: remake, toWorkId: merged });
    await createWorkRelation({
      type: "inspiration",
      fromWorkId: merged,
      toWorkId: kept,
      newSource: { attribution: "A note", url: null, retrievedOn: "2026-10-02" },
    });
    const preview = await previewMerge("works", merged, kept);
    await executeMerge({
      entity: "works",
      sourceId: merged,
      targetId: kept,
      fingerprint: preview.fingerprint,
      choices: Object.fromEntries(preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target" as const])),
    });
    const links = await getWorkRelations(kept);
    expect(links.map((r) => [r.type, r.direction, r.other.id, r.source?.id ?? null]).sort()).toEqual(
      [
        ["adaptation", "incoming", film, kept2],
        ["adaptation", "incoming", remake, null],
      ].sort(),
    );
  });
});
