import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DURTAL_READER_ANNOTATIONS_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.pathname !== "/sln500_reader_annotations"
  )
    throw new Error(
      "Annotation tests require disposable local sln500_reader_annotations",
    );
}
const client = url ? postgres(url, { max: 2, onnotice: () => {} }) : null;
const refusal = async (statement: Promise<unknown>) =>
  statement.then(
    () => null,
    (error: { code?: string; constraint_name?: string }) => ({
      code: error.code,
      constraint: error.constraint_name,
    }),
  );

/** Native statement-level regressions. No trigger mocking or reset bypass.
 * The harness must recreate this disposable database between suite runs; the
 * permanent ledger and logical clocks are deliberately never truncated in setup or teardown.
 */
describe.skipIf(!url)(
  "permanent annotation identities resist statement-level bypass",
  () => {
    const c = client!;
    beforeAll(async () => {
      await migrate(drizzle(c), { migrationsFolder: "src/lib/db/migrations" });
      const [row] = await c`select (select count(*) from pg_trigger
      where tgrelid in ('public.ebook_annotation_retired_ids'::regclass, 'public.ebook_annotation_cursors'::regclass)
      and tgname in ('ebook_annotation_retirement_no_truncate', 'ebook_annotation_cursor_no_truncate') and not tgisinternal) = 2 as installed`;
      if (!row.installed)
        throw new Error(
          "Reviewed/generated 0083 with its TRUNCATE guard must be installed before native annotation tests",
        );
    }, 60_000);
    afterAll(async () => {
      await client?.end();
    });

    const retired = async () => {
      const annotationId = randomUUID();
      const [book] =
        await c`insert into ebooks (title, import_source) values ('Retirement regression', 'folder') returning id`;
      const digest = createHash("sha256").update(annotationId).digest("hex");
      const [file] =
        await c`insert into ebook_files (ebook_id, sha256, format, size_bytes, content_type, s3_key, status)
      values (${book.id}, ${digest}, 'epub', 1000, 'application/epub+zip', ${`test/annotations/${annotationId}.epub`}, 'stored') returning id`;
      await c`insert into ebook_annotation_retired_ids (id, ebook_id, retired_at)
      values (${annotationId}, ${book.id}, public.durtal_annotation_tick(${book.id}::uuid))`;
      return {
        annotationId,
        ebookId: book.id as string,
        fileId: file.id as string,
        digest,
      };
    };

    it("refuses direct TRUNCATE and keeps the exact retirement identity", async () => {
      const item = await retired();
      const before =
        await c`select id, ebook_id, retired_at::text as retired_at from ebook_annotation_retired_ids where id = ${item.annotationId}`;
      expect(
        await refusal(c`truncate only ebook_annotation_retired_ids`),
      ).toEqual({
        code: "23514",
        constraint: "ebook_annotation_retirement_no_truncate",
      });
      expect(
        await c`select id, ebook_id, retired_at::text as retired_at from ebook_annotation_retired_ids where id = ${item.annotationId}`,
      ).toEqual(before);
    });

    it("refuses cascading TRUNCATE and rolls back every affected book/file/clock", async () => {
      const item = await retired();
      const clocks =
        await c`select ebook_id, server_time::text as server_time from ebook_annotation_cursors where ebook_id = ${item.ebookId}`;
      const denied = await refusal(c`truncate ebooks restart identity cascade`);
      expect(denied?.code).toBe("23514");
      // PostgreSQL may visit either protected table first in a cascading set.
      expect([
        "ebook_annotation_retirement_no_truncate",
        "ebook_annotation_cursor_no_truncate",
      ]).toContain(denied?.constraint);
      expect(await c`select id from ebooks where id = ${item.ebookId}`).toEqual(
        [{ id: item.ebookId }],
      );
      expect(
        await c`select id from ebook_files where id = ${item.fileId}`,
      ).toEqual([{ id: item.fileId }]);
      expect(
        await c`select ebook_id, server_time::text as server_time from ebook_annotation_cursors where ebook_id = ${item.ebookId}`,
      ).toEqual(clocks);
      expect(
        await c`select id from ebook_annotation_retired_ids where id = ${item.annotationId}`,
      ).toEqual([{ id: item.annotationId }]);
    });

    it.each(["direct", "cascade"])(
      "refuses %s cursor truncation without resetting the next timestamp",
      async (mode) => {
        const item = await retired();
        const before =
          await c`select ebook_id, server_time::text as server_time from ebook_annotation_cursors where ebook_id = ${item.ebookId}`;
        const statement =
          mode === "direct"
            ? c`truncate only ebook_annotation_cursors`
            : c`truncate ebook_annotation_cursors cascade`;
        expect(await refusal(statement)).toEqual({
          code: "23514",
          constraint: "ebook_annotation_cursor_no_truncate",
        });
        expect(
          await c`select ebook_id, server_time::text as server_time from ebook_annotation_cursors where ebook_id = ${item.ebookId}`,
        ).toEqual(before);
        const [advanced] =
          await c`select public.durtal_annotation_tick(${item.ebookId}::uuid) > ${before[0].server_time}::timestamptz as advanced`;
        expect(advanced.advanced).toBe(true);
      },
    );

    it("failed statement-level erasure cannot permit delayed creation after full-row purge", async () => {
      const item = await retired();
      expect(
        await c`select id from ebook_annotations where id = ${item.annotationId}`,
      ).toEqual([]);
      expect(
        await refusal(c`truncate ebook_annotation_retired_ids cascade`),
      ).toEqual({
        code: "23514",
        constraint: "ebook_annotation_retirement_no_truncate",
      });
      const locator = {
        v: 1,
        fileHash: item.digest,
        href: "chapter.xhtml",
        sectionIndex: 0,
        progression: 0.1,
        totalProgression: 0.1,
        text: { highlight: "Retained passage" },
      };
      expect(
        await refusal(c`insert into ebook_annotations (id, ebook_id, file_id, kind, style, color, locator, progression, text, client_updated_at)
      values (${item.annotationId}, ${item.ebookId}, ${item.fileId}, 'highlight', 'highlight', 'ochre', ${JSON.stringify(locator)}::jsonb, 0.1, 'Retained passage', clock_timestamp())`),
      ).toEqual({ code: "23514", constraint: "ebook_annotation_retired_id" });
      expect(
        await c`select id from ebook_annotations where id = ${item.annotationId}`,
      ).toEqual([]);
      expect(
        await c`select id from ebook_annotation_retired_ids where id = ${item.annotationId}`,
      ).toEqual([{ id: item.annotationId }]);
    });
  },
);
