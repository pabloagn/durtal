import { eq } from "drizzle-orm";
import type { db } from "@/lib/db";
import {
  workSubjects,
  workCategories,
  workThemes,
  workLiteraryMovements,
  workArtTypes,
  workArtMovements,
  workKeywords,
  workAttributes,
} from "@/lib/db/schema";

export interface WorkTaxonomyIds {
  subjectIds?: string[];
  categoryIds?: string[];
  themeIds?: string[];
  literaryMovementIds?: string[];
  artTypeIds?: string[];
  artMovementIds?: string[];
  keywordIds?: string[];
  attributeIds?: string[];
}

/**
 * Queries that set a work's taxonomy links, for use inside `atomic()`.
 * A list that is `undefined` is left alone; a list that is given replaces the
 * current links (`replace: true`) or is only inserted (a new work).
 */
export function workTaxonomyWrites(
  d: typeof db,
  workId: string,
  ids: WorkTaxonomyIds,
  { replace }: { replace: boolean },
): unknown[] {
  const queries: unknown[] = [];
  const set = <T>(list: string[] | undefined, table: Parameters<typeof d.delete>[0], workIdColumn: Parameters<typeof eq>[0], rows: (id: string) => T) => {
    if (list === undefined) return;
    if (replace) queries.push(d.delete(table).where(eq(workIdColumn, workId)));
    if (list.length > 0) queries.push(d.insert(table as never).values(list.map(rows) as never));
  };
  set(ids.subjectIds, workSubjects, workSubjects.workId, (subjectId) => ({ workId, subjectId }));
  set(ids.categoryIds, workCategories, workCategories.workId, (categoryId) => ({ workId, categoryId }));
  set(ids.themeIds, workThemes, workThemes.workId, (themeId) => ({ workId, themeId }));
  set(ids.literaryMovementIds, workLiteraryMovements, workLiteraryMovements.workId, (literaryMovementId) => ({ workId, literaryMovementId }));
  set(ids.artTypeIds, workArtTypes, workArtTypes.workId, (artTypeId) => ({ workId, artTypeId }));
  set(ids.artMovementIds, workArtMovements, workArtMovements.workId, (artMovementId) => ({ workId, artMovementId }));
  set(ids.keywordIds, workKeywords, workKeywords.workId, (keywordId) => ({ workId, keywordId }));
  set(ids.attributeIds, workAttributes, workAttributes.workId, (attributeId) => ({ workId, attributeId }));
  return queries;
}
