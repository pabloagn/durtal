import { ExpectedActionError } from "@/lib/actions/expected-error";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { editionCoverHistory, imageAdjustments } from "@/lib/db/schema";
import { readEditionWriteSnapshot } from "./edition-write-guard";
import {
  ownCover,
  writeCover,
  storedCoverBytes,
  COVER_CHANGED,
} from "./edition-cover";
import { getImagePresentation } from "@/lib/actions/image-adjustments";
import { parseId } from "@/lib/validations/helpers";
import {
  imageAdjustmentsSchema,
  s3ImageSource,
} from "@/lib/utils/image-adjustments";
import { mediaUrl } from "@/lib/s3/media-url";
import {
  allocateCoverStage,
  renderCoverPair,
  stageCoverPair,
  retainCoverAttempt,
  requireVerifiedCover,
} from "@/lib/s3/cover-stage";
import { editionCoverPaletteFields } from "@/lib/color/color-buckets";
import { assertSql, lockSql, resultRows } from "@/lib/harmonization/store";
import { frameImage } from "@/lib/media/frame-image";
import { MAX_STRAIGHTEN, NO_CROP, type AppliedCrop } from "@/lib/media/crop";
import { invalidate, CACHE_TAGS } from "@/lib/cache";

export const editionPresentationSchema = z
  .object({
    settings: imageAdjustmentsSchema,
    crop: z
      .object({
        cropX: z.number().min(0).max(100),
        cropY: z.number().min(0).max(100),
        cropZoom: z.number().min(100).max(300),
        turn: z.number().int().min(0).max(270).multipleOf(90).default(0),
        straighten: z
          .number()
          .int()
          .min(-MAX_STRAIGHTEN)
          .max(MAX_STRAIGHTEN)
          .default(0),
      })
      .strict(),
  })
  .strict();

async function load(editionId: string) {
  parseId(editionId);
  const expected = await readEditionWriteSnapshot(editionId);
  const own = ownCover(expected);
  const ownKey = own.coverS3Key ?? own.thumbnailS3Key;
  const workId = (
    JSON.parse(expected.state) as { edition: { work_id: string } }
  ).edition.work_id;
  const parent = !ownKey
    ? resultRows<{ state: string; key: string }>(
        await db.execute(sql`
    select to_jsonb(m)::text as state, m.s3_key as key from media m
    where m.work_id=${workId}::uuid and m.type='poster' and m.is_active order by m.created_at desc,m.id limit 1`),
      )[0]
    : null;
  const key = ownKey ?? parent?.key;
  if (!key)
    throw new Error("The book has no cover to adjust. Choose an image first.");
  const presentation = await getImagePresentation(s3ImageSource(key));
  const adjustment =
    resultRows<{ state: string }>(
      await db.execute(sql`select to_jsonb(a)::text as state
    from image_adjustments a where a.asset_key=${presentation.assetKey}`),
    )[0]?.state ?? null;
  const history = ownKey
    ? await db.query.editionCoverHistory.findFirst({
        where: and(
          eq(editionCoverHistory.editionId, editionId),
          own.coverS3Key
            ? eq(editionCoverHistory.coverS3Key, own.coverS3Key)
            : sql`${editionCoverHistory.coverS3Key} is null`,
          own.thumbnailS3Key
            ? eq(editionCoverHistory.thumbnailS3Key, own.thumbnailS3Key)
            : sql`${editionCoverHistory.thumbnailS3Key} is null`,
        ),
      })
    : null;
  const applied: AppliedCrop = history?.appliedCrop ?? NO_CROP;
  const baseKey = ownKey
    ? (history?.originalS3Key ?? key)
    : new URL(presentation.preview, "https://durtal.invalid").searchParams.get(
        "key",
      )!;
  const crop = ownKey
    ? {
        cropX: applied.x,
        cropY: applied.y,
        cropZoom: applied.zoom,
        turn: applied.turn ?? 0,
        straighten: applied.straighten ?? 0,
      }
    : (presentation.crop ?? {
        cropX: 50,
        cropY: 50,
        cropZoom: 100,
        turn: 0,
        straighten: 0,
      });
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        expected.state,
        parent?.state,
        adjustment,
        baseKey,
        crop,
        presentation.settings,
      ]),
    )
    .digest("hex");
  return {
    expected,
    own,
    parent,
    adjustment,
    baseKey,
    presentation: {
      ...presentation,
      preview: mediaUrl(baseKey, { width: 800 }),
      crop,
      aspect: 2 / 3,
      contained: false,
      revision,
    },
  };
}

/** Opening or cancelling the editor is read-only, even for inherited artwork. */
export async function editionCoverPresentation(editionId: string) {
  return (await load(editionId)).presentation;
}

/** Save always makes an immutable edition-owned pair; it cannot adjust a
 * parent/sibling image through a shared key. Cropping stays baked into every
 * consumer's display file, and the uncropped choice remains recoverable. */
export async function saveEditionPresentation(
  editionId: string,
  input: z.input<typeof editionPresentationSchema>,
  revision: string,
) {
  const value = editionPresentationSchema.parse(input);
  const context = await load(editionId);
  if (revision !== context.presentation.revision)
    throw new ExpectedActionError(COVER_CHANGED);
  const bytes = await storedCoverBytes(context.baseKey);
  const crop: AppliedCrop = {
    x: value.crop.cropX,
    y: value.crop.cropY,
    zoom: value.crop.cropZoom,
    turn: value.crop.turn,
    straighten: value.crop.straighten,
  };
  const allocation = allocateCoverStage({
    editionId,
    source: {
      kind: "adjustment",
      key: context.baseKey,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.length,
    },
  });
  let baseAllocation: ReturnType<typeof allocateCoverStage> | null = null;
  try {
    const rendered = await renderCoverPair(await frameImage(bytes, crop));
    const stage = await stageCoverPair(
      allocation,
      rendered.buffers,
      rendered.palette,
    );
    requireVerifiedCover(stage, editionId);
    const sources = [stage.coverKey, stage.thumbnailKey].map(s3ImageSource);
    // A parent image can be physically cleaned up later. Keep an independent
    // uncropped edition copy by using the verified cover-pair path below.
    const original =
      context.own.coverS3Key || context.own.thumbnailS3Key
        ? context.baseKey
        : null;
    // For an inherited image, retain a full, uncropped edition-owned pair too.
    baseAllocation = !original
      ? allocateCoverStage({ editionId, source: allocation.source })
      : null;
    const base = baseAllocation
      ? await stageCoverPair(
          baseAllocation,
          (await renderCoverPair(bytes)).buffers,
          null,
        )
      : null;
    if (base) requireVerifiedCover(base, editionId);
    const originalKey = original ?? base!.coverKey;
    const record = {
      assetKey: stage.coverKey,
      sources,
      settings: value.settings,
      monochrome: false,
      updatedAt: new Date(),
    };
    await writeCover(
      editionId,
      context.expected,
      {
        coverS3Key: stage.coverKey,
        thumbnailS3Key: stage.thumbnailKey,
        coverSourceUrl: context.own.coverSourceUrl,
        ...editionCoverPaletteFields(stage.palette),
      },
      {
        before: (d) => [
          d.execute(
            lockSql(
              context.parent
                ? ["media", "image_adjustments"]
                : ["image_adjustments"],
            ),
          ),
          d.execute(
            assertSql(
              sql`(select to_jsonb(a) from image_adjustments a where a.asset_key=${context.presentation.assetKey})
          is not distinct from ${context.adjustment}::jsonb`,
              COVER_CHANGED,
            ),
          ),
          ...(context.parent
            ? [
                d.execute(
                  assertSql(
                    sql`exists(select 1 from media m where m.work_id=${(JSON.parse(context.expected.state) as { edition: { work_id: string } }).edition.work_id}::uuid
          and m.type='poster' and m.is_active and to_jsonb(m)=${context.parent.state}::jsonb)`,
                    COVER_CHANGED,
                  ),
                ),
              ]
            : []),
        ],
        after: (d) => [
          d
            .update(editionCoverHistory)
            .set({ originalS3Key: originalKey, appliedCrop: crop })
            .where(
              and(
                eq(editionCoverHistory.editionId, editionId),
                eq(editionCoverHistory.coverS3Key, stage.coverKey),
              ),
            ),
          d.insert(imageAdjustments).values(record),
        ],
      },
    );
    invalidate(CACHE_TAGS.media, CACHE_TAGS.works);
    return record;
  } catch (error) {
    retainCoverAttempt(
      allocation,
      "edition adjustment publication rejected or uncertain",
    );
    if (baseAllocation)
      retainCoverAttempt(
        baseAllocation,
        "edition adjustment base retained after uncertain publication",
      );
    throw error;
  }
}
