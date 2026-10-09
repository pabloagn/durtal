import {
  pgTable,
  uuid,
  text,
  real,
  jsonb,
  timestamp,
  index,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { ebooks, ebookFiles } from "./ebooks";
import type { DurtalLocator } from "@/lib/reader/engine";

/** SLN-500 proposed declarations for reserved 0083: NOT generated/applied yet.
 * String timestamps retain PostgreSQL microseconds; wire queries format UTC
 * with to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), never JavaScript Date.
 * 0083's reviewed hand SQL supplies locator validation and lifecycle triggers.
 */
export const ebookAnnotations = pgTable(
  "ebook_annotations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references(() => ebooks.id, { onDelete: "restrict" }),
    fileId: uuid("file_id").notNull(),
    kind: text("kind", { enum: ["highlight", "bookmark"] }).notNull(),
    /** Only the internal tracker composition creates/converts quote style. */
    style: text("style", { enum: ["highlight", "underline", "quote"] })
      .notNull()
      .default("highlight"),
    color: text("color", {
      enum: ["ochre", "sage", "slate", "rose", "violet"],
    }),
    locator: jsonb("locator").$type<DurtalLocator>().notNull(),
    progression: real("progression").notNull(),
    chapter: text("chapter"),
    text: text("text"),
    note: text("note"),
    anchorState: text("anchor_state", {
      enum: ["exact", "healed", "approximate", "orphaned"],
    })
      .notNull()
      .default("exact"),
    deviceId: text("device_id"),
    /** Opaque server-issued epoch; 0087 rotates it on note/book association changes.
     * No opposite-direction note FK: SLN-454 owns reading_notes.ebook_annotation_id.
     */
    quoteBindingVersion: uuid("quote_binding_version"),
    clientUpdatedAt: timestamp("client_updated_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }),
  },
  (t) => [
    foreignKey({
      name: "ebook_annotations_file_ebook_fk",
      columns: [t.fileId, t.ebookId],
      foreignColumns: [ebookFiles.id, ebookFiles.ebookId],
    }).onDelete("restrict"),
    check(
      "ebook_annotations_kind_check",
      sql`${t.kind} in ('highlight', 'bookmark')`,
    ),
    check(
      "ebook_annotations_style_check",
      sql`${t.style} in ('highlight', 'underline', 'quote')`,
    ),
    check(
      "ebook_annotations_color_check",
      sql`${t.color} is null or ${t.color} in ('ochre', 'sage', 'slate', 'rose', 'violet')`,
    ),
    check(
      "ebook_annotations_anchor_state_check",
      sql`${t.anchorState} in ('exact', 'healed', 'approximate', 'orphaned')`,
    ),
    check(
      "ebook_annotations_text_check",
      sql`${t.text} is null or char_length(${t.text}) <= 10000`,
    ),
    check(
      "ebook_annotations_note_check",
      sql`${t.note} is null or char_length(${t.note}) <= 10000`,
    ),
    check(
      "ebook_annotations_chapter_check",
      sql`${t.chapter} is null or char_length(${t.chapter}) <= 300`,
    ),
    check(
      "ebook_annotations_progression_check",
      sql`${t.progression} between 0 and 1`,
    ),
    check(
      "ebook_annotations_locator_check",
      sql`public.durtal_annotation_locator_valid(${t.locator})`,
    ),
    check(
      "ebook_annotations_metadata_check",
      sql`
    (${t.kind} = 'bookmark' and ${t.style} = 'highlight' and ${t.color} is null and ${t.text} is null and ${t.note} is null and ${t.quoteBindingVersion} is null)
    or (${t.kind} = 'highlight' and ${t.text} is not null and char_length(${t.text}) between 1 and 10000 and btrim(${t.text}) <> ''
      and (${t.locator} #>> '{text,highlight}') is not null and btrim(${t.locator} #>> '{text,highlight}') <> ''
      and ((${t.style} = 'quote' and ${t.color} is null and ${t.quoteBindingVersion} is not null)
        or (${t.style} in ('highlight', 'underline') and ${t.color} is not null and ${t.quoteBindingVersion} is null)))`,
    ),
    check(
      "ebook_annotations_time_check",
      sql`isfinite(${t.clientUpdatedAt}) and isfinite(${t.createdAt}) and isfinite(${t.updatedAt}) and (${t.deletedAt} is null or isfinite(${t.deletedAt})) and ${t.createdAt} <= ${t.updatedAt} and (${t.deletedAt} is null or ${t.deletedAt} <= ${t.updatedAt})`,
    ),
    index("ebook_annotations_ebook_idx").on(
      t.ebookId,
      t.deletedAt,
      t.progression,
    ),
    index("ebook_annotations_sync_idx").on(t.ebookId, t.updatedAt, t.id),
    index("ebook_annotations_search_idx")
      .using(
        "gin",
        sql`(public.search_normalize(coalesce(${t.text}, '') || ' ' || coalesce(${t.note}, ''))) gin_trgm_ops`,
      )
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Permanent minimal ledger: never aged out with the full 90-day tombstones.
 * A statement-level hand-SQL guard also prohibits TRUNCATE, including CASCADE.
 * A global UUID cannot be recycled in this or any other e-book. RESTRICT keeps
 * its owning e-book identity; ingestion undo must account for retired ids too.
 */
export const ebookAnnotationRetiredIds = pgTable(
  "ebook_annotation_retired_ids",
  {
    id: uuid("id").primaryKey(),
    ebookId: uuid("ebook_id")
      .notNull()
      .references(() => ebooks.id, { onDelete: "restrict" }),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }).notNull(),
  },
  (t) => [
    check(
      "ebook_annotation_retired_ids_time_check",
      sql`isfinite(${t.retiredAt})`,
    ),
    index("ebook_annotation_retired_ids_ebook_idx").on(t.ebookId),
  ],
);

/** One locked logical clock per book, advanced on pulls as well as writes.
 * Advancing pulls establishes a durable upper bound even for empty books and
 * keeps the 90-day reset window based on elapsed server time, not the last edit.
 */
// Review SQL also refuses statement-level TRUNCATE/CASCADE so this clock cannot reset.
export const ebookAnnotationCursors = pgTable(
  "ebook_annotation_cursors",
  {
    ebookId: uuid("ebook_id")
      .primaryKey()
      .references(() => ebooks.id, { onDelete: "cascade" }),
    serverTime: timestamp("server_time", {
      withTimezone: true,
      precision: 6,
      mode: "string",
    }).notNull(),
  },
  (t) => [
    check(
      "ebook_annotation_cursors_time_check",
      sql`isfinite(${t.serverTime})`,
    ),
  ],
);

export const ebookAnnotationsRelations = relations(
  ebookAnnotations,
  ({ one }) => ({
    ebook: one(ebooks, {
      fields: [ebookAnnotations.ebookId],
      references: [ebooks.id],
    }),
    file: one(ebookFiles, {
      fields: [ebookAnnotations.fileId],
      references: [ebookFiles.id],
    }),
  }),
);
