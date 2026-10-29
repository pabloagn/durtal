import { requireDisposableDatabaseUrl, resetDisposableDatabase } from "./helpers/disposable-database";
import { actionResult } from "@/lib/actions/action-result";
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
import * as schema from "@/lib/db/schema";
import { CREDIT_ROLES } from "@/lib/catalogue/credits";

const url = process.env.DURTAL_PEOPLE_TEST_DATABASE_URL;
if (url) requireDisposableDatabaseUrl(url, "sln349_test");
if (url) {
  const parsed = new URL(url);
  if (
    !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln349_test"
  )
    throw new Error("People tests require disposable local sln349_test");
}
const client = url ? postgres(url, { prepare: false, max: 5, onnotice: () => {} }) : null;
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
// Merges and deletes end with the S3 clean-up: an in-memory bucket, nothing leaves the machine
vi.mock("@/lib/s3/client", async () => (await import("@/__tests__/helpers/memory-bucket")).memoryS3Client());
vi.mock("@/lib/activity/record", () => ({ recordActivity: vi.fn() }));
vi.mock("@/lib/s3/covers", () => ({ processAndUploadCover: vi.fn() }));
import {
  createPerson,
  getPersonDeletionRefusal,
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
  createAuthor,
  findOrCreateAuthor,
  getAuthorCount,
  getAuthorBySlug,
  deleteAuthor,
  mergeAuthors,
  getPeopleFilterOptions,
  getPersonWorkCredits,
  getPersonRoles,
  getPersonWorkCounts,
  getPersonWorkCountsByKind,
  getPersonEditFingerprint,
  updateAuthor,
} from "@/lib/actions/authors";
import { generateWorkSlug } from "@/lib/utils/slugify";
import { STALE_PERSON } from "@/lib/catalogue/person-fingerprint";
import { updateWork, getLibraryStats } from "@/lib/actions/works";
import { updateEdition } from "@/lib/actions/editions";
import { loadDataset } from "@/lib/harmonization/store";
import { getAuthorsForMap } from "@/lib/actions/author-map";
import { getAuthorsForTimeline } from "@/lib/actions/author-timeline";

describe.skipIf(!url)("shared people and domain-scoped credits", () => {
  const c = client!;
  let work: Record<string, string>;
  let editionId: string;
  beforeAll(async () => {
    await resetDisposableDatabase(url!, "sln349_test");
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 30000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await resetDisposableDatabase(url!, "sln349_test", { activateKinds: true });
    const works =
      await c`insert into works(title,slug,kind,original_language) values ('A book','a-book','book','en'),('A film','a-film','film',null),('A fragrance','a-fragrance','perfume',null),('A painting','a-painting','painting',null) returning id,kind`;
    work = Object.fromEntries(works.map((w) => [w.kind, w.id]));
    const [edition] =
      await c`insert into editions(work_id,title) values (${work.book},'Translation') returning id`;
    editionId = edition.id;
  }, 30000);
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
    // The cards count the same works per collection (SLN-1025)
    expect(await getPersonWorkCountsByKind([director.id, perfumer.id, translator.id])).toEqual({
      [director.id]: { film: 1 }, [perfumer.id]: { perfume: 1 }, [translator.id]: { book: 1 },
    });
    expect(await getPersonWorkCountsByKind([])).toEqual({});
    // A person with no books and no credits is deleted through the shared path
    const lone = await person("Nobody yet", ["painting"]);
    await deleteAuthor(lone.id);
    expect(await getPerson(lone.id)).toBeFalsy();
    // With credits, the shared path refuses and nothing changes
    await expect(deleteAuthor(director.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    expect((await getPerson(director.id))?.id).toBe(director.id);
  });
  it("the People timeline counts works in every collection, as the table does", async () => {
    const cocteau = await person("Jean Cocteau", ["book", "film"]);
    await replaceWorkCredits(work.book, [{ personId: cocteau.id, roleId: "book.author" }]);
    await replaceWorkCredits(work.film, [
      { personId: cocteau.id, roleId: "film.director" },
      { personId: cocteau.id, roleId: "film.screenwriter" },
    ]);
    const row = (await getAuthorsForTimeline()).find((a) => a.id === cocteau.id);
    // One book and one film: two works, the film once though he holds two roles on it
    expect(row?.worksCount).toBe(2);
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
      const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")!;
      expect(await actionResult(() => Promise.reject(rejected.reason))).toEqual({
        ok: false, error: "Credits changed while saving; reload before trying again",
      });
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
  it("refuses a save from a stale Edit person, and saves from a current one (SLN-1244)", async () => {
    const p = await person("Jean Genet", ["book"]);
    const read = () => getPersonEditFingerprint(p.id);
    // Tabs A and B open Edit person on the same person
    const seen = await read();
    // A sets the real name with what it read
    await updateAuthor(p.id, { realName: "Jean Genet (A)" }, seen!);
    // B, opened before A saved, saves the website and its old real name: refused
    await expect(
      updateAuthor(p.id, { website: "https://example.org/b", realName: null }, seen!),
    ).rejects.toMatchObject({ name: "ExpectedActionError", message: STALE_PERSON });
    const [stored] = await c`select real_name, website from authors where id=${p.id}`;
    expect(stored).toEqual({ real_name: "Jean Genet (A)", website: null });
    // After a reload, B's save lands
    await updateAuthor(p.id, { website: "https://example.org/b", realName: "Jean Genet (A)" }, (await read())!);
    const [after] = await c`select real_name, website from authors where id=${p.id}`;
    expect(after).toEqual({ real_name: "Jean Genet (A)", website: "https://example.org/b" });
    // A save with no fingerprint works as before; an alias does not touch it
    await updateAuthor(p.id, { goodreadsId: "123" });
    const before = await read();
    await updatePerson(p.id, { aliases: ["Genet"] });
    expect(await read()).toBe(before);
    // Deleted in another tab: said so, not "reload"
    const gone = await person("Jean Genet II", ["book"]);
    const goneSeen = await getPersonEditFingerprint(gone.id);
    await c`delete from authors where id=${gone.id}`;
    await expect(updateAuthor(gone.id, { website: "https://example.org/c" }, goneSeen!))
      .rejects.toMatchObject({ message: "This person no longer exists." });
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
    await expect(deletePerson(p.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    // A book person with a film credit gets the credits sentence too (SLN-1168)
    expect(await actionResult(() => deleteAuthor(p.id))).toEqual({ ok: false, error: "Remove their film, painting and perfume credits first." });
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
  it("refuses a stale merge without losing either identity or their credits", async () => {
    const source = await person("Source identity", ["book"]);
    const target = await person("Target identity", ["film"]);
    await replaceWorkCredits(work.book, [{ personId: source.id, roleId: "book.author" }]);
    await replaceWorkCredits(work.film, [{ personId: target.id, roleId: "film.director" }]);
    const preview = await getPersonMergePreview(source.id, target.id);
    const beforeSource = await getPersonCredits(source.id);
    const beforeTarget = await getPersonCredits(target.id);
    await updatePerson(source.id, { bio: "A newer biography" });
    const choices = Object.fromEntries(preview.fields.filter(field => field.conflict).map(field => [field.key, "target"]));
    await expect(mergePeople({ sourceId: source.id, targetId: target.id, fingerprint: preview.fingerprint, choices }))
      .rejects.toMatchObject({ name: "ExpectedActionError", message: "The records or their relationships changed. Review a fresh merge preview." });
    expect(await getPerson(source.id)).toMatchObject({ id: source.id, bio: "A newer biography" });
    expect(await getPerson(target.id)).toMatchObject({ id: target.id, bio: "Preserve biography" });
    expect(await getPersonCredits(source.id)).toEqual(beforeSource);
    expect(await getPersonCredits(target.id)).toEqual(beforeTarget);
  });
  it.each(["shared", "legacy"])("%s merge retains every distinct work and edition credit", async mode => {
    const source = await person("Credit source", ["book", "film"]);
    const target = await person("Credit target", ["book", "film"]);
    await replaceWorkCredits(work.book, [
      { personId: source.id, roleId: "book.author", creditedAs: "Source credit" },
      { personId: target.id, roleId: "book.co_author", creditedAs: "Target credit" },
    ]);
    await replaceWorkCredits(work.film, [
      { personId: source.id, roleId: "film.director" },
      { personId: target.id, roleId: "film.cast", characters: ["Narrator"] },
    ]);
    await replaceEditionCredits(editionId, [
      { personId: source.id, roleId: "book.edition.translator" },
      { personId: target.id, roleId: "book.edition.editor" },
    ]);
    const worksBefore = [...await getWorkCredits(work.book), ...await getWorkCredits(work.film)];
    const editionsBefore = await getEditionCredits(editionId);
    if (mode === "legacy") await mergeAuthors(source.id, target.id);
    else {
      const preview = await getPersonMergePreview(source.id, target.id);
      await mergePeople({ sourceId: source.id, targetId: target.id, fingerprint: preview.fingerprint,
        choices: Object.fromEntries(preview.fields.filter(field => field.conflict).map(field => [field.key, "target"])) });
    }
    const worksAfter = [...await getWorkCredits(work.book), ...await getWorkCredits(work.film)];
    const editionsAfter = await getEditionCredits(editionId);
    type Credit = Pick<(typeof worksBefore)[number], "id" | "personId" | "roleId" | "creditedAs" | "attribution">;
    const retained = (before: Credit[], after: Credit[]) => {
      expect(after).toHaveLength(before.length);
      expect(after.every(credit => credit.personId === target.id)).toBe(true);
      expect(after.map(credit => credit.id).sort()).toEqual(before.map(credit => credit.id).sort());
      for (const credit of before) expect(after.find(row => row.id === credit.id)).toMatchObject({
        roleId: credit.roleId, creditedAs: credit.creditedAs, attribution: credit.attribution,
      });
    };
    retained(worksBefore, worksAfter);
    retained(editionsBefore, editionsAfter);
    expect(await getPerson(source.id)).toBeUndefined();
  });
  it("reuses the same author across repeated, case-folded and accent-folded names", async () => {
    const first = await findOrCreateAuthor("Péter Nádas");
    expect((await findOrCreateAuthor("Péter Nádas")).id).toBe(first.id);
    expect((await findOrCreateAuthor("PETER NADAS")).id).toBe(first.id);
    expect(await c`select id from authors`).toEqual([{ id: first.id }]);
  });
  it("explains refusals from author creation, author edits, shared edits and legacy merges", async () => {
    const existing = await person("Existing identity", ["book"]);
    await expect(createAuthor({ name: "" })).rejects.toThrow("Name is required");
    await expect(updateAuthor(existing.id, { name: "" })).rejects.toThrow("Name is required");
    await expect(updatePerson(randomUUID(), { bio: "Cannot apply" })).rejects.toThrow("Person not found");
    await expect(mergeAuthors(existing.id, existing.id)).rejects.toThrow("Choose two different records");
    expect(await getPerson(existing.id)).toMatchObject({ name: "Existing identity", bio: "Preserve biography" });
    expect(await c`select id from authors`).toEqual([{ id: existing.id }]);
  });

  it("previews counted non-book blockers without counting each role as another work", async () => {
    const p = await person("Counted credits", ["book", "film", "painting", "perfume"]);
    const [second] = await c`insert into works(title,slug,kind,original_language) values ('Another film','another-film','film',null) returning id`;
    await replaceWorkCredits(work.book, [{ personId: p.id, roleId: "book.author" }]);
    await replaceWorkCredits(work.film, [{ personId: p.id, roleId: "film.director" }, { personId: p.id, roleId: "film.cast" }]);
    await replaceWorkCredits(second.id, [{ personId: p.id, roleId: "film.director" }]);
    await replaceWorkCredits(work.painting, [{ personId: p.id, roleId: "painting.painter" }]);
    await replaceWorkCredits(work.perfume, [{ personId: p.id, roleId: "perfume.perfumer" }]);
    expect(await getPersonDeletionRefusal(p.id)).toBe("Credited on 2 films, 1 painting and 1 perfume. Remove those credits first.");
    await expect(deleteAuthor(p.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    expect(await getPerson(p.id)).toBeDefined();
    expect(await getWorkCredits(work.book)).toHaveLength(1);
  });
  it("refuses a credit added after the deletion preview without losing the person", async () => {
    const p = await person("Concurrent credit", ["book", "film"]);
    expect(await getPersonDeletionRefusal(p.id)).toBeNull();
    await replaceWorkCredits(work.film, [{ personId: p.id, roleId: "film.director" }]);
    await expect(deleteAuthor(p.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    expect(await getPerson(p.id)).toBeDefined();
    expect(await getWorkCredits(work.film)).toHaveLength(1);
  });
  it("allows book-only deletion and refreshes the newly authorless book address", async () => {
    const p = await person("Deleted author", ["book"]);
    await replaceWorkCredits(work.book, [{ personId: p.id, roleId: "book.author" }]);
    await c`update works set slug='a-book-by-deleted-author' where id=${work.book}`;
    expect(await getPersonDeletionRefusal(p.id)).toBeNull();
    await deleteAuthor(p.id);
    expect(await getPerson(p.id)).toBeUndefined();
    const [book] = await c`select title,slug from works where id=${work.book}`;
    expect(book.title).toBe("A book");
    expect(book.slug).toBe(generateWorkSlug("A book", "unknown", work.book));
    expect(await getWorkCredits(work.book)).toHaveLength(0);
  });

  it("also names and protects object- and formulation-level credits on the shared delete path", async () => {
    const p = await person("Specialist credits", ["painting", "perfume"]);
    await c`insert into painting_details(work_id) values (${work.painting})`;
    await c`insert into perfume_details(work_id) values (${work.perfume})`;
    const [object] = await c`insert into art_objects(work_id,kind,ownership,attribution_override) values (${work.painting},'original','unknown',true) returning id`;
    const [variant] = await c`insert into perfume_variants(work_id,perfumers_override) values (${work.perfume},true) returning id`;
    await c`insert into art_object_credits(object_id,person_id) values (${object.id},${p.id})`;
    await c`insert into perfume_variant_perfumers(variant_id,person_id) values (${variant.id},${p.id})`;
    expect(await getPersonDeletionRefusal(p.id)).toBe("Credited on 1 painting and 1 perfume. Remove those credits first.");
    await expect(deletePerson(p.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    await expect(deleteAuthor(p.id)).rejects.toThrow("Remove their film, painting and perfume credits first.");
    expect(await getPerson(p.id)).toBeDefined();
    expect(await c`select id from art_object_credits where person_id=${p.id}`).toHaveLength(1);
    expect(await c`select id from perfume_variant_perfumers where person_id=${p.id}`).toHaveLength(1);
  });

});
