import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  replaceEditionCover,
  COVER_CHANGED,
  COVER_UNREADABLE,
  type CoverInput,
} from "@/lib/catalogue/edition-cover";
import { imageFileRefusal } from "@/lib/validations/media-security";
import { isUuid } from "@/lib/utils/uuid";
import { crossOriginRefusal } from "@/lib/api/same-origin";

const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .optional();
const urlBody = z
  .object({ imageUrl: z.string().url().max(2048), revision: revisionSchema })
  .strict();

/** The image the request carries: a multipart `file`, or JSON `imageUrl` */
async function coverInput(
  req: NextRequest,
): Promise<{ input: CoverInput; revision?: string } | string> {
  if (req.headers.get("content-type")?.includes("application/json")) {
    const parsed = urlBody.safeParse(await req.json().catch(() => null));
    return parsed.success
      ? {
          input: { kind: "url", url: parsed.data.imageUrl },
          revision: parsed.data.revision,
        }
      : "Give an image address.";
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const revision = revisionSchema.safeParse(form?.get("revision") ?? undefined);
  if (!revision.success) return "Reload the edition cover editor.";
  if (!(file instanceof File))
    return "The image did not arrive intact. Please choose it again.";
  const refused = imageFileRefusal(file);
  if (refused) return refused;
  const bytes = Buffer.from(await file.arrayBuffer());
  return bytes.length
    ? { input: { kind: "file", bytes }, revision: revision.data }
    : "File is empty";
}

/**
 * POST /api/editions/[id]/cover — a new own cover for the edition (SLN-638):
 * a multipart `file` chosen or dropped in the cover editor, or JSON
 * `{ imageUrl }` for an image dragged from another page. Nothing changes
 * unless the image is stored and the edition is still as it was read.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const refused = crossOriginRefusal(req);
  if (refused) return refused;
  const { id } = await params;
  if (!isUuid(id))
    return NextResponse.json({ error: "Invalid edition id" }, { status: 400 });
  const input = await coverInput(req);
  if (typeof input === "string")
    return NextResponse.json({ error: input }, { status: 400 });
  try {
    await replaceEditionCover(id, input.input, input.revision);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = (error as Error)?.message;
    if (message === "Edition not found")
      return NextResponse.json({ error: message }, { status: 404 });
    if (message === COVER_CHANGED)
      return NextResponse.json({ error: message }, { status: 409 });
    if (message === COVER_UNREADABLE)
      return NextResponse.json({ error: message }, { status: 422 });
    console.error("Edition cover upload failed:", error);
    return NextResponse.json(
      { error: "The cover could not be saved." },
      { status: 500 },
    );
  }
}
