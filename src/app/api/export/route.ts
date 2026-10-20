import { fetchWorksForExport, fetchAuthorsForExport } from "@/lib/export/catalogue";
import { NATIVE_EXPORTS, type ExportDefinition, type NativeEntity } from "@/lib/export/schema";

import { NextRequest, NextResponse } from "next/server";
import { todayLocal } from "@/lib/utils/date";
import { isUuid } from "@/lib/utils/uuid";
import {
  toCSV,
  toTSV,
  toJSON,
  toParquet,
  FORMAT_MIME,
  FORMAT_EXT,
  type ExportFormat,
} from "@/lib/utils/export";
import { slugify } from "@/lib/utils/slugify";
import {
  COLLECTION_EXPORTS,
  collectionExportRows,
  type CollectionExport,
} from "@/lib/export/collections";
import {
  READING_EXPORT_COLUMNS,
  SESSION_EXPORT_COLUMNS,
  NOTE_EXPORT_COLUMNS,
  commonplaceNotes,
  loadGoodreadsBooks,
  noteExportRows,
  readingExportRows,
  sessionExportRows,
} from "@/lib/export/reading";
import { goodreadsRow } from "@/lib/export/goodreads";
import { commonplaceMarkdown } from "@/lib/export/commonplace";
import { GOODREADS_EXPORT_HEADER } from "@/lib/reading/import/formats";
import { parseJournalQuery } from "@/lib/reading/journal-params";
import { journalReadingIds } from "@/lib/reading/journal";
import { parseNotesQuery } from "@/lib/reading/notes-params";
import { exportFormatsFor } from "@/lib/export/formats";

const VALID_FORMATS: ExportFormat[] = ["csv", "tsv", "parquet", "md", "json"];
const VALID_ENTITIES = [
  "works",
  "authors",
  "perfumes",
  "films",
  "paintings",
  "readings",
  "reading-sessions",
  "reading-notes",
  "goodreads",
] as const;
type EntityType = (typeof VALID_ENTITIES)[number];
const isCollection = (entity: EntityType): entity is CollectionExport =>
  entity in COLLECTION_EXPORTS;

/** The reading exports (SLN-458): whole files with a fixed header, written even with no rows */
const READING_ENTITIES = ["readings", "reading-sessions", "reading-notes", "goodreads"] as const;
type ReadingEntity = (typeof READING_ENTITIES)[number];
const isReading = (entity: EntityType): entity is ReadingEntity => (READING_ENTITIES as readonly string[]).includes(entity);

const formatsOf = exportFormatsFor;

/** The journal and the commonplace book export what their filters show: their own URL query */
const FILTERED_ENTITIES: EntityType[] = ["readings", "reading-notes"];

/**
 * What a file is named after (SLN-894): `durtal-<kind>[-all]-<date>`, "-all"
 * when it holds every record; one record's file is named after the record.
 */
const FILE_NAMES: Record<EntityType, string> = {
  works: "books",
  authors: "people",
  perfumes: "perfumes",
  films: "films",
  paintings: "paintings",
  readings: "readings",
  "reading-sessions": "reading-sessions",
  "reading-notes": "reading-notes",
  goodreads: "goodreads",
};
/** One record's kind, for a file whose record's name gives no slug ("Война и мир") */
const SINGULAR: Partial<Record<EntityType, string>> = {
  works: "book",
  authors: "person",
  perfumes: "perfume",
  films: "film",
  paintings: "painting",
};

/**
 * One export file: CSV and TSV with their header even with no rows, JSON and
 * Parquet use an explicit native schema. Legacy headers always fix CSV/TSV
 * columns; native DTO sidecars never enter their output.
 */
async function exportFile(
  rows: Record<string, unknown>[],
  headers: readonly string[],
  format: Exclude<ExportFormat, "md">,
  filename: string,
  forImport = false,
  definition?: ExportDefinition,
) {
  const disposition = `attachment; filename="${filename}${FORMAT_EXT[format]}"`;
  let body: string | Uint8Array;
  if (format === "csv") body = toCSV(rows, headers, { forImport });
  else if (format === "tsv") body = toTSV(rows, headers);
  else if (format === "json") {
    if (!definition) throw new Error("Missing native export definition");
    body = toJSON(definition, rows);
  }
  else {
    if (!definition) throw new Error("Missing native export definition");
    const buf = await toParquet(definition, rows);
    body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": FORMAT_MIME[format], "Content-Disposition": disposition,
      ...((format === "json" || format === "parquet") && definition ? { "X-Durtal-Export-Schema": `${definition.entity}/${definition.version}` } : {}),
    },
  });
}

/**
 * A reading export's rows and header, or the Markdown commonplace book.
 * `filters` is the journal's or the commonplace book's URL query, parsed by
 * the page's own parser; null exports everything.
 */
async function readingExport(
  entity: ReadingEntity,
  format: ExportFormat,
  filters: string | null,
): Promise<{ rows: Record<string, unknown>[]; headers: readonly string[] } | { markdown: string }> {
  const params = new URLSearchParams(filters ?? "");
  const native = format === "json" || format === "parquet";
  if (entity === "readings") {
    const ids = filters === null ? null : await journalReadingIds(parseJournalQuery(Object.fromEntries(params.entries())));
    return { rows: await readingExportRows(ids, native), headers: READING_EXPORT_COLUMNS };
  }
  if (entity === "reading-sessions") return { rows: await sessionExportRows(null, native), headers: SESSION_EXPORT_COLUMNS };
  if (entity === "reading-notes") {
    const query = filters === null ? {} : parseNotesQuery(params);
    if (format === "md") return { markdown: commonplaceMarkdown(await commonplaceNotes(query), todayLocal()) };
    return { rows: await noteExportRows(query, native), headers: NOTE_EXPORT_COLUMNS };
  }
  const rows = (await loadGoodreadsBooks()).flatMap((book) => goodreadsRow(book) ?? []);
  return { rows, headers: GOODREADS_EXPORT_HEADER };
}

export async function POST(req: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "The export request must be a JSON object." }, { status: 400 });
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "The export request must be a JSON object." }, { status: 400 });
    }
    const { entity, ids, all, filters, format } = body as {
      entity?: string;
      ids?: string[];
      /** Every record of the kind instead of a list of ids */
      all?: boolean;
      /** The journal's or the commonplace book's URL query: what the page shows */
      filters?: string;
      format?: string;
    };

    if (!entity || !VALID_ENTITIES.includes(entity as EntityType)) {
      return NextResponse.json(
        { error: `Invalid entity type. Must be one of: ${VALID_ENTITIES.join(", ")}.` },
        { status: 400 },
      );
    }
    if (filters !== undefined) {
      if (typeof filters !== "string" || filters.length > 2000)
        return NextResponse.json({ error: "filters must be a URL query of at most 2,000 characters." }, { status: 400 });
      if (!FILTERED_ENTITIES.includes(entity as EntityType))
        return NextResponse.json({ error: "Only readings and reading notes take filters." }, { status: 400 });
    }
    if (!format || !VALID_FORMATS.includes(format as ExportFormat) || !formatsOf(entity as EntityType).includes(format as ExportFormat)) {
      return NextResponse.json(
        { error: `Invalid format. Must be one of: ${formatsOf(entity as EntityType).map((f) => `'${f}'`).join(", ")}.` },
        { status: 400 },
      );
    }

    // A reading export is a whole file: every reading, or what a page's filters show
    if (isReading(entity as EntityType)) {
      if (all !== true && filters === undefined)
        return NextResponse.json({ error: "all must be true, or filters given." }, { status: 400 });
      const fmt = format as ExportFormat;
      const name = `durtal-${FILE_NAMES[entity as ReadingEntity]}${filters === undefined ? "-all" : ""}-${todayLocal()}`;
      const result = await readingExport(entity as ReadingEntity, fmt, filters ?? null);
      if ("markdown" in result)
        return new NextResponse(result.markdown, {
          status: 200,
          headers: { "Content-Type": FORMAT_MIME.md, "Content-Disposition": `attachment; filename="${name}.md"` },
        });
      // An empty export still has its header, and an empty Parquet file its schema.
      // The Goodreads file is for Goodreads and StoryGraph to import, not for a spreadsheet: as stored, no guard or BOM
      return exportFile(result.rows, result.headers, fmt as Exclude<ExportFormat, "md">, name, entity === "goodreads", entity === "goodreads" ? undefined : NATIVE_EXPORTS[entity as NativeEntity]);
    }

    if (all !== true && (!ids || !Array.isArray(ids) || ids.length === 0)) {
      return NextResponse.json(
        { error: "ids must be a non-empty array, or all must be true." },
        { status: 400 },
      );
    }

    if (all !== true && ids!.length > 500) {
      return NextResponse.json(
        { error: "Too many IDs. Maximum: 500." },
        { status: 400 },
      );
    }

    if (all !== true && !ids!.every(isUuid)) {
      return NextResponse.json({ error: "Every id must be a UUID." }, { status: 400 });
    }

    const fmt = format as ExportFormat;
    const entityType = entity as EntityType;

    const selection = all === true ? null : ids!;
    const native = fmt === "json" || fmt === "parquet";
    const definition = NATIVE_EXPORTS[entityType as NativeEntity];
    const rows = isCollection(entityType)
      ? await collectionExportRows(entityType, selection, native)
      : entityType === "works"
        ? await fetchWorksForExport(selection, native)
        : await fetchAuthorsForExport(selection, native);

    if (rows.length === 0 && all !== true) {
      return NextResponse.json(
        { error: "No matching records were found." },
        { status: 404 },
      );
    }

    // Every record: durtal-books-all-<date>; a selection: durtal-books-<date>; one record: named after it
    let slug = `${FILE_NAMES[entityType]}${all === true ? "-all" : ""}`;
    if (all !== true && ids!.length === 1 && rows.length === 1) {
      const row = rows[0] as { first_name?: string | null; last_name?: string | null; name?: string; title?: string };
      let own = "";
      if (entityType === "authors") {
        const first = slugify(row.first_name ?? "");
        const last = slugify(row.last_name ?? "");
        own = first && last ? `${first}-${last}` : slugify(row.name ?? "");
      } else {
        own = slugify(row.title ?? "");
      }
      // A name in a script slugs drop (Cyrillic, Greek, Japanese) keeps the files apart by the record's id
      slug = own || `${SINGULAR[entityType]}-${ids![0].slice(0, 8)}`;
    }
    return exportFile(rows, definition.legacyHeaders, fmt as Exclude<ExportFormat, "md">, `durtal-${slug}-${todayLocal()}`, false, definition);
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
