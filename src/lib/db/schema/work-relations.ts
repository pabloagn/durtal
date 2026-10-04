import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { WORK_RELATION_TYPES } from "@/lib/catalogue/work-relations";
import { workKindEnum } from "./enums";
import { works } from "./works";
import { sourceRecords } from "./provenance";

/**
 * A directed, typed link between two works (SLN-363): an adaptation, a
 * remake, a flanker or a sourced inspiration. Each end carries its work's
 * kind through a composite key, so the allowed kind pairs are a plain check.
 * Two works have at most one link of a type, in either direction.
 */
export const workRelations = pgTable(
  "work_relations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type", { enum: WORK_RELATION_TYPES }).notNull(),
    fromWorkId: uuid("from_work_id").notNull(),
    fromKind: workKindEnum("from_kind").notNull(),
    toWorkId: uuid("to_work_id").notNull(),
    toKind: workKindEnum("to_kind").notNull(),
    /**
     * A source of the first work (the services check its owner); required for
     * an inspiration. A cited source cannot be deleted.
     */
    sourceRecordId: uuid("source_record_id").references(() => sourceRecords.id),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "work_relation_from_fk",
      columns: [t.fromWorkId, t.fromKind],
      foreignColumns: [works.id, works.kind],
    }).onDelete("cascade"),
    foreignKey({
      name: "work_relation_to_fk",
      columns: [t.toWorkId, t.toKind],
      foreignColumns: [works.id, works.kind],
    }).onDelete("cascade"),
    check("work_relation_self_check", sql`${t.fromWorkId} <> ${t.toWorkId}`),
    check(
      "work_relation_pair_check",
      sql`(${t.type} = 'adaptation' and ((${t.fromKind} = 'film' and ${t.toKind} = 'book') or (${t.fromKind} = 'book' and ${t.toKind} = 'film')))
        or (${t.type} = 'remake' and ${t.fromKind} = 'film' and ${t.toKind} = 'film')
        or (${t.type} = 'flanker' and ${t.fromKind} = 'perfume' and ${t.toKind} = 'perfume')
        or ${t.type} = 'inspiration'`,
    ),
    check(
      "work_relation_source_check",
      sql`${t.type} <> 'inspiration' or ${t.sourceRecordId} is not null`,
    ),
    check(
      "work_relation_notes_check",
      sql`${t.notes} is null or length(trim(${t.notes})) between 1 and 2000`,
    ),
    // One link of a type per pair of works, whichever way it points
    uniqueIndex("work_relation_pair_unique").on(
      sql`least(${t.fromWorkId}, ${t.toWorkId})`,
      sql`greatest(${t.fromWorkId}, ${t.toWorkId})`,
      t.type,
    ),
    index("work_relation_from_idx").on(t.fromWorkId),
    index("work_relation_to_idx").on(t.toWorkId),
    index("work_relation_source_idx").on(t.sourceRecordId),
  ],
);
