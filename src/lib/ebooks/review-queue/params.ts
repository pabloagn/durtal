import { z } from "zod/v4";
import { EBOOK_FORMATS } from "@/lib/ebooks/formats";
import { normalizeLanguage } from "@/lib/utils/language";
import { REVIEW_SECTIONS, type ReviewSectionKey } from "./types";

export const REVIEW_PAGE_SIZE = 50;
export const REVIEW_MAX_SHOWN = 500;
const shown = z.coerce.number().int().min(REVIEW_PAGE_SIZE).max(REVIEW_MAX_SHOWN)
  .refine((value) => value % REVIEW_PAGE_SIZE === 0).default(REVIEW_PAGE_SIZE);
const language = z.string().trim().min(1).max(100).transform((value, context) => {
  const canonical = normalizeLanguage(value);
  if (!canonical) {
    context.addIssue({ code: "custom", message: "Choose a known language" });
    return z.NEVER;
  }
  return canonical;
});
export const reviewFiltersSchema = z.strictObject({
  q: z.string().trim().max(200).optional(), language: language.optional(),
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
export interface ReviewParams { filters: ReviewFilters; shown: Record<ReviewSectionKey, number> }
export function parseReviewParams(raw: Record<string, string | string[] | undefined>): ReviewParams {
  const single = (key: string) => {
    const value = raw[key];
    if (Array.isArray(value)) throw new Error("Use one value for each review filter");
    return value === "" ? undefined : value;
  };
  const filters = reviewFiltersSchema.parse(Object.fromEntries(
    ["q", "language", "format", "hasIsbn", "work", "run", "author", "series"].map((key) => [key, single(key)]),
  ));
  return { filters, shown: Object.fromEntries(REVIEW_SECTIONS.map(({ key }) =>
    [key, shown.parse(single(key))])) as Record<ReviewSectionKey, number> };
}
export function reviewParamsSearch(params: ReviewParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params.filters)) if (value) result.set(key, value);
  for (const { key } of REVIEW_SECTIONS) if (params.shown[key] > REVIEW_PAGE_SIZE)
    result.set(key, String(params.shown[key]));
  return result;
}
export function reviewMoreHref(params: ReviewParams, section: ReviewSectionKey): string {
  const next = reviewParamsSearch(params);
  next.set(section, String(Math.min(REVIEW_MAX_SHOWN, params.shown[section] + REVIEW_PAGE_SIZE)));
  return `/ebooks/review?${next.toString()}`;
}
