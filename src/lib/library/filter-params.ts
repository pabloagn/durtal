/**
 * The library's book filters besides reading, holding and status (SLN-405;
 * those are `src/lib/reading/filter-params.ts`), read from the URL. One
 * parser for `/library` and the timeline: it keeps the valid values and
 * reports the rest as zod issues. The keys and labels are `./filter-keys.ts`;
 * the conditions are `./filter-conditions.ts`; the panel is
 * `src/app/library/filters.tsx`.
 *
 * Within a group the values are alternatives (any one matches); across groups
 * every group must match. A taxonomy item matches its narrower items too.
 */
import { z } from "zod/v4";
import {
  ACQUISITION_PRIORITIES,
  TAXONOMY_KEYS,
  type AcquisitionPriorityFilter,
  type BookTaxonomyKey,
  type CopyFlag,
  type SeriesFilter,
} from "./filter-keys";
import { WORK_MARKS, type WorkMarkKey } from "@/lib/constants/marks";
import { COLOR_BUCKET_KEYS, type ColorBucket } from "@/lib/color/color-buckets";
import { INSTANCE_FORMATS, type InstanceFormat } from "@/lib/types";
import { HALF_STEPS } from "@/lib/utils/rating";

export * from "./filter-keys";

export interface BookFilterParams {
  /** Rare, Anathema, Favourite: any one */
  marks?: WorkMarkKey[];
  /** An edition or a wanted edition from these houses or the houses below them */
  publisherIds?: string[];
  acquisitionPriority?: AcquisitionPriorityFilter[];
  /** Rated at least this */
  minRating?: number;
  /** A copy in one of these places */
  locationIds?: string[];
  /** A copy in one of these formats */
  formats?: InstanceFormat[];
  /** A copy with each of these details */
  copyFlags?: CopyFlag[];
  /** An edition in one of these languages (codes) */
  languages?: string[];
  originalLanguages?: string[];
  /** First published in these years (the work's original year); reversed years are swapped */
  yearFrom?: number;
  yearTo?: number;
  series?: SeriesFilter;
  /** Item ids per taxonomy */
  taxonomy?: Partial<Record<BookTaxonomyKey, string[]>>;
  /** The colour of the cover the card shows */
  colors?: ColorBucket[];
  /** With or without an active poster */
  hasPoster?: boolean;
}

const MARK_KEYS = WORK_MARKS.map((m) => m.key) as [WorkMarkKey, ...WorkMarkKey[]];
const language = z.string().regex(/^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/).max(35);
const year = z.coerce.number().int().min(-3000).max(2999);
const ids = z.array(z.uuid()).max(100);

/** The parsed filters as a server action gets them back from the browser (the timeline) */
export const bookFiltersSchema = z.object({
  marks: z.array(z.enum(MARK_KEYS)).optional(),
  publisherIds: ids.optional(),
  acquisitionPriority: z.array(z.enum(ACQUISITION_PRIORITIES)).optional(),
  minRating: z.number().refine((n) => (HALF_STEPS as readonly number[]).includes(n)).optional(),
  locationIds: ids.optional(),
  formats: z.array(z.enum(INSTANCE_FORMATS)).optional(),
  copyFlags: z.array(z.enum(["signed", "first"])).optional(),
  languages: z.array(language).max(100).optional(),
  originalLanguages: z.array(language).max(100).optional(),
  yearFrom: z.number().int().min(-3000).max(2999).optional(),
  yearTo: z.number().int().min(-3000).max(2999).optional(),
  series: z.enum(["in", "none"]).optional(),
  taxonomy: z.partialRecord(z.enum(TAXONOMY_KEYS), ids).optional(),
  colors: z.array(z.enum(COLOR_BUCKET_KEYS)).optional(),
  hasPoster: z.boolean().optional(),
});

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

const get = (params: Params, key: string): string | undefined => {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};
const list = (value: string | undefined) => value?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

/** Every value of a comma list checked by `schema`: the valid ones, once each; the rest become issues */
function checkList<T>(schema: z.ZodType<T>, params: Params, key: string, issues: z.core.$ZodIssue[]): T[] {
  const out: T[] = [];
  for (const value of list(get(params, key))) {
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      if (!out.includes(parsed.data)) out.push(parsed.data);
    } else for (const issue of parsed.error.issues) issues.push({ ...issue, path: [key, ...issue.path] } as z.core.$ZodIssue);
  }
  return out;
}

function checkOne<T>(schema: z.ZodType<T>, params: Params, key: string, issues: z.core.$ZodIssue[]): T | undefined {
  const value = get(params, key);
  if (!value) return undefined;
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) issues.push({ ...issue, path: [key, ...issue.path] } as z.core.$ZodIssue);
  return undefined;
}

export function parseBookFilters(params: Params): { filters: BookFilterParams; issues: z.core.$ZodIssue[] } {
  const issues: z.core.$ZodIssue[] = [];
  const filters: BookFilterParams = {};
  const set = <K extends keyof BookFilterParams>(key: K, value: BookFilterParams[K] | undefined) => {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) return;
    filters[key] = value;
  };

  // The old `rare=true` link counts as the Rare mark
  const marks = checkList(z.enum(MARK_KEYS), params, "mark", issues);
  if (get(params, "rare") === "true" && !marks.includes("rare")) marks.push("rare");
  set("marks", marks);
  set("publisherIds", checkList(z.uuid(), params, "publisher", issues));
  set("acquisitionPriority", checkList(z.enum(ACQUISITION_PRIORITIES), params, "priority", issues));
  const rating = checkOne(z.coerce.number().refine((n) => (HALF_STEPS as readonly number[]).includes(n)), params, "rating", issues);
  set("minRating", rating);
  set("locationIds", checkList(z.uuid(), params, "location", issues));
  set("formats", checkList(z.enum(INSTANCE_FORMATS), params, "format", issues));
  set("copyFlags", checkList(z.enum(["signed", "first"]), params, "copy", issues));
  set("languages", checkList(language, params, "lang", issues));
  set("originalLanguages", checkList(language, params, "origLang", issues));

  let yearFrom = checkOne(year, params, "yearFrom", issues);
  let yearTo = checkOne(year, params, "yearTo", issues);
  if (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo) [yearFrom, yearTo] = [yearTo, yearFrom];
  set("yearFrom", yearFrom);
  set("yearTo", yearTo);

  // Both or neither is no series filter
  const series = checkList(z.enum(["in", "none"]), params, "series", issues);
  if (series.length === 1) set("series", series[0]);

  const taxonomy: Partial<Record<BookTaxonomyKey, string[]>> = {};
  for (const key of TAXONOMY_KEYS) {
    const values = checkList(z.uuid(), params, key, issues);
    if (values.length) taxonomy[key] = values;
  }
  if (Object.keys(taxonomy).length) filters.taxonomy = taxonomy;

  set("colors", checkList(z.enum(COLOR_BUCKET_KEYS), params, "color", issues));

  const poster = checkList(z.enum(["has", "missing"]), params, "poster", issues);
  if (poster.length === 1) set("hasPoster", poster[0] === "has");

  return { filters, issues };
}

/** True when any book filter is set */
export function hasBookFilters(filters: BookFilterParams) {
  return Object.values(filters).some((value) =>
    Array.isArray(value) ? value.length > 0 : typeof value === "object" && value !== null ? Object.keys(value).length > 0 : value !== undefined,
  );
}
