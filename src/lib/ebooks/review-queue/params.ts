import { z } from "zod/v4";
import { EBOOK_FORMATS } from "@/lib/ebooks/formats";
import { normalizeLanguage } from "@/lib/utils/language";
import { REVIEW_SECTIONS, type ReviewSectionKey } from "./types";

/** One section at a time, a page of rows at a time, so the page stays within its weight budget (SLN-684) */
export const REVIEW_PAGE_SIZE = 20;
export const REVIEW_MAX_PAGE = 1000;
const page = z.coerce.number().int().min(1).max(REVIEW_MAX_PAGE).default(1);
const sectionKey = z.enum(REVIEW_SECTIONS.map(({ key }) => key) as [ReviewSectionKey, ...ReviewSectionKey[]]);
const language = z.string().trim().min(1).max(100).transform((value, context) => {
  const canonical = normalizeLanguage(value);
  if (!canonical) {
    context.addIssue({ code: "custom", message: "Choose a known language" });
    return z.NEVER;
  }
  return canonical;
});
export const reviewFiltersSchema = z.strictObject({
  // A NUL can't reach Postgres text: the search drops it rather than failing (SLN-933)
  q: z.string().transform((value) => value.replaceAll("\u0000", "")).pipe(z.string().trim().max(200)).optional(), language: language.optional(),
  format: z.enum(EBOOK_FORMATS).optional(), hasIsbn: z.enum(["yes", "no"]).optional(),
  work: z.uuid().transform((value) => value.toLowerCase()).optional(),
  run: z.uuid().transform((value) => value.toLowerCase()).optional(),
  author: z.uuid().transform((value) => value.toLowerCase()).optional(),
  series: z.uuid().transform((value) => value.toLowerCase()).optional(),
});
export type ReviewFilters = z.output<typeof reviewFiltersSchema>;
export const reviewSelectionPageSchema = z.strictObject({
  section: z.enum(["conflict", "likely", "to_choose", "same_author", "duplicate", "not_a_book", "not_in_durtal"]),
  filters: reviewFiltersSchema, cursor: z.uuid().transform((value) => value.toLowerCase()).nullable().default(null),
  authorName: z.string().min(1).max(300).optional(),
});
export type ReviewSelectionPageInput = z.output<typeof reviewSelectionPageSchema>;
export interface ReviewParams {
  filters: ReviewFilters;
  /** The section to list; the first one with eBooks when none is named */
  section: ReviewSectionKey | null;
  page: number;
}
export function parseReviewParams(raw: Record<string, string | string[] | undefined>): ReviewParams {
  const single = (key: string) => {
    const value = raw[key];
    if (Array.isArray(value)) throw new Error("Use one value for each review filter");
    return value === "" ? undefined : value;
  };
  const filters = reviewFiltersSchema.parse(Object.fromEntries(
    ["q", "language", "format", "hasIsbn", "work", "run", "author", "series"].map((key) => [key, single(key)]),
  ));
  return { filters, section: sectionKey.optional().parse(single("section")) ?? null, page: page.parse(single("page")) };
}
export function reviewParamsSearch(params: ReviewParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params.filters)) if (value) result.set(key, value);
  if (params.section) result.set("section", params.section);
  if (params.page > 1) result.set("page", String(params.page));
  return result;
}
/** The queue with the same filters, at another section or page */
export function reviewPageHref(params: ReviewParams, at: { section: ReviewSectionKey; page?: number }): string {
  const next = reviewParamsSearch({ ...params, section: at.section, page: at.page ?? 1 });
  return `/ebooks/review?${next.toString()}`;
}
