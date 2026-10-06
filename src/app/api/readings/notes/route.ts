import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { resultRows } from "@/lib/harmonization/store";
import { readJson } from "@/lib/api/rest";
import { editionByIsbn, noteJson, requireReadingsToken, spoken, spokenError } from "@/lib/api/readings";
import { createReadingNote, getReadingNote, searchNotes } from "@/lib/actions/reading-notes";
import { NOTE_KINDS } from "@/lib/reading/constants";
import { parseNotesQuery } from "@/lib/reading/notes-params";
import { pageText } from "@/lib/reading/notes-text";

/*
 * The phone's quotes and notes (SLN-480), under /api/readings so the
 * Authelia rule lets a Shortcut through with the token. Every route checks
 * the token first, GETs included. Writes go through the note actions, so a
 * note made here is "manual" and records the same activity.
 */

const postSchema = z
  .object({
    kind: z.enum(NOTE_KINDS).optional(),
    body: z.string(),
    editionId: z.uuid().optional(),
    isbn: z.string().trim().min(10).max(20).optional(),
    workId: z.uuid().optional(),
    /** null: no reading; left out: the book's open reading, whatever its edition */
    readingId: z.uuid().nullable().optional(),
    page: z.number().int().nullable().optional(),
    endPage: z.number().int().nullable().optional(),
    pageRoman: z.boolean().optional(),
    chapter: z.string().nullable().optional(),
    percent: z.number().nullable().optional(),
    commentHtml: z.string().nullable().optional(),
    isFavourite: z.boolean().optional(),
  })
  .strict();

const ONE_BOOK = "Send one of editionId, isbn or workId";

/** GET /api/readings/notes: the commonplace book, with /reading/notes's parameters (`page` is the results page) */
export async function GET(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const q = parseNotesQuery(req.nextUrl.searchParams);
    const result = await searchNotes({
      q: q.q,
      workId: q.workId,
      authorId: q.authorId,
      editionId: q.editionId,
      translatorId: q.translatorId,
      kind: q.kind,
      favourites: q.favourites || undefined,
      year: q.year,
      sort: q.sort,
      order: q.order,
      page: q.page,
      perPage: q.perPage,
    });
    return spoken(200, `${result.total.toLocaleString("en-US")} ${result.total === 1 ? "quote or note" : "quotes and notes"}`, {
      items: result.items.map((n) => noteJson(n, n.editionId ? (result.noteEditions[n.editionId] ?? null) : null)),
      total: result.total,
      page: result.page,
      pageCount: result.pageCount,
    });
  } catch (err) {
    return spokenError(err, "Could not list the notes");
  }
}

/**
 * POST /api/readings/notes: keeps a quote (or a note). The book comes from
 * exactly one of `editionId`, `isbn` (a scanned barcode) or `workId`; with
 * `workId` the edition is the named reading's, else the open reading's, else
 * the book's only one, never a guess among several.
 */
export async function POST(req: NextRequest) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const parsed = postSchema.safeParse((await readJson(req)) ?? {});
    if (!parsed.success) return spoken(400, parsed.error.issues[0]?.message ?? "Check what you sent", { issues: parsed.error.issues });
    const { editionId: givenEdition, isbn, workId: givenWork, readingId: givenReading, kind, ...fields } = parsed.data;
    if ([givenEdition, isbn, givenWork].filter((v) => v !== undefined).length !== 1) return spoken(400, ONE_BOOK);

    let editionId: string | null = givenEdition ?? null;
    let workId = givenWork ?? null;
    if (givenEdition) {
      const [edition] = resultRows<{ workId: string }>(await db.execute(sql`select work_id::text as "workId" from editions where id = ${givenEdition}::uuid`));
      if (!edition) return spoken(404, "This edition no longer exists");
      workId = edition.workId;
    } else if (isbn) {
      const match = await editionByIsbn(isbn);
      if (!match.found && match.invalid) return spoken(400, "That is not an ISBN");
      if (!match.found) return spoken(404, "Not in Durtal yet", { addUrl: `/library/new?isbn=${match.isbn}` });
      workId = match.workId;
      editionId = match.editionId;
    }
    const [book] = resultRows<{ kind: string; open: { id: string; editionId: string | null } | null; onlyEdition: string | null; namedEdition: string | null }>(
      await db.execute(sql`select w.kind,
          (select jsonb_build_object('id', r.id, 'editionId', r.edition_id) from readings r
            where r.work_id = w.id and r.status in ('reading', 'paused') order by r.started_on desc nulls last limit 1) as open,
          (select case when count(*) = 1 then min(e.id::text) end from editions e where e.work_id = w.id) as "onlyEdition",
          (select r.edition_id::text from readings r where r.id = ${givenReading ?? null}::uuid and r.work_id = w.id) as "namedEdition"
        from works w where w.id = ${workId}::uuid`),
    );
    if (!book || book.kind !== "book") return spoken(404, "No such book in Durtal");
    // A named reading files the note under its own edition, as the note actions do; a reading with none falls back to the open reading's, then the only one
    if (givenWork) editionId = book.namedEdition ?? book.open?.editionId ?? book.onlyEdition;

    const created = await createReadingNote({
      workId: workId!,
      kind: kind ?? "quote",
      readingId: givenReading === undefined ? (book.open?.id ?? null) : givenReading,
      editionId,
      ...fields,
    });
    const saved = (await getReadingNote(created.id))!;
    const place = pageText(saved.note);
    return spoken(201, `Saved a ${saved.note.kind} from ${saved.note.book.title}${place ? `, ${place}` : ""}`, { note: noteJson(saved.note, saved.edition) });
  } catch (err) {
    return spokenError(err, "Could not save the quote");
  }
}
