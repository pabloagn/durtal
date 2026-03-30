import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

export const galleryLayouts = pgTable(
  "gallery_layouts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(), // 'work' | 'author'
    entityId: uuid("entity_id").notNull(),
    layoutData: jsonb("layout_data").notNull(), // computed layout JSON
    seed: integer("seed").notNull().default(0),
    imageCount: integer("image_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("gallery_layouts_entity_unique").on(t.entityType, t.entityId)],
);
