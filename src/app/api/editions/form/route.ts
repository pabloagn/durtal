import { NextRequest, NextResponse } from "next/server";
import { createEdition, updateEdition } from "@/lib/actions/editions";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { errorResponse } from "@/lib/api/rest";
import {
  createEditionSchema,
  updateEditionSchema,
} from "@/lib/validations/editions";
import { isUuid } from "@/lib/utils/uuid";
import { COVER_CHANGED, COVER_UNREADABLE } from "@/lib/catalogue/edition-cover";
import { ExpectedActionError } from "@/lib/actions/expected-error";

/** Multipart keeps local image drafts out of the small server-action body
 * limit. Metadata, links and the verified image still publish atomically. */
export async function POST(req: NextRequest) {
  const refused = crossOriginRefusal(req);
  if (refused) return refused;
  try {
    const form = await req.formData();
    const id = form.get("id");
    if (id !== null && (typeof id !== "string" || !isUuid(id)))
      return NextResponse.json(
        { error: "Invalid edition id" },
        { status: 400 },
      );
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json(
        { error: "Choose a cover image." },
        { status: 400 },
      );
    let input: unknown;
    try {
      input = JSON.parse(String(form.get("values")));
    } catch {
      return NextResponse.json(
        { error: "The edition details could not be read." },
        { status: 400 },
      );
    }
    const edition = id
      ? await updateEdition(id, updateEditionSchema.parse(input), file)
      : await createEdition(createEditionSchema.parse(input), file);
    return NextResponse.json(edition);
  } catch (error) {
    if (error instanceof ExpectedActionError)
      return NextResponse.json(
        { error: error.message, href: error.href },
        { status: 422 },
      );
    const message = (error as Error)?.message;
    if (message === COVER_CHANGED || message === COVER_UNREADABLE)
      return NextResponse.json(
        { error: message },
        { status: message === COVER_CHANGED ? 409 : 422 },
      );
    return errorResponse(error, "The edition could not be saved.");
  }
}
