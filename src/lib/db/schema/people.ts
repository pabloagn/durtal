import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  primaryKey,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { authors } from "./authors";
import { works } from "./works";
import { workKindEnum, attributionEnum } from "./enums";

// The physical authors table is the canonical person identity. Do not create a
// second people row or export a duplicate table alias into the Drizzle schema.
export const personDomains = pgTable(
  "person_domains",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    kind: workKindEnum("kind").notNull(),
  },
  (t) => [primaryKey({ columns: [t.personId, t.kind] })],
);

export const personAliases = pgTable(
  "person_aliases",
  {
    personId: uuid("person_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    searchText: text("search_text").generatedAlwaysAs(
      sql`search_normalize(name)`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.personId, t.name] }),
    check(
      "person_alias_name_check",
      sql`length(trim(${t.name})) between 1 and 300`,
    ),
    index("person_alias_search_idx").using(
      "gin",
      t.searchText.op("gin_trgm_ops"),
    ),
  ],
);

export const creditRoles = pgTable(
  "credit_roles",
  {
    id: text("id").primaryKey(),
    kind: workKindEnum("kind").notNull(),
    level: text("level").$type<"work" | "edition">().notNull(),
    label: text("label").notNull(),
    legacyRole: text("legacy_role"),
  },
  (t) => [
    check("credit_role_level_check", sql`${t.level} in ('work', 'edition')`),
    unique("credit_role_legacy_unique").on(t.kind, t.level, t.legacyRole),
  ],
);

/** Repeatable non-book work credits. Book credit stores are adapted separately. */
export const workCredits = pgTable(
  "work_credits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => authors.id, {
      onDelete: "restrict",
    }),
    roleId: text("role_id")
      .notNull()
      .references(() => creditRoles.id, { onDelete: "restrict" }),
    creditedAs: text("credited_as"),
    attribution: attributionEnum("attribution")
      .notNull()
      .default("unspecified"),
    characters: text("characters")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("work_credit_order_check", sql`${t.sortOrder} >= 0`),
    check(
      "work_credit_identity_check",
      sql`${t.personId} is not null or coalesce(length(trim(${t.creditedAs})), 0) > 0 or ${t.attribution} in ('anonymous', 'unknown')`,
    ),
    check(
      "work_credit_characters_check",
      sql`cardinality(${t.characters}) <= 50 and array_position(${t.characters}, null) is null`,
    ),
    index("work_credit_work_order_idx").on(t.workId, t.sortOrder, t.id),
    index("work_credit_person_idx").on(t.personId),
    // A collection's credited people with their work counts (cast, directors,
    // perfumers) read this index alone (SLN-381)
    index("work_credit_role_person_work_idx").on(t.roleId, t.personId, t.workId),
  ],
);

export const personDomainsRelations = relations(personDomains, ({ one }) => ({
  person: one(authors, {
    fields: [personDomains.personId],
    references: [authors.id],
  }),
}));
export const personAliasesRelations = relations(personAliases, ({ one }) => ({
  person: one(authors, {
    fields: [personAliases.personId],
    references: [authors.id],
  }),
}));
export const workCreditsRelations = relations(workCredits, ({ one }) => ({
  person: one(authors, {
    fields: [workCredits.personId],
    references: [authors.id],
  }),
  work: one(works, { fields: [workCredits.workId], references: [works.id] }),
  role: one(creditRoles, {
    fields: [workCredits.roleId],
    references: [creditRoles.id],
  }),
}));
