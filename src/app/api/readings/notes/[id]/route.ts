import { NextRequest } from "next/server";
import { readJson } from "@/lib/api/rest";
import { noteJson, requireReadingsToken, spoken, spokenError } from "@/lib/api/readings";
import { deleteReadingNote, getReadingNote, updateReadingNote } from "@/lib/actions/reading-notes";
import { isUuid } from "@/lib/utils/uuid";

/*
 * One quote or note (SLN-480): read it, change it (never its book; an
 * unknown field answers 400) or delete it. The token first, as on every
 * /api/readings route.
 */

type Params = { params: Promise<{ id: string }> };

const GONE = "This note no longer exists";

/** The note, or null for an id that is not one */
async function noteOf(id: string) {
  return isUuid(id) ? getReadingNote(id) : null;
}

export async function GET(req: NextRequest, { params }: Params) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const found = await noteOf((await params).id);
    if (!found) return spoken(404, GONE);
    return spoken(200, `A ${found.note.kind} from ${found.note.book.title}`, { note: noteJson(found.note, found.edition) });
  } catch (err) {
    return spokenError(err, "Could not read the note");
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const { id } = await params;
    if (!(await noteOf(id))) return spoken(404, GONE);
    const body = await readJson(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return spoken(400, "Send the fields to change as JSON");
    // The action's schema is strict: workId, source or any unknown field answers 400
    await updateReadingNote({ ...(body as Record<string, unknown>), id } as Parameters<typeof updateReadingNote>[0]);
    const saved = (await getReadingNote(id))!;
    return spoken(200, `Saved the ${saved.note.kind} from ${saved.note.book.title}`, { note: noteJson(saved.note, saved.edition) });
  } catch (err) {
    return spokenError(err, "Could not save the note");
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const refused = requireReadingsToken(req);
  if (refused) return refused;
  try {
    const { id } = await params;
    const found = await noteOf(id);
    if (!found) return spoken(404, GONE);
    await deleteReadingNote({ id });
    return spoken(200, `Deleted the ${found.note.kind} from ${found.note.book.title}`);
  } catch (err) {
    return spokenError(err, "Could not delete the note");
  }
}
