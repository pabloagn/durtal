import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { works, workAuthors, authors } from "@/lib/db/schema";
import { inArray, asc } from "drizzle-orm";
import {
  toCSV,
  toTSV,
  toParquet,
  FORMAT_MIME,
  FORMAT_EXT,
  type ExportFormat,
} from "@/lib/utils/export";

const VALID_FORMATS: ExportFormat[] = ["csv", "tsv", "parquet"];
const VALID_ENTITIES = ["works", "authors"] as const;
type EntityType = (typeof VALID_ENTITIES)[number];

async function fetchWorksForExport(ids: string[]) {
  const results = await db.query.works.findMany({
    where: inArray(works.id, ids),
    with: {
      workAuthors: {
        with: { author: true },
        orderBy: asc(workAuthors.sortOrder),
      },
      editions: {
        with: {
          instances: {
            columns: { id: true },
          },
        },
      },
    },
  });

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

async function fetchAuthorsForExport(ids: string[]) {
  const results = await db.query.authors.findMany({
    where: inArray(authors.id, ids),
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
    bio: a.bio ?? "",
    website: a.website ?? "",
    works_count: a.workAuthors.length,
  }));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { entity, ids, format } = body as {
      entity?: string;
      ids?: string[];
      format?: string;
    };

    if (
      !entity ||
      !VALID_ENTITIES.includes(entity as EntityType)
    ) {
      return NextResponse.json(
        { error: "Invalid entity type. Must be 'works' or 'authors'." },
        { status: 400 },
      );
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "ids must be a non-empty array." },
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

    const rows =
      entityType === "works"
        ? await fetchWorksForExport(ids)
        : await fetchAuthorsForExport(ids);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "No records found for the given IDs." },
        { status: 404 },
      );
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `durtal-${entityType}-${timestamp}${FORMAT_EXT[fmt]}`;

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
    return new NextResponse(bytes as unknown as BodyInit,
      {
        status: 200,
        headers: {
          "Content-Type": FORMAT_MIME[fmt],
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      },
    );
  } catch (err) {
    console.error("Export error:", err);
    return NextResponse.json(
      { error: "Export failed." },
      { status: 500 },
    );
  }
}
