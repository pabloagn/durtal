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
  chapter: chapter.nullable().optional(),
  percent: percent.nullable().optional(),
  commentHtml: z.string().max(200_000).nullable().optional(),
  commentJson: z.unknown().nullable().optional(),
  isFavourite: z.boolean().optional(),
};

export const createReadingNoteSchema = z
  .object({ workId: z.uuid(), kind: z.enum(NOTE_KINDS), body, ...fields })
  .strict();

export const updateReadingNoteSchema = z
  .object({ id: z.uuid(), kind: z.enum(NOTE_KINDS).optional(), body: body.optional(), ...fields })
  .strict();

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
