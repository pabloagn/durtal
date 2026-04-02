import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    contentHtml: text("content_html").notNull(),
    contentJson: jsonb("content_json"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("comments_entity_idx").on(t.entityType, t.entityId),
    index("comments_created_at_idx").on(t.createdAt),
  ],
);

export const commentsRelations = relations(comments, ({ many }) => ({
  attachments: many(commentAttachments),
}));

export const commentAttachments = pgTable("comment_attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  commentId: uuid("comment_id")
    .notNull()
    .references(() => comments.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  s3Key: text("s3_key").notNull(),
  isImage: boolean("is_image").notNull().default(false),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const commentAttachmentsRelations = relations(
  commentAttachments,
  ({ one }) => ({
    comment: one(comments, {
      fields: [commentAttachments.commentId],
      references: [comments.id],
    }),
  }),
);
