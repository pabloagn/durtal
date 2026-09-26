import { pgTable, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";
import type { ImageAdjustments } from "@/lib/utils/image-adjustments";

/** Display-only settings shared by full images and their thumbnails. Original S3 bytes are untouched. */
export const imageAdjustments = pgTable("image_adjustments", {
  assetKey: text("asset_key").primaryKey(),
  sources: jsonb("sources").$type<string[]>().notNull(),
  settings: jsonb("settings").$type<ImageAdjustments>().notNull(),
  monochrome: boolean("monochrome").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
