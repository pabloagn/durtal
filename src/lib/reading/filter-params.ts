/**
 * The library's reading, holding and status filters and its sort, read from
 * the URL (SLN-449). One parser for `/library` and `GET /api/works`: it
 * returns the valid filters and the zod issues of the rest. The page keeps
 * what is valid and drops the rest; the route answers 400 with the issues.
 *
 * To add a filter: a key in `ReadingFilterParams`, its check below, and its
 * condition in `buildWorkConditions` (`src/lib/actions/works.ts`). The
 * reading value `queued` (in Up Next, SLN-452) is not a reading state: a
 * queued book can be read or unread. The enrichment filters come later.
 */
import { z } from "zod/v4";
import { WORK_READING_STATES, type WorkReadingState } from "./constants";
import { catalogueStatusEnum } from "@/lib/db/schema/enums";

export type CatalogueStatus = (typeof catalogueStatusEnum.enumValues)[number];
export const CATALOGUE_STATUSES = catalogueStatusEnum.enumValues;

/** The Reading filter's values: the reading states, and "queued" (in Up Next) */
export const READING_FILTER_VALUES = [...WORK_READING_STATES, "queued"] as const;
export type ReadingFilterValue = WorkReadingState | "queued";

export const HOLDINGS = ["owned", "not_owned"] as const;
export type Holding = (typeof HOLDINGS)[number];

/** The library page's sorts; the API takes the first five */
export const LIBRARY_SORTS = ["title", "recent", "year", "rating", "lastRead", "queue", "authorFirstName", "authorLastName"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export const API_SORTS = ["title", "recent", "year", "rating", "lastRead", "queue"] as const satisfies readonly LibrarySort[];

export interface ReadingFilterParams {
  /** Any of these reading states (`readingStateSql`), or in Up Next */
  reading?: ReadingFilterValue[];
  /** A finished reading in these years, at any precision; reversed years are swapped */
  readFrom?: number;
  readTo?: number;
  /** Two finished readings or more */
  reread?: boolean;
  /** Exactly one of owned and not owned; both, or neither, is no holding filter */
  holding?: Holding;
  /** The catalogue status, checked against the enum */
  catalogueStatus?: CatalogueStatus[];
}

/** The parsed filters as a server action receives them back from the browser (the timeline) */
export const readingFiltersSchema = z.object({
  reading: z.array(z.enum(READING_FILTER_VALUES)).optional(),
  readFrom: z.number().int().min(1).max(2999).optional(),
  readTo: z.number().int().min(1).max(2999).optional(),
  reread: z.boolean().optional(),
  holding: z.enum(HOLDINGS).optional(),
  catalogueStatus: z.array(z.enum(CATALOGUE_STATUSES)).optional(),
});

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const get = (params: Params, key: string): string | undefined => {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};
const list = (value: string | undefined) => value?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

const year = z.coerce.number().int().min(1).max(2999);

/** One value checked by `schema`; its issues carry the parameter's name */
function check<T>(schema: z.ZodType<T>, value: string, key: string, issues: z.core.$ZodIssue[]): T | undefined {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) issues.push({ ...issue, path: [key, ...issue.path] } as z.core.$ZodIssue);
  return undefined;
}

/** Every value of a comma list checked by `schema`: the valid ones, without repeats */
function checkList<T>(schema: z.ZodType<T>, value: string | undefined, key: string, issues: z.core.$ZodIssue[]): T[] {
  const out: T[] = [];
  for (const v of list(value)) {
    const parsed = check(schema, v, key, issues);
    if (parsed !== undefined && !out.includes(parsed)) out.push(parsed);
  }
  return out;
}

export function parseReadingFilters<S extends string>(
  params: Params,
  { sorts }: { sorts: readonly S[] },
): { filters: ReadingFilterParams; sort: S | undefined; issues: z.core.$ZodIssue[] } {
  const issues: z.core.$ZodIssue[] = [];
  const filters: ReadingFilterParams = {};

  const reading = checkList(z.enum(READING_FILTER_VALUES), get(params, "reading"), "reading", issues);
  if (reading.length) filters.reading = reading;

  const from = get(params, "readFrom");
  const to = get(params, "readTo");
  let readFrom = from ? check(year, from, "readFrom", issues) : undefined;
  let readTo = to ? check(year, to, "readTo", issues) : undefined;
  if (readFrom !== undefined && readTo !== undefined && readFrom > readTo) [readFrom, readTo] = [readTo, readFrom];
  if (readFrom !== undefined) filters.readFrom = readFrom;
  if (readTo !== undefined) filters.readTo = readTo;

  const reread = get(params, "reread");
  if (reread && check(z.literal("true"), reread, "reread", issues)) filters.reread = true;

  // As films parse it: exactly one known value filters
  const holding = checkList(z.enum(HOLDINGS), get(params, "holding"), "holding", issues);
  if (holding.length === 1) filters.holding = holding[0];

  const status = checkList(z.enum(CATALOGUE_STATUSES), get(params, "status"), "status", issues);
  if (status.length) filters.catalogueStatus = status;

  const sortParam = get(params, "sort");
  const sort = sortParam ? check(z.enum(sorts as unknown as [S, ...S[]]), sortParam, "sort", issues) : undefined;

  return { filters, sort, issues };
}

/** True when any reading, holding or status filter is set */
export function hasReadingFilters(filters: ReadingFilterParams) {
  return Boolean(
    filters.reading?.length ||
      filters.readFrom !== undefined ||
      filters.readTo !== undefined ||
      filters.reread ||
      filters.holding ||
      filters.catalogueStatus?.length,
  );
}
