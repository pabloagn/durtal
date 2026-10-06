import { z } from "zod/v4";
import { NOTE_KINDS, NOTE_MAX, NOTE_SOURCES } from "@/lib/reading/constants";
import { NOTES_PER_PAGE, NOTES_SORTS } from "@/lib/reading/notes-params";
import { PAGE_SIZES } from "@/lib/utils/pagination";

/* The commonplace book (SLN-453): every note action's input. A page never sends a source or key. */

const body = z
  .string()
  .trim()
  .min(1, "Write the passage or the note")
  .max(NOTE_MAX, `At most ${NOTE_MAX.toLocaleString("en")} characters`);
const chapter = z.string().trim().max(300, "A chapter is at most 300 characters");
const page = z.number().int("A page is a whole number").min(0, "A page is 0 or more").max(1_000_000);
const percent = z.number().min(0, "A percent is 0 to 100").max(100, "A percent is 0 to 100");

const fields = {
  readingId: z.uuid().nullable().optional(),
  editionId: z.uuid().nullable().optional(),
  page: page.nullable().optional(),
  /** The last page of a passage over a page turn (SLN-480) */
  endPage: page.nullable().optional(),
  /** The pages are front matter in roman numerals */
  pageRoman: z.boolean().optional(),
  chapter: chapter.nullable().optional(),
  percent: percent.nullable().optional(),
  commentHtml: z.string().max(200_000).nullable().optional(),
  commentJson: z.unknown().nullable().optional(),
  isFavourite: z.boolean().optional(),
};

export const PAGE_AND_PERCENT = "Send a page or a percent, not both";
export const END_PAGE_RULE = "The last page comes after the first";
export const ROMAN_PAGE_RULE = "A roman page starts at i";

/** The page rules, on a note's page fields as they will be stored */
export function pagePlaceError(p: { page: number | null; endPage: number | null; pageRoman: boolean }): string | null {
  if (p.endPage != null && (p.page == null || p.endPage <= p.page)) return END_PAGE_RULE;
  if (p.pageRoman && (p.page == null || p.page < 1)) return ROMAN_PAGE_RULE;
  return null;
}

/** What was sent breaks a rule on its own: a page with a percent, a range or roman pages without a page */
function sentRules(v: { page?: number | null; percent?: number | null; endPage?: number | null; pageRoman?: boolean }, ctx: z.RefinementCtx) {
  if (v.page != null && v.percent != null) ctx.addIssue({ code: "custom", message: PAGE_AND_PERCENT, path: ["percent"] });
  if (v.page !== undefined) {
    const error = pagePlaceError({ page: v.page, endPage: v.endPage ?? null, pageRoman: v.pageRoman ?? false });
    if (error) ctx.addIssue({ code: "custom", message: error, path: [error === END_PAGE_RULE ? "endPage" : "pageRoman"] });
  }
}

export const createReadingNoteSchema = z
  .object({ workId: z.uuid(), kind: z.enum(NOTE_KINDS), body, ...fields })
  .strict()
  .superRefine(sentRules);

export const updateReadingNoteSchema = z
  .object({ id: z.uuid(), kind: z.enum(NOTE_KINDS).optional(), body: body.optional(), ...fields })
  .strict()
  .superRefine(sentRules);

export const noteIdSchema = z.object({ id: z.uuid() }).strict();

/** A deleted note, as deleteReadingNote returned it, for its Undo */
export const noteSnapshotSchema = z.object({
  id: z.uuid(),
  workId: z.uuid(),
  readingId: z.uuid().nullable(),
  editionId: z.uuid().nullable(),
  kind: z.enum(NOTE_KINDS),
  body: z.string().min(1).max(NOTE_MAX),
  commentHtml: z.string().nullable(),
  commentJson: z.unknown().nullable(),
  page: z.number().int().nullable(),
  // A snapshot from before SLN-480 has neither
  endPage: z.number().int().nullable().default(null),
  pageRoman: z.boolean().default(false),
  chapter: z.string().nullable(),
  percent: z.number().nullable(),
  isFavourite: z.boolean(),
  source: z.enum(NOTE_SOURCES),
  importId: z.uuid().nullable(),
  sourceKey: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type NoteSnapshot = z.infer<typeof noteSnapshotSchema>;

export const searchNotesSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    workId: z.uuid().optional(),
    authorId: z.uuid().optional(),
    /** An edition's notes, or "none" for the notes with no edition recorded (SLN-480) */
    editionId: z.union([z.uuid(), z.literal("none")]).optional(),
    /** The notes on editions this person translated */
    translatorId: z.uuid().optional(),
    kind: z.enum(NOTE_KINDS).optional(),
    favourites: z.boolean().optional(),
    year: z.number().int().min(1900).max(2999).optional(),
    sort: z.enum(NOTES_SORTS).default("newest"),
    order: z.enum(["asc", "desc"]).optional(),
    page: z.number().int().min(1).default(1),
    perPage: z
      .number()
      .refine((n) => (PAGE_SIZES as readonly number[]).includes(n), "Not a page size")
      .default(NOTES_PER_PAGE),
  })
  .strict();

export const passageSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    offset: z.number().int().min(0).max(100_000).optional(),
  })
  .strict();
