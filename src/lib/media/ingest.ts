import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { atomic } from "@/lib/db/atomic";
import { withReadableErrors } from "@/lib/db/errors";
import {
  artObjects,
  authors,
  collections,
  media,
  perfumeVariants,
  publishingHouses,
  works,
} from "@/lib/db/schema";
import { resultRows } from "@/lib/harmonization/store";
import { renderAuthorImage, renderImage } from "@/lib/s3/media";
import { uploadToS3 } from "@/lib/s3/covers";
import {
  goldMediaKey,
  goldMediaOriginalKey,
  goldMediaThumbnailKey,
  type MediaEntityType,
} from "@/lib/s3/keys";
import { deleteUnusedObjects } from "@/lib/s3/cleanup";
import {
  DEFAULT_MONOCHROME_PARAMS,
  mediaAttributionSchema,
  type MediaAttribution,
  type MonochromeParams,
} from "@/lib/validations/media";
import { extractColorPalette } from "@/lib/color/extract-palette";
import { recordActivity } from "@/lib/activity/record";
import { invalidate, CACHE_TAGS } from "@/lib/cache";
import type { WorkKind } from "@/lib/catalogue/kinds";
import type { ColorPalette, MediaType } from "@/lib/types";
import { imagePolicy } from "./policy";
import { MEDIA_OWNER_COLUMN, mediaOwnerFields, supportsMediaType } from "./owner";

/** A request the caller can correct; routes answer it with its status. */
export class MediaIngestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message);
  }
}

export interface IngestInput {
  owner: { type: MediaEntityType; id: string };
  mediaType: MediaType;
  /** The received image, already checked for type and size. */
  buffer: Buffer;
  originalFilename?: string | null;
  /** Reuse an ID already given to a bronze upload; else a new one. */
  fileId?: string;
  caption?: string | null;
  attribution?: MediaAttribution;
  /** Author portraits only. */
  processingParams?: MonochromeParams;
}

/** The owner's domain decides its image policy; a missing owner is refused. */
async function ownerKind(owner: IngestInput["owner"]): Promise<WorkKind | null> {
  const id = owner.id;
  const found = await (async () => {
    switch (owner.type) {
      case "work":
        return db.query.works.findFirst({
          where: eq(works.id, id),
          columns: { kind: true },
        });
      case "art_object":
        return (await db.query.artObjects.findFirst({
          where: eq(artObjects.id, id),
          columns: { id: true },
        }))
          ? { kind: "painting" as const }
          : undefined;
      case "perfume_variant":
        return (await db.query.perfumeVariants.findFirst({
          where: eq(perfumeVariants.id, id),
          columns: { id: true },
        }))
          ? { kind: "perfume" as const }
          : undefined;
      case "author":
        return (await db.query.authors.findFirst({
          where: eq(authors.id, id),
          columns: { id: true },
        }))
          ? { kind: null }
          : undefined;
      case "collection":
        return (await db.query.collections.findFirst({
          where: eq(collections.id, id),
          columns: { id: true },
        }))
          ? { kind: null }
          : undefined;
      case "organization":
        return (await db.query.publishingHouses.findFirst({
          where: eq(publishingHouses.id, id),
          columns: { id: true },
        }))
          ? { kind: null }
          : undefined;
    }
  })();
  if (!found) throw new MediaIngestError("The image owner was not found", 404);
  return found.kind;
}

/**
 * The one path from a received image to stored files and a media row. Sizes
 * follow the owner's image policy. A poster or background becomes the active
 * one in the same transaction that records it. If storing or recording fails,
 * the files already stored are deleted again, so no file is left without a
 * row and no row points at a missing file.
 */
export async function ingestMedia(input: IngestInput) {
  const { owner, mediaType } = input;
  if (!supportsMediaType(owner.type, mediaType))
    throw new MediaIngestError("This owner does not accept that image type", 400);
  const attribution = mediaAttributionSchema.parse(input.attribution ?? {});
  const kind = await ownerKind(owner);
  const policy = imagePolicy({ type: owner.type, kind }, mediaType);
  const params = policy.monochrome
    ? (input.processingParams ?? DEFAULT_MONOCHROME_PARAMS)
    : null;
  const rendered = params
    ? await renderAuthorImage(input.buffer, policy, params)
    : await renderImage(input.buffer, policy);
  let colorPalette: ColorPalette | null = null;
  if (owner.type === "work" && mediaType === "poster")
    try {
      colorPalette = await extractColorPalette(input.buffer);
    } catch (error) {
      console.error("Color palette extraction failed (non-blocking):", error);
    }

  const fileId = input.fileId ?? randomUUID();
  const keys = {
    s3Key: goldMediaKey(owner.type, owner.id, mediaType, fileId),
    thumbnailS3Key: goldMediaThumbnailKey(owner.type, owner.id, mediaType, fileId),
    originalS3Key: rendered.original
      ? goldMediaOriginalKey(owner.type, owner.id, mediaType, fileId)
      : null,
  };
  const files: [string, Buffer][] = [
    [keys.s3Key, rendered.full],
    [keys.thumbnailS3Key, rendered.thumb],
    ...(rendered.original && keys.originalS3Key
      ? [[keys.originalS3Key, rendered.original] as [string, Buffer]]
      : []),
  ];
  const stored: string[] = [];
  const id = randomUUID();
  const column = MEDIA_OWNER_COLUMN[owner.type];
  let row: typeof media.$inferSelect;
  try {
    const uploads = await Promise.allSettled(
      files.map(([key, body]) =>
        uploadToS3(key, body, "image/webp").then(() => key),
      ),
    );
    for (const upload of uploads)
      if (upload.status === "fulfilled") stored.push(upload.value);
    const failed = uploads.find((upload) => upload.status === "rejected");
    if (failed) throw (failed as PromiseRejectedResult).reason;
    const results = await withReadableErrors(() =>
      atomic((d) => [
        ...(mediaType !== "gallery"
          ? [
              d
                .update(media)
                .set({ isActive: false })
                .where(and(eq(column, owner.id), eq(media.type, mediaType))),
            ]
          : []),
        d
          .insert(media)
          .values({
            id,
            ...mediaOwnerFields(owner.type, owner.id),
            type: mediaType,
            ...keys,
            originalFilename: input.originalFilename ?? null,
            mimeType: "image/webp",
            width: rendered.width,
            height: rendered.height,
            sizeBytes: input.buffer.length,
            isActive: true,
            caption: input.caption ?? null,
            processingParams: params,
            colorPalette,
            ...attribution,
          })
          .returning(),
      ]),
    );
    row = resultRows<typeof media.$inferSelect>(results.at(-1))[0];
  } catch (error) {
    // Compensation: nothing references these new keys, so they are removed.
    if (stored.length)
      await deleteUnusedObjects(
        { keys: stored, prefixes: [] },
        `failed ${mediaType} upload for ${owner.type} ${owner.id}`,
      );
    throw error;
  }
  if (owner.type === "work" || owner.type === "author")
    recordActivity(owner.type, owner.id, `${owner.type}.${mediaType}_uploaded`);
  invalidate(CACHE_TAGS.works, CACHE_TAGS.media, CACHE_TAGS.collections);
  return row;
}
