"use server";

import {
  bookReferenceCondition,
  requireBookWork,
} from "@/lib/catalogue/book-boundary";

import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { assertSql } from "@/lib/harmonization/store";
import {
  WORK_TAXONOMY_FIELDS,
  workTaxonomyQueries,
  type WorkTaxonomyInput,
} from "@/lib/catalogue/work-taxonomy";
import { getSystemRegistry } from "@/lib/db/taxonomy-resolver";
import { idArray } from "@/lib/collections/members";
import {
  subjects,
  genres,
  tags,
  workTypes,
  bookCategories,
  themes,
  literaryMovements,
  artTypes,
  artMovements,
  keywords,
  attributes,
  workSubjects,
  works,
} from "@/lib/db/schema";
import { eq, asc, sql, and } from "drizzle-orm";
import { cached, invalidate, CACHE_TAGS } from "@/lib/cache";
import { recordActivity } from "@/lib/activity/record";
import {
  updateWorkTaxonomySchema,
  type UpdateWorkTaxonomyInput,
} from "@/lib/validations/taxonomy-management";
import { parseId } from "@/lib/validations/helpers";

// ── Work Types ────────────────────────────────────────────────────────────────

export const getWorkTypes = cached(
  () => db.query.workTypes.findMany({ orderBy: asc(workTypes.name) }),
  ["work-types"],
  [CACHE_TAGS.workTypes],
);

// ── Subjects ─────────────────────────────────────────────────────────────────

export const getSubjects = cached(
  () => db.query.subjects.findMany({ orderBy: asc(subjects.name) }),
  ["subjects"],
  [CACHE_TAGS.subjects],
);

export const getSubjectsWithWorkCounts = cached(
  async () => {
    const rows = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        slug: subjects.slug,
        description: subjects.description,
        workCount: sql<number>`count(${workSubjects.workId})::int`,
      })
      .from(subjects)
      .leftJoin(
        workSubjects,
        and(
          eq(subjects.id, workSubjects.subjectId),
          bookReferenceCondition(workSubjects.workId),
        ),
      )
      .groupBy(subjects.id)
      .orderBy(asc(subjects.name));
    return rows;
  },
  ["subjects-with-counts"],
  [CACHE_TAGS.subjects, CACHE_TAGS.works],
);

// ── Genres ────────────────────────────────────────────────────────────────────

export const getGenres = cached(
  () =>
    db.query.genres.findMany({
      orderBy: asc(genres.sortOrder),
      with: { parent: true, children: true },
    }),
  ["genres"],
  [CACHE_TAGS.genres],
);

// ── Tags ──────────────────────────────────────────────────────────────────────

export const getTags = cached(
  () => db.query.tags.findMany({ orderBy: asc(tags.name) }),
  ["tags"],
  [CACHE_TAGS.tags],
);

// ── Categories ────────────────────────────────────────────────────────────────

export const getCategories = cached(
  () =>
    db.query.bookCategories.findMany({
      orderBy: asc(bookCategories.sortOrder),
      with: { parent: true, children: true },
    }),
  ["categories"],
  [CACHE_TAGS.categories],
);

// ── Themes ────────────────────────────────────────────────────────────────────

export const getThemes = cached(
  () =>
    db.query.themes.findMany({
      orderBy: asc(themes.sortOrder),
      with: { parent: true, children: true },
    }),
  ["themes"],
  [CACHE_TAGS.themes],
);

// ── Literary Movements ────────────────────────────────────────────────────────

export const getLiteraryMovements = cached(
  () =>
    db.query.literaryMovements.findMany({
      orderBy: asc(literaryMovements.sortOrder),
      with: { parent: true, children: true },
    }),
  ["literary-movements"],
  [CACHE_TAGS.literaryMovements],
);

// ── Art Types ─────────────────────────────────────────────────────────────────

export const getArtTypes = cached(
  () => db.query.artTypes.findMany({ orderBy: asc(artTypes.name) }),
  ["art-types"],
  [CACHE_TAGS.artTypes],
);

// ── Art Movements ─────────────────────────────────────────────────────────────

export const getArtMovements = cached(
  () => db.query.artMovements.findMany({ orderBy: asc(artMovements.name) }),
  ["art-movements"],
  [CACHE_TAGS.artMovements],
);

// ── Keywords ──────────────────────────────────────────────────────────────────

export const getKeywords = cached(
  () => db.query.keywords.findMany({ orderBy: asc(keywords.name) }),
  ["keywords"],
  [CACHE_TAGS.keywords],
);

// ── Attributes ────────────────────────────────────────────────────────────────

export const getAttributes = cached(
  () => db.query.attributes.findMany({ orderBy: asc(attributes.name) }),
  ["attributes"],
  [CACHE_TAGS.attributes],
);

// ── Update Work Taxonomy ──────────────────────────────────────────────────────

export async function updateWorkTaxonomy(
  workId: string,
  rawInput: UpdateWorkTaxonomyInput,
) {
  parseId(workId);
  const input = updateWorkTaxonomySchema.parse(rawInput);
  await requireBookWork(workId);
  // Snapshot current links so the activity log can record each change
  const before = await readWorkTaxonomyIds(workId, input);
  await atomic((d) => [
    d.execute(sql`select id from works where id=${workId}::uuid for update`),
    d.execute(
      assertSql(
        sql`exists(select 1 from works where id=${workId}::uuid and kind='book')`,
        "Book not found",
      ),
    ),
    ...workTaxonomyQueries(d, workId, input),
    d.update(works).set({ updatedAt: new Date() }).where(eq(works.id, workId)),
  ]);

  await recordWorkTaxonomyChanges(workId, input, before);

  invalidate(CACHE_TAGS.works);
  return { workId };
}

type WorkTaxonomyField = keyof typeof WORK_TAXONOMY_FIELDS;

/** The family name an activity event shows, by input field. */
const TAXONOMY_EVENT_LABELS: Record<WorkTaxonomyField, string> = {
  subjectIds: "subject",
  categoryIds: "category",
  themeIds: "theme",
  literaryMovementIds: "literary movement",
  artTypeIds: "art type",
  artMovementIds: "art movement",
  keywordIds: "keyword",
  attributeIds: "attribute",
};

function resultRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? result : (result as { rows: T[] }).rows;
}

function taxonomyFields(input: WorkTaxonomyInput) {
  return (Object.keys(WORK_TAXONOMY_FIELDS) as WorkTaxonomyField[]).filter(
    (field) => input[field] !== undefined,
  );
}

async function readWorkTaxonomyIds(workId: string, input: WorkTaxonomyInput) {
  const before = new Map<WorkTaxonomyField, string[]>();
  for (const field of taxonomyFields(input)) {
    const reg = getSystemRegistry(WORK_TAXONOMY_FIELDS[field]);
    const result = await db.execute(
      sql`select ${reg.junctionItemCol} as id from ${reg.junction} where ${reg.junctionEntityCol}=${workId}::uuid`,
    );
    before.set(field, resultRows<{ id: string }>(result).map((r) => r.id));
  }
  return before;
}

/** Record one taxonomy_added / taxonomy_removed event per item that changed. */
async function recordWorkTaxonomyChanges(
  workId: string,
  input: WorkTaxonomyInput,
  before: Map<WorkTaxonomyField, string[]>,
) {
  for (const field of taxonomyFields(input)) {
    const next = [...new Set(input[field])];
    const prev = before.get(field) ?? [];
    const added = next.filter((id) => !prev.includes(id));
    const removed = prev.filter((id) => !next.includes(id));
    if (added.length === 0 && removed.length === 0) continue;

    const reg = getSystemRegistry(WORK_TAXONOMY_FIELDS[field]);
    const result = await db.execute(
      sql`select id, name from ${reg.table} where id = any(${idArray([...added, ...removed])})`,
    );
    const names = new Map(
      resultRows<{ id: string; name: string }>(result).map((r) => [r.id, r.name]),
    );
    const taxonomyType = TAXONOMY_EVENT_LABELS[field];

    for (const id of added) {
      recordActivity("work", workId, "work.taxonomy_added", {
        taxonomyType,
        targetId: id,
        targetName: names.get(id) ?? "",
      });
    }
    for (const id of removed) {
      recordActivity("work", workId, "work.taxonomy_removed", {
        taxonomyType,
        targetId: id,
        targetName: names.get(id) ?? "",
      });
    }
  }
}
