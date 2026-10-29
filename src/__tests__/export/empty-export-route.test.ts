import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ParquetReader } from "@dsnp/parquetjs";
import { DURTAL_EXPORT_HEADERS } from "@/lib/export/columns";
import { NATIVE_EXPORTS } from "@/lib/export/schema";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { FORMAT_MIME } from "@/lib/export/formats";

const mocks = vi.hoisted(() => ({ rows: vi.fn(async () => []) }));
vi.mock("@/lib/export/catalogue", () => ({ fetchWorksForExport: mocks.rows, fetchAuthorsForExport: mocks.rows }));
vi.mock("@/lib/export/collections", () => ({ COLLECTION_EXPORTS: { films: "film", perfumes: "perfume", paintings: "painting" }, collectionExportRows: mocks.rows }));
vi.mock("@/lib/export/reading", async () => {
  const columns = await import("@/lib/export/columns");
  return {
    ...columns,
    readingExportRows: mocks.rows, sessionExportRows: mocks.rows, noteExportRows: mocks.rows,
    commonplaceNotes: mocks.rows, loadGoodreadsBooks: mocks.rows,
  };
});
vi.mock("@/lib/reading/journal", () => ({ journalReadingIds: mocks.rows }));
vi.mock("@/lib/utils/date", () => ({ todayLocal: () => "2026-10-20" }));
import { POST } from "@/app/api/export/route";

const request = (body: unknown) => new NextRequest("http://localhost/api/export", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const entities = Object.keys(NATIVE_EXPORTS) as (keyof typeof NATIVE_EXPORTS)[];
const formats = ["csv", "tsv", "json", "parquet"] as const;
const cases = entities.flatMap((entity) => formats.map((format) => ({ entity, format })));
beforeEach(() => { vi.clearAllMocks(); });

describe("empty whole-entity downloads", () => {
  it.each(cases)("$entity $format remains a complete empty file", async ({ entity, format }) => {
    const response = await POST(request({ entity, format, all: true }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(FORMAT_MIME[format]);
    expect(response.headers.get("Content-Disposition")).toMatch(/-all-2026-10-20\./);
    if (format === "csv" || format === "tsv") {
      expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(`\uFEFF${DURTAL_EXPORT_HEADERS[entity].join(format === "csv" ? "," : "\t")}`, "utf8"));
    } else if (format === "json") {
      expect(await response.json()).toEqual([]);
      expect(response.headers.get("X-Durtal-Export-Schema")).toBe(`${NATIVE_EXPORTS[entity].entity}/${NATIVE_EXPORTS[entity].version}`);
    } else {
      const reader = await ParquetReader.openBuffer(Buffer.from(await response.arrayBuffer()));
      try {
        expect(reader.getRowCount().toString()).toBe("0");
        expect(await reader.getCursor().next()).toBeNull();
        expect(Object.keys(reader.getSchema().fields)).toEqual(Object.keys(NATIVE_EXPORTS[entity].fields));
        expect(reader.getMetadata()).toEqual({ "durtal.entity": NATIVE_EXPORTS[entity].entity, "durtal.schema_version": String(NATIVE_EXPORTS[entity].version) });
      } finally { await reader.close(); }
    }
  });

  it("keeps Goodreads' complete empty header without a BOM", async () => {
    const response = await POST(request({ entity: "goodreads", format: "csv", all: true }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(GOODREADS_EXPORT_HEADER.join(","));
  });

  it("uses one clear sentence for the empty commonplace download", async () => {
    const response = await POST(request({ entity: "reading-notes", format: "md", all: true }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("# Commonplace book\n\nNo quotes or notes to export from Durtal on 20 October 2026.\n");
  });
});

describe("empty downloads do not hide request errors", () => {
  const selections = (["works", "authors", "films", "perfumes", "paintings"] as const)
    .flatMap((entity) => formats.map((format) => ({ entity, format })));
  it.each(selections)("unknown selected $entity IDs still return 404 for $format", async ({ entity, format }) => {
    const response = await POST(request({ entity, format, ids: ["11111111-1111-1111-1111-111111111111"] }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No matching records were found." });
  });

  it.each([null, [], 1, "text", {}, { entity: "unknown", all: true, format: "csv" }, { entity: "works", all: true, format: "md" }, { entity: "works", ids: ["bad"], format: "csv" }, { entity: "goodreads", all: true, format: "tsv" }].map((body) => ({ body })))("invalid body $body still returns 400", async ({ body }) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it("returns 400 for broken JSON before loading records", async () => {
    const response = await POST(new NextRequest("http://localhost/api/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
