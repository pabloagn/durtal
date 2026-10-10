import { sql, type SQL } from "drizzle-orm";
import {
  media,
  authors,
  editions,
  venues,
  commentAttachments,
} from "@/lib/db/schema";
import { assertSql } from "@/lib/harmonization/store";

const subjects = {
  media: {
    table: media,
    key: media.s3Key,
    fields: [
      media.id,
      media.type,
      media.s3Key,
      media.thumbnailS3Key,
      media.uncroppedS3Key,
      media.appliedCrop,
      media.width,
      media.height,
      media.cropX,
      media.cropY,
      media.cropZoom,
      media.brightness,
      media.contrast,
      media.originalS3Key,
      media.processingParams,
      media.workId,
      media.authorId,
      media.collectionId,
      media.organizationId,
      media.artObjectId,
      media.perfumeVariantId,
    ],
  },
  author: {
    table: authors,
    key: authors.photoS3Key,
    fields: [authors.id, authors.photoS3Key],
  },
  edition: {
    table: editions,
    key: editions.coverS3Key,
    fields: [editions.id, editions.coverS3Key, editions.thumbnailS3Key],
  },
  venue: {
    table: venues,
    key: venues.posterS3Key,
    fields: [venues.id, venues.posterS3Key, venues.thumbnailS3Key],
  },
  attachment: {
    table: commentAttachments,
    key: commentAttachments.s3Key,
    fields: [
      commentAttachments.id,
      commentAttachments.s3Key,
      commentAttachments.isImage,
      commentAttachments.mimeType,
    ],
  },
} as const;

export type ImageSubjectKind = keyof typeof subjects;
export interface ImageSubject {
  kind: ImageSubjectKind;
  id: string;
}

export const STALE_IMAGE_PRESENTATION =
  "This image changed while you edited it. Reload and review your changes before saving.";

/** Full SQL precision, including timestamps; an absent adjustment row is JSON null. */
function revisionExpression(kind: ImageSubjectKind) {
  const { fields, key } = subjects[kind];
  // Legacy rows may have only a thumbnail. Match resolveImage's canonical key.
  const assetKey =
    kind === "edition"
      ? sql`coalesce(nullif(${editions.coverS3Key}, ''), nullif(${editions.thumbnailS3Key}, ''))`
      : kind === "venue"
        ? sql`coalesce(nullif(${venues.posterS3Key}, ''), nullif(${venues.thumbnailS3Key}, ''))`
        : sql`${key}`;
  const settingsRow = sql`(select to_jsonb(a) from image_adjustments a where a.asset_key = ${assetKey})`;
  const ownerKind =
    kind === "media"
      ? sql`(select kind from works where id = ${media.workId})`
      : sql`null`;
  const revision = sql<string>`md5(jsonb_build_array(
    jsonb_build_array(${sql.join([...fields], sql`, `)}),
    ${ownerKind}, ${settingsRow}
  )::text)`;
  const storedSettings = sql<unknown>`(select settings from image_adjustments where asset_key = ${assetKey})`;
  return { revision, storedSettings };
}

/** Relational-query extras are read in the same snapshot as the registered source. */
export function imageRevisionExtras(kind: ImageSubjectKind) {
  const { revision, storedSettings } = revisionExpression(kind);
  return {
    revision: revision.as("revision"),
    storedSettings: storedSettings.as("stored_settings"),
  };
}

export function imageRevisionSql(subject: ImageSubject): SQL<string> {
  const { table } = subjects[subject.kind];
  return sql<string>`(select ${revisionExpression(subject.kind).revision}
    from ${table} where ${table.id} = ${subject.id}::uuid)`;
}

/** Also locks missing settings identities, so first-save races cannot both pass. */
export function imagePresentationLocks(
  subject: ImageSubject,
  assetKey: string,
): SQL[] {
  const { table } = subjects[subject.kind];
  return [
    sql`select pg_advisory_xact_lock(hashtextextended(${assetKey}, 333))`,
    ...(subject.kind === "media"
      ? [
          sql`select id from works where id =
          (select work_id from media where id = ${subject.id}::uuid) for share`,
        ]
      : []),
    sql`select ${table.id} from ${table} where ${table.id} = ${subject.id}::uuid for update`,
    sql`select asset_key from image_adjustments where asset_key = ${assetKey} for update`,
  ];
}

export function assertImageRevision(subject: ImageSubject, expected: string) {
  return assertSql(
    sql`coalesce(${imageRevisionSql(subject)} = ${expected}, false)`,
    STALE_IMAGE_PRESENTATION,
  );
}
