
import { PERSON_CREDITS } from "@/lib/catalogue/person-boundary";

import { bookCondition } from "@/lib/catalogue/book-boundary";
import { NextRequest, NextResponse } from "next/server";
import { getAcquisitionTargetsForExport } from "@/lib/actions/publishers";
import { db } from "@/lib/db";
import { getWorkDigitalAvailability, type WorkDigitalAvailability } from "@/lib/ebooks/work-availability";
import { ebookExportFormats, workEbookDTO } from "@/lib/ebooks/catalogue-dto";
import { todayLocal } from "@/lib/utils/date";
import { isUuid } from "@/lib/utils/uuid";
import { works, workAuthors, authors } from "@/lib/db/schema";
import { inArray, asc, and, sql } from "drizzle-orm";
import {
  toCSV,
  toTSV,
  toJSON,
  toParquet,
  FORMAT_MIME,
  FORMAT_EXT,
  type ExportFormat,
} from "@/lib/utils/export";
import { resultRows } from "@/lib/harmonization/store";
import { uuids } from "@/lib/catalogue/work-store";
import { compareTitles, compareWorks } from "@/lib/utils/title-order";
import { slugify } from "@/lib/utils/slugify";
import {
  COLLECTION_EXPORTS,
  collectionExportRows,
  type CollectionExport,
} from "@/lib/export/collections";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import { formatRating } from "@/lib/utils/rating";
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
 * Parquet typed, a missing value null (SLN-894). `headers` fixes the columns;
 * without, the first row's keys.
 */
async function exportFile(
  rows: Record<string, unknown>[],
  headers: readonly string[] | undefined,
  format: Exclude<ExportFormat, "md">,
  filename: string,
  forImport = false,
) {
  const disposition = `attachment; filename="${filename}${FORMAT_EXT[format]}"`;
  let body: string | Uint8Array;
  if (format === "csv") body = toCSV(rows, headers, { forImport });
  else if (format === "tsv") body = toTSV(rows, headers);
  else if (format === "json") body = toJSON(rows, headers);
  else {
    const buf = await toParquet(rows, headers);
    body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: { "Content-Type": FORMAT_MIME[format], "Content-Disposition": disposition },
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
  if (entity === "readings") {
    const ids = filters === null ? null : await journalReadingIds(parseJournalQuery(Object.fromEntries(params.entries())));
    return { rows: await readingExportRows(ids), headers: READING_EXPORT_COLUMNS };
  }
  if (entity === "reading-sessions") return { rows: await sessionExportRows(null), headers: SESSION_EXPORT_COLUMNS };
  if (entity === "reading-notes") {
    const query = filters === null ? {} : parseNotesQuery(params);
    if (format === "md") return { markdown: commonplaceMarkdown(await commonplaceNotes(query), todayLocal()) };
    return { rows: await noteExportRows(query), headers: NOTE_EXPORT_COLUMNS };
  }
  const rows = (await loadGoodreadsBooks()).flatMap((book) => goodreadsRow(book) ?? []);
  return { rows, headers: GOODREADS_EXPORT_HEADER };
}

/** The books with these ids, or every book (null), in title order */
async function fetchWorksForExport(ids: string[] | null) {
  const results = await db.query.works.findMany({
    where: ids ? and(bookCondition, inArray(works.id, ids)) : bookCondition,
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        with: {
          publisherLinks: { with: { publisher: true } },
          instances: {
            columns: { id: true },
          },
        },
      },
    },
  });

  // The lookup takes at most 500 works a call: a whole-catalogue export asks in batches
  const found = results.map((w) => w.id);
  const targets: Awaited<ReturnType<typeof getAcquisitionTargetsForExport>> = [];
  const digital = new Map<string, WorkDigitalAvailability>();
  for (let i = 0; i < found.length; i += 500) {
    targets.push(...(await getAcquisitionTargetsForExport(found.slice(i, i + 500))));
    for (const [id, value] of await getWorkDigitalAvailability(found.slice(i, i + 500), { includePositions: false })) digital.set(id, value);
  }
  return [...results].sort(compareWorks).map((w) => {
    const rating = formatRating(w.rating);
    const authorNames = w.workAuthors.map((wa) => wa.author.name).join("; ");
    const primaryEdition = w.editions[0];
    const totalInstances = w.editions.reduce(
      (sum, e) => sum + e.instances.length,
      0,
    );

    return {
      title: w.title,
      ebook_formats: ebookExportFormats((digital.get(w.id)?.ebooks ?? []).map(workEbookDTO)),
      authors: authorNames,
      original_language: w.originalLanguage,
      original_year: w.originalYear,
      catalogue_status: w.catalogueStatus,
      acquisition_priority: w.acquisitionPriority,
      rating: rating ? Number(rating) : null,
      is_anthology: w.isAnthology,
      isbn_13: primaryEdition?.isbn13 ?? null,
      isbn_10: primaryEdition?.isbn10 ?? null,
      publisher: primaryEdition?.publisher ?? null,
      // Nested lists: JSON and Parquet keep them as data, CSV and TSV write them as JSON text
      acquisition_targets: targets
        .filter((t) => t.target.workId === w.id)
        .map((t) => ({
          ...t.target,
          state: t.state,
          fulfilled_instance_id: t.instanceId,
        })),
      edition_publishers: w.editions.map((e) => ({
        edition_id: e.id,
        isbn_13: e.isbn13,
        publishers: e.publisherLinks.map((l) => ({
          id: l.publisher.id,
          name: l.publisher.name,
          kind: l.publisher.kind,
          parent_id: l.publisher.parentId,
        })),
      })),
      imprint: primaryEdition?.imprint ?? null,
      publication_year: primaryEdition?.publicationYear ?? null,
      edition_language: primaryEdition?.language ?? null,
      binding: primaryEdition?.binding ?? null,
      page_count: primaryEdition?.pageCount ?? null,
      edition_count: w.editions.length,
      instance_count: totalInstances,
      notes: w.notes,
    };
  });
}

/** Where a person's roles stand in the roles column: books first, a book's author first */
const ROLE_ORDER = sql`case cr.kind when 'book' then 0 when 'film' then 1 when 'perfume' then 2 when 'painting' then 3 else 4 end,
  cr.level <> 'work', cr.legacy_role is distinct from 'author', cr.label`;

/** Each person's roles across the collections, as their labels ("Author; Translator; Director") */
async function personRoles(ids: string[] | null) {
  const rows = resultRows<{ personId: string; label: string }>(
    await db.execute(sql`select c.person_id as "personId", cr.label
      from ${PERSON_CREDITS} c join credit_roles cr on cr.id = c.role_id
      ${ids ? sql`where c.person_id in (${uuids(ids)})` : sql``}
      group by c.person_id, cr.kind, cr.level, cr.legacy_role, cr.label
      order by c.person_id, ${ROLE_ORDER}`),
  );
  const roles = new Map<string, string[]>();
  for (const { personId, label } of rows) {
    const held = roles.get(personId) ?? [];
    // A film's editor and a book's editor are one "Editor"
    if (!held.includes(label)) held.push(label);
    roles.set(personId, held);
  }
  return roles;
}

/** The people with these ids, or every person (null), by sort name */
async function fetchAuthorsForExport(ids: string[] | null) {
  const [results, roles] = await Promise.all([
    db.query.authors.findMany({
      where: ids ? inArray(authors.id, ids) : undefined,
      with: {
        country: true,
        workAuthors: {
          columns: { workId: true },
        },
      },
    }),
    personRoles(ids),
  ]);
  const sortKey = (a: (typeof results)[number]) => a.sortName || a.name;

  return [...results]
    .sort((a, b) => compareTitles(sortKey(a), sortKey(b)) || a.id.localeCompare(b.id))
    .map((a) => ({
      name: a.name,
      sort_name: a.sortName,
      first_name: a.firstName,
      last_name: a.lastName,
      real_name: a.realName,
      roles: (roles.get(a.id) ?? []).join("; "),
      nationality: a.country?.name ?? null,
      gender: a.gender,
      birth_year: a.birthYear,
      birth_month: a.birthMonth,
      birth_day: a.birthDay,
      death_year: a.deathYear,
      death_month: a.deathMonth,
      death_day: a.deathDay,
      bio: a.bio ? stripHtmlToText(a.bio) : null,
      website: a.website,
      works_count: a.workAuthors.length,
    }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
    // A collection that is not open has nothing to export yet
    if (
      isCollection(entity as EntityType) &&
      !WORK_DOMAINS[COLLECTION_EXPORTS[entity as CollectionExport]].enabled
    ) {
      return NextResponse.json({ error: "This collection is not open." }, { status: 404 });
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
      return exportFile(result.rows, result.headers, fmt as Exclude<ExportFormat, "md">, name, entity === "goodreads");
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
    const rows = isCollection(entityType)
      ? await collectionExportRows(entityType, selection)
      : entityType === "works"
        ? await fetchWorksForExport(selection)
        : await fetchAuthorsForExport(selection);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No records found for the given IDs." },
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
    return exportFile(rows, undefined, fmt as Exclude<ExportFormat, "md">, `durtal-${slug}-${todayLocal()}`);
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
