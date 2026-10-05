import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { media } from "@/lib/db/schema";
import { ingestMedia } from "@/lib/media/ingest";
import { ingestRefusal } from "@/lib/media/route-input";
import {
  LogoCardError,
  isLogoCard,
  logoOriginal,
  parseLogoCardOptions,
  renderLogoCard,
} from "@/lib/media/logo-card";
import { MAX_MEDIA_SIZE_BYTES, isAllowedImageType } from "@/lib/validations/media-security";
import { readS3Object } from "@/lib/media/display";
import { isUuid } from "@/lib/utils/uuid";

/** A logo is a raster image, or an SVG (rasterized here, never stored as SVG) */
const isLogoType = (type: string) => isAllowedImageType(type) || type === "image/svg+xml";

/**
 * POST /api/media/logo-card: an organization's logo card (SLN-441).
 *
 * FormData fields:
 *   organizationId: the organization (required)
 *   options: JSON switches: invert, keepColours, emblemOnly, size, badge
 *   file: the logo, SVG, PNG, JPG or WebP; or
 *   mediaId: a saved logo card, whose kept original runs through the switches
 *   preview: "1" answers the card as a PNG and stores nothing
 *
 * Saved, the card becomes the organization's active logo, with the original
 * kept beside it.
 */
export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "The logo did not arrive intact. Please drop it again." }, { status: 400 });
    }
    const organizationId = form.get("organizationId");
    if (typeof organizationId !== "string" || !isUuid(organizationId))
      return NextResponse.json({ error: "Invalid organizationId" }, { status: 400 });
    let options;
    try {
      options = parseLogoCardOptions(JSON.parse(String(form.get("options") ?? "{}")));
    } catch {
      return NextResponse.json({ error: "The switches are not valid JSON" }, { status: 400 });
    }

    // The logo: a new file, or the original kept beside a saved card
    let logo: Buffer;
    let filename: string | null = null;
    const file = form.get("file");
    const mediaId = form.get("mediaId");
    if (file instanceof File) {
      if (file.size === 0) return NextResponse.json({ error: "File is empty" }, { status: 400 });
      if (file.size > MAX_MEDIA_SIZE_BYTES)
        return NextResponse.json({ error: "File too large. Maximum size: 50 MB." }, { status: 400 });
      if (!isLogoType(file.type))
        return NextResponse.json({ error: "File type not allowed. Accepted: SVG, PNG, JPEG, WebP." }, { status: 400 });
      logo = Buffer.from(await file.arrayBuffer());
      filename = file.name;
    } else if (typeof mediaId === "string" && isUuid(mediaId)) {
      const [row] = await db
        .select({ originalS3Key: media.originalS3Key, processingParams: media.processingParams, originalFilename: media.originalFilename })
        .from(media)
        .where(and(eq(media.id, mediaId), eq(media.organizationId, organizationId), eq(media.type, "poster")));
      if (!row?.originalS3Key || !isLogoCard(row.processingParams))
        return NextResponse.json({ error: "This logo has no original to run again" }, { status: 404 });
      logo = await readS3Object(row.originalS3Key);
      filename = row.originalFilename;
    } else {
      return NextResponse.json({ error: "Give a file or a mediaId" }, { status: 400 });
    }

    let card: Buffer;
    try {
      card = await renderLogoCard(logo, options);
    } catch (error) {
      if (error instanceof LogoCardError) return NextResponse.json({ error: error.message }, { status: 400 });
      // An image the decoder cannot read
      return NextResponse.json({ error: "This file could not be read as an image" }, { status: 400 });
    }
    if (form.get("preview") === "1")
      return new NextResponse(new Uint8Array(card), {
        headers: { "content-type": "image/png", "cache-control": "no-store" },
      });

    const saved = await ingestMedia({
      owner: { type: "organization", id: organizationId },
      mediaType: "poster",
      buffer: card,
      originalFilename: filename,
      logoCard: { original: await logoOriginal(logo), options },
    });
    return NextResponse.json({ media: saved });
  } catch (err) {
    const refused = ingestRefusal(err);
    if (refused) return refused;
    console.error("Logo card failed:", err);
    return NextResponse.json({ error: "Logo card failed" }, { status: 500 });
  }
}
