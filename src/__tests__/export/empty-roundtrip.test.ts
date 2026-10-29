import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { NATIVE_EXPORTS, NATIVE_EXPORTS_V2 } from "@/lib/export/schema";
import { nativeParquet } from "@/lib/export/parquet";
import { FORMAT_MIME } from "@/lib/export/formats";
const mocks = vi.hoisted(() => ({ rows: vi.fn(async () => []), create: vi.fn(), upload: vi.fn(), bronze: vi.fn() }));
vi.mock("@/lib/export/catalogue", () => ({ fetchWorksForExport: mocks.rows, fetchAuthorsForExport: mocks.rows }));
vi.mock("@/lib/export/collections", () => ({ COLLECTION_EXPORTS: { films: "film", perfumes: "perfume", paintings: "painting" }, collectionExportRows: mocks.rows }));
vi.mock("@/lib/export/reading", async () => ({ ...await import("@/lib/export/columns"), readingExportRows: mocks.rows, sessionExportRows: mocks.rows, noteExportRows: mocks.rows, commonplaceNotes: mocks.rows, loadGoodreadsBooks: mocks.rows }));
vi.mock("@/lib/reading/journal", () => ({ journalReadingIds: mocks.rows }));
vi.mock("@/lib/reading/import/store", () => ({ createReadingImport: mocks.create, setBronzeKey: mocks.bronze, safeFileName: (s: string) => s }));
vi.mock("@/lib/s3/covers", () => ({ uploadToS3: mocks.upload }));
import { POST as exportFile } from "@/app/api/export/route";
import { POST as importFile } from "@/app/api/reading/import/route";
const exported = (entity: string, format: string) => exportFile(new NextRequest("http://localhost/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entity, format, all: true }) }));
function request(file: File) { const body = new FormData(); body.append("file", file); return new NextRequest("http://localhost/api/reading/import", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body }); }
function noWrites() { expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled(); expect(mocks.bronze).not.toHaveBeenCalled(); }
beforeEach(() => vi.clearAllMocks());
const cases = Object.keys(NATIVE_EXPORTS).flatMap(entity => (["csv", "tsv", "json", "parquet"] as const).map(format => ({ entity, format })));
describe("empty exports round-trip without writes (SLN-1183)", () => {
  it.each(cases)("$entity $format", async ({ entity, format }) => {
    const response = await exported(entity, format); expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    const imported = await importFile(request(new File([bytes], `empty.${format}`, { type: FORMAT_MIME[format] })));
    expect(imported.status).toBe(200); expect(await imported.json()).toMatchObject({ kind: "empty", rows: 0, entity: format === "json" ? "export" : entity }); noWrites();
  });
  it("accepts its empty Goodreads download", async () => {
    const response = await exported("goodreads", "csv");
    const imported = await importFile(request(new File([await response.arrayBuffer()], "goodreads.csv", { type: "text/csv" })));
    expect(imported.status).toBe(200); expect(await imported.json()).toMatchObject({ kind: "empty", source: "goodreads", rows: 0 }); noWrites();
  });
  it.each(["readings", "reading-sessions", "reading-notes"] as const)("still accepts an empty version-2 %s Parquet", async (entity) => {
    const bytes = await nativeParquet(NATIVE_EXPORTS_V2[entity], []);
    const response = await importFile(request(new File([new Uint8Array(bytes)], "old.parquet", { type: FORMAT_MIME.parquet })));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ kind: "empty", entity, rows: 0 }); noWrites();
  });
  it("rejects unknown Parquet provenance and incomplete columns", async () => {
    for (const definition of [
      { ...NATIVE_EXPORTS.authors, entity: "foreign" },
      { ...NATIVE_EXPORTS.authors, fields: { name: NATIVE_EXPORTS.authors.fields.name } },
    ]) {
      const bytes = await nativeParquet(definition, []);
      const response = await importFile(request(new File([new Uint8Array(bytes)], "wrong.parquet", { type: FORMAT_MIME.parquet })));
      expect(response.status).toBe(400); noWrites();
    }
  });
  it("rejects invalid UTF-8 before allocating an import", async () => {
    const response = await importFile(request(new File([new Uint8Array([0xff, 0xff])], "bad.csv", { type: "text/csv" })));
    expect(response.status).toBe(400); expect((await response.json()).error).toContain("UTF-8"); noWrites();
  });
  it.each(["[", "{}", "null", '[{"title":"A real book"}]'])("refuses non-empty or malformed JSON: %s", async (text) => {
    const response = await importFile(request(new File([text], "export.json", { type: "application/json" })));
    expect(response.status).toBe(400); noWrites();
  });
  it("refuses malformed and populated Parquet without dropping records", async () => {
    const invalid = await importFile(request(new File(["PAR1brokenPAR1"], "export.parquet", { type: FORMAT_MIME.parquet })));
    expect(invalid.status).toBe(400);
    const definition = NATIVE_EXPORTS.authors;
    const row = Object.fromEntries(Object.entries(definition.fields).map(([key, field]) => [key, field.nullable ? null : field.kind === "boolean" ? false : field.kind === "text" ? "Person" : 0]));
    const bytes = await nativeParquet(definition, [row]);
    const full = await importFile(request(new File([new Uint8Array(bytes)], "people.parquet", { type: FORMAT_MIME.parquet })));
    expect(full.status).toBe(400); expect((await full.json()).error).toContain("has records"); noWrites();
  });
});
