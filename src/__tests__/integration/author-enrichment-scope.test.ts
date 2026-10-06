import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { CANON_SCOPE_SQL } from "@/lib/authors/enrichment";

// Explicit opt-in only: never load DATABASE_URL or any live environment files.
const url = process.env.DURTAL_AUTHOR_SCOPE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/sln410_author_scope")
    throw new Error("Author scope tests require a disposable local sln410_author_scope database");
}
const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;

/* The people the author enrichment's second pass takes (--scope canon, SLN-410), against PostgreSQL. */

describe.skipIf(!url)("the canon scope of the author enrichment", () => {
  const c = client!;
  beforeAll(async () => {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    await migrate(drizzle(c), { migrationsFolder: "src/lib/db/migrations" });
    // Films and perfumes only inside this explicitly guarded disposable database
    await c`alter table works drop constraint works_kind_enabled_check`;
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate works, authors cascade`;
  });

  const person = async (name: string, domains: string[] = ["book"]) => {
    const [row] = await c`insert into authors(name, slug) values (${name}, ${name.toLowerCase().replace(/\W+/g, "-")}) returning id`;
    await c`delete from person_domains where person_id = ${row.id}`;
    for (const kind of domains) await c`insert into person_domains(person_id, kind) values (${row.id}, ${kind})`;
    return row.id as string;
  };
  const work = async (title: string, kind = "book") => {
    const [row] = await c`insert into works(title, slug, kind, original_language) values (${title}, ${title.toLowerCase().replace(/\W+/g, "-")}, ${kind}, ${kind === "book" ? "en" : null}) returning id`;
    return row.id as string;
  };
  const credit = (workId: string, personId: string, roleId: string) =>
    c`insert into work_credits(work_id, person_id, role_id) values (${workId}, ${personId}, ${roleId})`;
  const canon = async () =>
    (await c.unsafe(`select a.name from authors a where ${CANON_SCOPE_SQL} order by a.name`)).map((r) => r.name);

  it("takes the people without books who belong to books, and leaves out the film, painting and perfume people", async () => {
    const book = await work("Nadja");
    const film = await work("Stalker", "film");
    const perfume = await work("Shalimar", "perfume");
    const [edition] = await c`insert into editions(work_id, title) values (${book}, 'Nadja') returning id`;

    // An author with a book: pass 1's
    await c`insert into work_authors(work_id, author_id, role) values (${book}, ${await person("André Breton")}, 'author')`;
    // A canon person: in the book directory, no credits
    await person("Agnès Varda");
    // A canon director now credited on a film, and nothing in books: out
    await credit(film, await person("Andrei Tarkovsky", ["book", "film"]), "film.director");
    // A translator of an edition who also has a film credit: in
    const translator = await person("Richard Howard", ["book", "film"]);
    await credit(film, translator, "film.screenwriter");
    await c`insert into edition_contributors(edition_id, author_id, role) values (${edition.id}, ${translator}, 'translator')`;
    // A perfumer, and a film person with no credit yet: not in the book directory
    await credit(perfume, await person("Jacques Guerlain", ["perfume"]), "perfume.perfumer");
    await person("Margarita Terekhova", ["film"]);

    expect(await canon()).toEqual(["Agnès Varda", "Richard Howard"]);
  });
});
