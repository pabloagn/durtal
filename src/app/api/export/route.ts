
import { bookPersonCondition } from "@/lib/catalogue/person-boundary";

import { bookCondition } from "@/lib/catalogue/book-boundary";
import { NextRequest, NextResponse } from "next/server";
import { getAcquisitionTargetsForExport } from "@/lib/actions/publishers";
import { db } from "@/lib/db";
import { todayLocal } from "@/lib/utils/date";
import { works, workAuthors, authors } from "@/lib/db/schema";
import { inArray, asc, and } from "drizzle-orm";
import {
  toCSV,
  toTSV,
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
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { stripHtmlToText } from "@/lib/utils/sanitize";

const VALID_FORMATS: ExportFormat[] = ["csv", "tsv", "parquet"];
const VALID_ENTITIES = ["works", "authors", "perfumes", "films", "paintings"] as const;
type EntityType = (typeof VALID_ENTITIES)[number];
const isCollection = (entity: EntityType): entity is CollectionExport =>
  entity in COLLECTION_EXPORTS;

/** The books with these ids, or every book (null) */
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
  for (let i = 0; i < found.length; i += 500) {
    targets.push(...(await getAcquisitionTargetsForExport(found.slice(i, i + 500))));
  }
  return results.map((w) => {
    const authorNames = w.workAuthors.map((wa) => wa.author.name).join("; ");
    const primaryEdition = w.editions[0];
    const totalInstances = w.editions.reduce(
      (sum, e) => sum + e.instances.length,
      0,
    );

    return {
      title: w.title,
      authors: authorNames,
      original_language: w.originalLanguage ?? "",
      original_year: w.originalYear ?? "",
      catalogue_status: w.catalogueStatus,
      acquisition_priority: w.acquisitionPriority,
      rating: w.rating ?? "",
      is_anthology: w.isAnthology ? "yes" : "no",
      isbn_13: primaryEdition?.isbn13 ?? "",
      isbn_10: primaryEdition?.isbn10 ?? "",
      publisher: primaryEdition?.publisher ?? "",
      acquisition_targets: JSON.stringify(
        targets
          .filter((t) => t.target.workId === w.id)
          .map((t) => ({
            ...t.target,
            state: t.state,
            fulfilled_instance_id: t.instanceId,
          })),
      ),
      edition_publishers: JSON.stringify(
        w.editions.map((e) => ({
          edition_id: e.id,
          isbn_13: e.isbn13,
          publishers: e.publisherLinks.map((l) => ({
            id: l.publisher.id,
            name: l.publisher.name,
            kind: l.publisher.kind,
            parent_id: l.publisher.parentId,
          })),
        })),
      ),
      imprint: primaryEdition?.imprint ?? "",
      publication_year: primaryEdition?.publicationYear ?? "",
      edition_language: primaryEdition?.language ?? "",
      binding: primaryEdition?.binding ?? "",
      page_count: primaryEdition?.pageCount ?? "",
      edition_count: w.editions.length,
      instance_count: totalInstances,
      notes: w.notes ?? "",
    };
  });
}

/** The authors with these ids, or every book author (null) */
async function fetchAuthorsForExport(ids: string[] | null) {
  const results = await db.query.authors.findMany({
    where: ids ? and(bookPersonCondition, inArray(authors.id, ids)) : bookPersonCondition,
    with: {
      country: true,
      workAuthors: {
        columns: { workId: true },
      },
    },
  });

  return results.map((a) => ({
    name: a.name,
    sort_name: a.sortName ?? "",
    first_name: a.firstName ?? "",
    last_name: a.lastName ?? "",
    real_name: a.realName ?? "",
    nationality: a.country?.name ?? "",
    gender: a.gender ?? "",
    birth_year: a.birthYear ?? "",
    birth_month: a.birthMonth ?? "",
    birth_day: a.birthDay ?? "",
    death_year: a.deathYear ?? "",
    death_month: a.deathMonth ?? "",
    death_day: a.deathDay ?? "",
    bio: a.bio ? stripHtmlToText(a.bio) : "",
    website: a.website ?? "",
    works_count: a.workAuthors.length,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { entity, ids, all, format } = body as {
      entity?: string;
      ids?: string[];
      /** Every book, or every book author, instead of a list of ids */
      all?: boolean;
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

    if (!format || !VALID_FORMATS.includes(format as ExportFormat)) {
      return NextResponse.json(
        { error: "Invalid format. Must be 'csv', 'tsv', or 'parquet'." },
        { status: 400 },
      );
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

    const timestamp = todayLocal();

    // For single-entity exports, use a descriptive filename
    let slug = "";
    if (all === true) {
      slug = `${entityType === "works" ? "books" : entityType}-all`;
    } else if (rows.length === 1 && entityType === "authors") {
      const row = rows[0] as {
        first_name?: string;
        last_name?: string;
        name?: string;
      };
      const first = slugify(row.first_name ?? "");
      const last = slugify(row.last_name ?? "");
      slug = first && last ? `${first}-${last}` : slugify(row.name ?? "");
    } else if (rows.length === 1 && entityType !== "authors") {
      slug = slugify((rows[0] as { title?: string }).title ?? "");
    }
    const filename = `durtal-${slug || entityType}-${timestamp}${FORMAT_EXT[fmt]}`;

    if (fmt === "csv" || fmt === "tsv") {
      const text = fmt === "csv" ? toCSV(rows) : toTSV(rows);
      return new NextResponse(text, {
        status: 200,
        headers: {
          "Content-Type": FORMAT_MIME[fmt],
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Parquet — binary response
    const buf = await toParquet(rows);
    const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": FORMAT_MIME[fmt],
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}
