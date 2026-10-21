import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { editions } from "./editions";
import type { AppliedCrop } from "@/lib/media/crop";

/** Committed cover choices. The edition trigger captures every publication,
 * including imports and ordinary Edit edition, in the publishing transaction. */
export const editionCoverHistory = pgTable(
  "edition_cover_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    editionId: uuid("edition_id")
      .notNull()
      .references(() => editions.id, { onDelete: "cascade" }),
    coverS3Key: text("cover_s3_key"),
    thumbnailS3Key: text("thumbnail_s3_key"),
    coverSourceUrl: text("cover_source_url"),
    /** The uncropped edition-owned image; null on legacy/first publications. */
    originalS3Key: text("original_s3_key"),
    appliedCrop: jsonb("applied_crop").$type<AppliedCrop>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("edition_cover_history_choice_unique")
      .on(t.editionId, t.coverS3Key, t.thumbnailS3Key)
      .nullsNotDistinct(),
    index("edition_cover_history_edition_idx").on(t.editionId, t.createdAt),
    check(
      "edition_cover_history_image_check",
      sql`${t.coverS3Key} is not null or ${t.thumbnailS3Key} is not null`,
    ),
  ],
);
