import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DURTAL_EBOOK_CONSTRAINTS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/sln518_ebook_constraints")
    throw new Error("E-book constraint tests require disposable local sln518_ebook_constraints");
}
const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;

/** The SQLSTATE and the constraint a refused statement names; null when it was accepted */
async function refusal(statement: Promise<unknown>) {
  const error = await statement.then(
    () => null,
    (e: { code?: string; constraint_name?: string }) => e,
  );
  return error && { code: error.code, constraint: error.constraint_name };
}

/*
 * SLN-518: a file belongs to exactly one e-book, so nothing can point at
 * another e-book's file, and the value lists of the epic's contract are
 * checked (migration 0080).
 */
describe.skipIf(!url)("the e-book constraints", () => {
  const c = client!;
  let n = 0;
  const ebook = async (fields: Record<string, unknown> = {}) =>
    (await c`insert into ebooks ${c({ title: "Là-bas", import_source: "folder", ...fields })} returning id`)[0].id as string;
  const file = async (ebookId: string, fields: Record<string, unknown> = {}) => {
    n += 1;
    const [row] = await c`insert into ebook_files ${c({
      ebook_id: ebookId,
      sha256: n.toString(16).padStart(64, "0"),
      format: "epub",
      size_bytes: 1000,
      content_type: "application/epub+zip",
      s3_key: `gold/ebooks/${n}.epub`,
      status: "stored",
      ...fields,
    })} returning id`;
    return row.id as string;
  };
  const position = (ebookId: string, fileId: string) =>
    c`insert into ebook_positions ${c({
      ebook_id: ebookId,
      file_id: fileId,
      device_id: "device",
      device_label: "Mac · Firefox",
      locator: JSON.stringify({ href: "chapter-1.xhtml" }),
      progression: 0.1,
      furthest_progression: 0.1,
      client_updated_at: new Date().toISOString(),
    })}`;
  const annotation = (ebookId: string, fileId: string) =>
    c`insert into ebook_annotations ${c({
      ebook_id: ebookId,
      file_id: fileId,
      kind: "bookmark",
      locator: JSON.stringify({ href: "chapter-1.xhtml" }),
      progression: 0.1,
      client_updated_at: new Date().toISOString(),
    })}`;

  beforeAll(async () => {
    await migrate(drizzle(c), { migrationsFolder: "src/lib/db/migrations" });
  }, 60000);
  afterAll(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await c`truncate ebook_annotations, ebook_positions, ebook_files, ebooks cascade`;
  });

  it("refuses a position, an annotation or a preferred file of another e-book", async () => {
    const labas = await ebook();
    const rebours = await ebook({ title: "À rebours" });
    const labasFile = await file(labas);
    const reboursFile = await file(rebours);
    const foreignKey = (constraint: string) => ({ code: "23503", constraint });
    expect(await refusal(position(labas, reboursFile))).toEqual(foreignKey("ebook_positions_file_ebook_fk"));
    expect(await refusal(annotation(labas, reboursFile))).toEqual(foreignKey("ebook_annotations_file_ebook_fk"));
    expect(await refusal(c`update ebooks set preferred_file_id = ${reboursFile} where id = ${labas}`)).toEqual(
      foreignKey("ebooks_preferred_file_ebook_fk"),
    );
    // Its own file is accepted for each
    expect(await refusal(position(labas, labasFile))).toBeNull();
    expect(await refusal(annotation(labas, labasFile))).toBeNull();
    expect(await refusal(c`update ebooks set preferred_file_id = ${labasFile} where id = ${labas}`)).toBeNull();
  });

  it("refuses a value outside each list, and accepts every listed value and null", async () => {
    const check = (constraint: string) => ({ code: "23514", constraint });
    expect(await refusal(ebook({ import_source: "sync" }))).toEqual(check("ebooks_import_source_check"));
    expect(await refusal(ebook({ match_method: "guess" }))).toEqual(check("ebooks_match_method_check"));
    expect(await refusal(file(await ebook(), { drm: "kfx" }))).toEqual(check("ebook_files_drm_check"));

    for (const importSource of ["folder", "upload"]) expect(await refusal(ebook({ import_source: importSource }))).toBeNull();
    for (const matchMethod of ["isbn", "identifier", "score", "manual", "accession", null])
      expect(await refusal(ebook({ match_method: matchMethod })), String(matchMethod)).toBeNull();
    const holder = await ebook();
    for (const drm of ["adobe-adept", "kindle", "readium-lcp", "apple-fairplay", "pdf-password", "unknown", null])
      expect(await refusal(file(holder, { drm })), String(drm)).toBeNull();
  });

  it("deleting a file clears the preferred file, deletes its positions, and is refused while an annotation names it", async () => {
    const labas = await ebook();
    const first = await file(labas);
    const second = await file(labas);
    await c`update ebooks set preferred_file_id = ${first} where id = ${labas}`;
    await position(labas, first);
    await annotation(labas, second);

    await c`delete from ebook_files where id = ${first}`;
    expect(await c`select id, preferred_file_id from ebooks`).toEqual([{ id: labas, preferred_file_id: null }]);
    expect(await c`select count(*)::int as n from ebook_positions`).toEqual([{ n: 0 }]);

    expect(await refusal(c`delete from ebook_files where id = ${second}`)).toEqual({ code: "23503", constraint: "ebook_annotations_file_ebook_fk" });
    expect(await c`select count(*)::int as n from ebook_files`).toEqual([{ n: 1 }]);
  });
});
