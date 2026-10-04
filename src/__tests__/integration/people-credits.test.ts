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
import { CREDIT_ROLES } from "@/lib/catalogue/credits";

const url = process.env.DURTAL_PEOPLE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln349_test"
  )
    throw new Error("People tests require disposable local sln349_test");
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
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ processAndUploadCover: vi.fn() }));
import {
  createPerson,
  updatePerson,
  deletePerson,
  getPeople,
  getPerson,
  getPersonMergePreview,
  mergePeople,
} from "@/lib/actions/people";
import {
  getWorkCredits,
  getEditionCredits,
  replaceWorkCredits,
  replaceEditionCredits,
  getPersonCredits,
} from "@/lib/actions/credits";
import {
  getAuthors,
  getAuthorCount,
  getAuthorBySlug,
  deleteAuthor,
  mergeAuthors,
  getPeopleFilterOptions,
  getPersonWorkCredits,
  getPersonRoles,
  getPersonWorkCounts,
} from "@/lib/actions/authors";
import { updateWork, getLibraryStats } from "@/lib/actions/works";
import { updateEdition } from "@/lib/actions/editions";
import { loadDataset } from "@/lib/harmonization/store";
import { getAuthorsForMap } from "@/lib/actions/author-map";

describe.skipIf(!url)("shared people and domain-scoped credits", () => {
  const c = client!;
  let work: Record<string, string>;
  let editionId: string;
  beforeAll(async () => {
    await migrate(testDb!, { migrationsFolder: "src/lib/db/migrations" });
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors, activity_events, comments, gallery_layouts, harmonization_operations, harmonization_redirects cascade`;
    const works =
      await c`insert into works(title,slug,kind,original_language) values ('A book','a-book','book','en'),('A film','a-film','film',null),('A fragrance','a-fragrance','perfume',null),('A painting','a-painting','painting',null) returning id,kind`;
    work = Object.fromEntries(works.map((w) => [w.kind, w.id]));
    const [edition] =
      await c`insert into editions(work_id,title) values (${work.book},'Translation') returning id`;
    editionId = edition.id;
  });
  async function person(
    name = "Jean Cocteau",
    domains: ("book" | "film" | "perfume" | "painting")[] = ["film"],
  ) {
    return createPerson({
      name,
      domains,
      aliases: ["Le poète"],
      bio: "Preserve biography",
      birthYear: 1889,
    });
  }
  it("installs every scoped role and preserves legacy author identity", async () => {
    const roles =
      await c`select id,kind,level,label,legacy_role from credit_roles`;
    for (const role of CREDIT_ROLES)
      expect(roles).toContainEqual({
        id: role.id,
        kind: role.kind,
        level: role.level,
        label: role.label,
        legacy_role: role.legacyRole ?? null,
      });
    const [author] =
      await c`insert into authors(name,slug,bio) values ('Existing author','existing-author','Original') returning id`;
    expect((await getPerson(author.id))?.slug).toBe("existing-author");
    expect((await getAuthorBySlug("existing-author"))?.id).toBe(author.id);
    expect((await getPerson(author.id))?.domains.map((d) => d.kind)).toEqual([
      "book",
    ]);
  });
  it("searches canonical and alias names with bounded, domain-filtered counts", async () => {
    const first = await person();
    await person("Another creator", ["perfume"]);
    expect(
      (await getPeople({ query: "cocteau" })).rows.map((p) => p.id),
    ).toEqual([first.id]);
    expect(
      (await getPeople({ query: "poete", domain: "film" })).rows.map(
        (p) => p.id,
      ),
    ).toEqual([first.id]);
    expect((await getPeople({ limit: 1 })).total).toBe(2);
    expect((await getPeople({ limit: 1, offset: 1 })).rows).toHaveLength(1);
    // People lists everyone (SLN-419); the book views stay book-only
    expect(await getAuthorCount()).toBe(2);
    expect(await getAuthors()).toHaveLength(2);
    expect(await getAuthorCount({ filters: { collections: ["book"] } })).toBe(0);
    expect(await getAuthorCount({ filters: { collections: ["perfume"] } })).toBe(1);
    expect((await getLibraryStats()).authors).toBe(0);
    expect((await loadDataset()).authors).toHaveLength(0);
    const [country] =
      await c`insert into countries(name,alpha_2,alpha_3,latitude,longitude) values ('Map test','ZZ','ZZZ',1,1) on conflict (alpha_2) do update set latitude=1 returning id`;
    await updatePerson(first.id, { nationalityId: country.id });
    expect(await getAuthorsForMap()).toHaveLength(0);
    await expect(getPeople({ limit: 101 })).rejects.toThrow();
  });
  it("People: filters by collection and role, counts each choice, and opens every person's page", async () => {
    const director = await person("Agnès Varda", ["film"]);
    const perfumer = await person("Germaine Cellier", ["perfume"]);
    const translator = await person("Edith Grossman", ["book"]);
    await replaceWorkCredits(work.film, [{ personId: director.id, roleId: "film.director" }]);
    await replaceWorkCredits(work.perfume, [{ personId: perfumer.id, roleId: "perfume.perfumer" }]);
    await replaceEditionCredits(editionId, [{ personId: translator.id, roleId: "book.edition.translator" }]);
    const ids = async (filters: Parameters<typeof getAuthors>[0]) =>
      (await getAuthors(filters)).map((a) => a.id).sort();
    expect(await ids({ filters: { roles: ["film.director"] } })).toEqual([director.id]);
    expect(await ids({ filters: { roles: ["book.edition.translator", "perfume.perfumer"] } })).toEqual(
      [perfumer.id, translator.id].sort(),
    );
    expect(await ids({ filters: { collections: ["film", "perfume"] } })).toEqual(
      [director.id, perfumer.id].sort(),
    );
    // A malformed role or collection is ignored, not sent to the database
    expect(await ids({ filters: { roles: ["x'); drop table authors;--"], collections: ["nope"] } })).toHaveLength(3);
    const options = await getPeopleFilterOptions();
    expect(options.collections).toEqual(
      expect.arrayContaining([{ kind: "film", count: 1 }, { kind: "perfume", count: 1 }, { kind: "book", count: 1 }]),
    );
    expect(options.roles).toEqual(
      expect.arrayContaining([
        { roleId: "film.director", kind: "film", label: "Director", count: 1 },
        { roleId: "perfume.perfumer", kind: "perfume", label: "Perfumer", count: 1 },
        { roleId: "book.edition.translator", kind: "book", label: "Translator", count: 1 },
      ]),
    );
    // Every person has a page, books or not, with their credits
    expect((await getAuthorBySlug(director.slug))?.id).toBe(director.id);
    expect(await getPersonWorkCredits(director.id)).toEqual([
      { kind: "film", roleId: "film.director", role: "Director", workId: work.film, title: "A film", slug: "a-film" },
    ]);
    expect((await getPersonWorkCredits(translator.id)).map((c) => [c.kind, c.role, c.title])).toEqual([
      ["book", "Translator", "A book"],
    ]);
    // Every card's roles in one query, with their credit counts (SLN-420)
    const roles = await getPersonRoles([director.id, perfumer.id, translator.id, (await person("No credits", ["film"])).id]);
    expect(roles[director.id]).toEqual([{ roleId: "film.director", kind: "film", label: "Director", count: 1 }]);
    expect(roles[perfumer.id]).toEqual([{ roleId: "perfume.perfumer", kind: "perfume", label: "Perfumer", count: 1 }]);
    expect(roles[translator.id]).toEqual([
      { roleId: "book.edition.translator", kind: "book", label: "Translator", count: 1 },
    ]);
    expect(Object.keys(roles)).toHaveLength(3);
    expect(await getPersonRoles([])).toEqual({});
    // The Works column counts every collection's works, each once
    const counts = await getPersonWorkCounts([director.id, perfumer.id, translator.id]);
    expect(counts).toEqual({ [director.id]: 1, [perfumer.id]: 1, [translator.id]: 1 });
    // A person with no books and no credits is deleted through the shared path
    const lone = await person("Nobody yet", ["painting"]);
    await deleteAuthor(lone.id);
    expect(await getPerson(lone.id)).toBeFalsy();
    // With credits, the shared path refuses and nothing changes
    await expect(deleteAuthor(director.id)).rejects.toThrow();
    expect((await getPerson(director.id))?.id).toBe(director.id);
  });
  it("allocates distinct stable URLs for concurrent people with the same name", async () => {
    const people = await Promise.all(
      Array.from({ length: 7 }, () => person("Shared name")),
    );
    expect(new Set(people.map((p) => p.slug)).size).toBe(7);
    expect(await c`select id from authors`).toHaveLength(7);
    expect(await c`select id from activity_events`).toHaveLength(7);
    expect(
      await c`select * from person_domains where kind='book'`,
    ).toHaveLength(0);
  });
  it("shares one person across four domains, ordered repeated film roles and multiple characters", async () => {
    const p = await person();
    const film = await replaceWorkCredits(work.film, [
      {
        personId: p.id,
        roleId: "film.director",
        creditedAs: "J. Cocteau",
        attribution: "confirmed",
      },
      {
        personId: p.id,
        roleId: "film.cast",
        characters: ["Narrator", "The poet"],
      },
      { personId: p.id, roleId: "film.cast", characters: ["The stranger"] },
    ]);
    await replaceWorkCredits(work.perfume, [
      { personId: p.id, roleId: "perfume.perfumer" },
    ]);
    await replaceWorkCredits(work.painting, [
      { personId: p.id, roleId: "painting.painter", attribution: "attributed" },
    ]);
    await replaceWorkCredits(work.book, [
      { personId: p.id, roleId: "book.author" },
    ]);
    expect((await getPerson(p.id))?.domains.map((d) => d.kind).sort()).toEqual([
      "book",
      "film",
      "painting",
      "perfume",
    ]);
    expect(await getAuthorCount()).toBe(1);
    expect(
      (await getWorkCredits(work.film)).map((credit) => credit.sortOrder),
    ).toEqual([0, 1, 2]);
    const reordered = await replaceWorkCredits(
      work.film,
      [...film].reverse().map((credit) => ({
        id: credit.id,
        personId: credit.personId,
        roleId: credit.roleId,
        characters: credit.characters,
        creditedAs: credit.creditedAs,
        attribution: credit.attribution,
      })),
    );
    expect(reordered.map((credit) => credit.id)).toEqual(
      film.map((credit) => credit.id).reverse(),
    );
    expect(await getPersonCredits(p.id)).toHaveLength(6);
    expect(
      (await getPersonCredits(p.id, { limit: 2, offset: 2 })).map(
        (credit) => credit.id,
      ),
    ).toEqual(
      (await getPersonCredits(p.id)).slice(2, 4).map((credit) => credit.id),
    );
  });
  it("supports unknown and uncertain creators without inventing a person", async () => {
    await replaceWorkCredits(work.painting, [
      { personId: null, roleId: "painting.painter", attribution: "unknown" },
    ]);
    expect((await getWorkCredits(work.painting))[0].person).toBeNull();
    await replaceWorkCredits(work.painting, [
      {
        personId: null,
        roleId: "painting.painter",
        creditedAs: "Master of the garden",
        attribution: "uncertain",
      },
    ]);
    expect(await c`select id from authors`).toHaveLength(0);
    await expect(
      replaceWorkCredits(work.painting, [
        { personId: null, roleId: "painting.painter" },
      ]),
    ).rejects.toThrow();
  });
  it("rejects invalid domain/level roles and characters at application and database boundaries", async () => {
    const p = await person();
    await expect(
      replaceWorkCredits(work.film, [
        { personId: p.id, roleId: "painting.painter" },
      ]),
    ).rejects.toThrow("domain and level");
    await expect(
      replaceWorkCredits(work.book, [
        { personId: p.id, roleId: "book.edition.translator" },
      ]),
    ).rejects.toThrow("domain and level");
    await expect(
      replaceEditionCredits(editionId, [
        { personId: p.id, roleId: "book.author" },
      ]),
    ).rejects.toThrow("domain and level");
    await expect(
      c`insert into work_credits(work_id,person_id,role_id) values (${work.film},${p.id},'painting.painter')`,
    ).rejects.toMatchObject({ constraint_name: "credit_role_scope_check" });
    await expect(
      c`insert into work_credits(work_id,person_id,role_id) values (${work.book},${p.id},'book.author')`,
    ).rejects.toMatchObject({ constraint_name: "credit_role_scope_check" });
    await expect(
      c`insert into work_credits(work_id,person_id,role_id,characters) values (${work.film},${p.id},'film.director',ARRAY['Narrator'])`,
    ).rejects.toMatchObject({
      constraint_name: "credit_character_scope_check",
    });
    await expect(
      c`insert into work_credits(work_id,role_id) values (${work.painting},'painting.painter')`,
    ).rejects.toMatchObject({ constraint_name: "work_credit_identity_check" });
    await expect(
      c`insert into edition_contributors(edition_id,author_id,role) values (${editionId},${p.id},'director')`,
    ).rejects.toMatchObject({ constraint_name: "credit_role_scope_check" });
  });
  it("rolls back a failed credit replacement and rejects IDs from another work", async () => {
    const p = await person();
    const before = await replaceWorkCredits(work.film, [
      { personId: p.id, roleId: "film.director" },
    ]);
    await expect(
      replaceWorkCredits(work.film, [
        { personId: randomUUID(), roleId: "film.director" },
      ]),
    ).rejects.toThrow();
    expect(await getWorkCredits(work.film)).toEqual(before);
    await expect(
      replaceWorkCredits(work.painting, [
        { id: before[0].id, personId: p.id, roleId: "painting.painter" },
      ]),
    ).rejects.toThrow("different record");
  });
  it.each(["book", "film", "edition"])(
    "rejects overlapping %s credit edits without silently overwriting the winner",
    async (level) => {
      const p = await person();
      const roleId =
        level === "edition"
          ? "book.edition.translator"
          : level === "book"
            ? "book.author"
            : "film.director";
      const replace = (creditedAs: string) =>
        level === "edition"
          ? replaceEditionCredits(editionId, [
              { personId: p.id, roleId, creditedAs },
            ])
          : replaceWorkCredits(work[level], [
              { personId: p.id, roleId, creditedAs },
            ]);
      let unlock!: () => void;
      let locked!: () => void;
      const gate = new Promise<void>((resolve) => {
        unlock = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const holder = c.begin(async (tx) => {
        if (level === "edition")
          await tx.unsafe("select id from editions where id=$1 for update", [
            editionId,
          ]);
        else
          await tx.unsafe("select id from works where id=$1 for update", [
            work[level],
          ]);
        locked();
        await gate;
      });
      await ready;
      const results = Promise.allSettled([
        replace("First edit"),
        replace("Second edit"),
      ]);
      try {
        await vi.waitFor(
          async () => {
            const [row] =
              await c`select count(*)::int as waiting from pg_stat_activity where datname=current_database() and wait_event_type='Lock'`;
            expect(row.waiting).toBeGreaterThanOrEqual(2);
          },
          { timeout: 5000, interval: 20 },
        );
      } finally {
        unlock();
        await holder;
      }
      const settled = await results;
      expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
      const saved =
        level === "edition"
          ? await getEditionCredits(editionId)
          : await getWorkCredits(work[level]);
      expect(saved).toHaveLength(1);
      expect(saved[0].creditedAs).toBe(
        settled[0].status === "fulfilled" ? "First edit" : "Second edit",
      );
    },
  );
  it("protects registered role identity and permits deletion only after credits are removed", async () => {
    const p = await person();
    await replaceWorkCredits(work.book, [
      { personId: p.id, roleId: "book.author" },
    ]);
    await expect(
      c`update credit_roles set kind='film' where id='book.author'`,
    ).rejects.toThrow();
    await expect(
      c`delete from credit_roles where id='book.author'`,
    ).rejects.toThrow();
    await replaceWorkCredits(work.book, []);
    await deletePerson(p.id);
    expect(await getPerson(p.id)).toBeUndefined();
    expect(
      await c`select * from person_aliases where person_id=${p.id}`,
    ).toHaveLength(0);
  });
  it("preserves credit metadata and IDs through legacy work and edition edits", async () => {
    const p = await person();
    const authorCredit = (
      await replaceWorkCredits(work.book, [
        {
          personId: p.id,
          roleId: "book.author",
          creditedAs: "Jean",
          attribution: "attributed",
        },
      ])
    )[0];
    const translatorCredit = (
      await replaceEditionCredits(editionId, [
        {
          personId: p.id,
          roleId: "book.edition.translator",
          creditedAs: "J.C.",
          attribution: "uncertain",
        },
      ])
    )[0];
    await updateWork(work.book, {
      authorIds: [{ authorId: p.id, role: "author" }],
    });
    await updateEdition(editionId, {
      contributorIds: [{ authorId: p.id, role: "translator" }],
    });
    expect((await getWorkCredits(work.book))[0]).toMatchObject({
      id: authorCredit.id,
      creditedAs: "Jean",
      attribution: "attributed",
    });
    expect((await getEditionCredits(editionId))[0]).toMatchObject({
      id: translatorCredit.id,
      creditedAs: "J.C.",
      attribution: "uncertain",
    });
    expect(
      (await getPersonCredits(p.id)).find(
        (credit) => credit.editionId === editionId,
      )?.roleId,
    ).toBe("book.edition.translator");
  });
  it("keeps person edits sparse and preserves a stable URL", async () => {
    const p = await person();
    await updatePerson(p.id, { birthMonth: 7, birthDay: 5 });
    expect((await getPerson(p.id))?.zodiacSign).toBe("cancer");
    await updatePerson(p.id, {
      name: "Jean Maurice Cocteau",
      aliases: ["Jean C."],
    });
    expect(await getPerson(p.id)).toMatchObject({
      slug: p.slug,
      bio: "Preserve biography",
      birthYear: 1889,
      birthMonth: 7,
      birthDay: 5,
    });
    expect(
      (await getPeople({ query: "Jean C" })).rows.map((row) => row.id),
    ).toContain(p.id);
    await updatePerson(p.id, { birthDay: null });
    expect((await getPerson(p.id))?.zodiacSign).toBeNull();
  });
  it("rolls back shared and legacy deletion when credits protect the identity", async () => {
    const p = await person();
    await replaceWorkCredits(work.film, [
      { personId: p.id, roleId: "film.director" },
    ]);
    await replaceWorkCredits(work.book, [
      { personId: p.id, roleId: "book.author" },
    ]);
    await c`insert into comments(entity_type,entity_id,content_html) values ('author',${p.id},'<p>Preserve</p>')`;
    await expect(deletePerson(p.id)).rejects.toThrow();
    await expect(deleteAuthor(p.id)).rejects.toThrow();
    expect(await getPerson(p.id)).toBeDefined();
    expect(
      await c`select * from comments where entity_id=${p.id}`,
    ).toHaveLength(1);
    expect(await getWorkCredits(work.book)).toHaveLength(1);
  });
  it("merges identities atomically, preserving distinct credit IDs, order, aliases, media and redirects", async () => {
    const source = await person("Jean source", ["book", "film"]);
    const target = await person("Jean target", ["book", "painting"]);
    const sourceBooks = await replaceWorkCredits(work.book, [
      { personId: source.id, roleId: "book.author" },
      {
        personId: source.id,
        roleId: "book.co_author",
        creditedAs: "Co-credit",
      },
      { personId: target.id, roleId: "book.author" },
    ]);
    const film = await replaceWorkCredits(work.film, [
      {
        personId: source.id,
        roleId: "film.cast",
        characters: ["Narrator", "Poet"],
      },
      { personId: target.id, roleId: "film.cast", characters: ["Other"] },
    ]);
    const translator = (
      await replaceEditionCredits(editionId, [
        { personId: source.id, roleId: "book.edition.translator" },
      ])
    )[0];
    await c`insert into media(author_id,type,s3_key) values (${source.id},'poster','keep-portrait.webp')`;
    const preview = await getPersonMergePreview(source.id, target.id);
    const choices = Object.fromEntries(
      preview.fields.filter((f) => f.conflict).map((f) => [f.key, "target"]),
    );
    await mergePeople({
      sourceId: source.id,
      targetId: target.id,
      fingerprint: preview.fingerprint,
      choices,
    });
    expect(await getPerson(source.id)).toBeUndefined();
    const bookCredits = await getWorkCredits(work.book);
    expect(bookCredits.map((credit) => credit.id).sort()).toEqual(
      [sourceBooks[1].id, sourceBooks[2].id].sort(),
    );
    expect((await getEditionCredits(editionId))[0].id).toBe(translator.id);
    expect(
      (await getWorkCredits(work.film)).map((credit) => [
        credit.id,
        credit.personId,
        credit.sortOrder,
      ]),
    ).toEqual(film.map((credit) => [credit.id, target.id, credit.sortOrder]));
    expect((await getPerson(target.id))?.media[0].s3Key).toBe(
      "keep-portrait.webp",
    );
    expect(
      (
        await c`select target_id from harmonization_redirects where source_id=${source.id}`
      )[0].target_id,
    ).toBe(target.id);
  });
  it("routes legacy author merges through the same credit-preserving transaction", async () => {
    const source = await person("One person", ["book", "film"]);
    const target = await person("Surviving person", ["book"]);
    const film = await replaceWorkCredits(work.film, [
      { personId: source.id, roleId: "film.director" },
    ]);
    await mergeAuthors(source.id, target.id);
    expect((await getWorkCredits(work.film))[0]).toMatchObject({
      id: film[0].id,
      personId: target.id,
    });
  });
});
