import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  replaceEditionCover,
  COVER_CHANGED,
  COVER_UNREADABLE,
  type CoverInput,
} from "@/lib/catalogue/edition-cover";
import { isAllowedImageType, MAX_MEDIA_SIZE_BYTES } from "@/lib/validations/media-security";
import { isUuid } from "@/lib/utils/uuid";

const urlBody = z.object({ imageUrl: z.string().url().max(2048) }).strict();

/** The image the request carries: a multipart `file`, or JSON `imageUrl` */
async function coverInput(req: NextRequest): Promise<CoverInput | string> {
  if (req.headers.get("content-type")?.includes("application/json")) {
    const parsed = urlBody.safeParse(await req.json().catch(() => null));
    return parsed.success ? { kind: "url", url: parsed.data.imageUrl } : "Give an image address.";
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return "The image did not arrive intact. Please choose it again.";
  if (file.size > MAX_MEDIA_SIZE_BYTES) return "File too large. Maximum size: 50 MB.";
  if (!isAllowedImageType(file.type)) return "File type not allowed. Accepted: JPEG, PNG, WebP, GIF.";
  const bytes = Buffer.from(await file.arrayBuffer());
  return bytes.length ? { kind: "file", bytes } : "File is empty";
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
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid edition id" }, { status: 400 });
  const input = await coverInput(req);
  if (typeof input === "string") return NextResponse.json({ error: input }, { status: 400 });
  try {
    await replaceEditionCover(id, input);
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
    return NextResponse.json({ error: "The cover could not be saved." }, { status: 500 });
  }
}
