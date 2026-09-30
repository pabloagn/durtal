import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { taxonomyFamilies } from "./taxonomy-families";
import { workKindEnum } from "./enums";
import { TAXONOMY_LEVELS } from "@/lib/catalogue/taxonomies";

export const taxonomyApplicability = pgTable(
  "taxonomy_applicability",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => taxonomyFamilies.id, { onDelete: "cascade" }),
    kind: workKindEnum("kind").notNull(),
    level: text("level", { enum: TAXONOMY_LEVELS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.familyId, t.kind, t.level] }),
    index("taxonomy_applicability_scope_idx").on(t.kind, t.level, t.familyId),
    check(
      "taxonomy_scope_check",
      sql`${t.level} = 'work' or (${t.kind} = 'book' and ${t.level} = 'edition') or (${t.kind} = 'perfume' and ${t.level} = 'perfume_variant') or (${t.kind} = 'film' and ${t.level} = 'film_version') or (${t.kind} = 'painting' and ${t.level} = 'art_object')`,
    ),
  ],
);
export const taxonomyApplicabilityRelations = relations(
  taxonomyApplicability,
  ({ one }) => ({
    family: one(taxonomyFamilies, {
      fields: [taxonomyApplicability.familyId],
      references: [taxonomyFamilies.id],
    }),
  }),
);
