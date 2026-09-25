import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  boolean,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { countries } from "./countries";

export const publishingHouses = pgTable(
  "publishing_houses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    country: text("country"),
    countryId: uuid("country_id").references(() => countries.id, {
      onDelete: "set null",
    }),
    kind: text("kind", { enum: ["publisher", "imprint"] })
      .notNull()
      .default("publisher"),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => publishingHouses.id,
      { onDelete: "restrict" },
    ),
    isFavourite: boolean("is_favourite").notNull().default(false),
    notes: text("notes"),
    description: text("description"),
    website: text("website"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("publishing_houses_name_idx").on(t.name),
    index("publishing_houses_parent_idx").on(t.parentId),
    check(
      "publisher_kind_parent_check",
      sql`(${t.kind} = 'publisher' AND ${t.parentId} IS NULL) OR (${t.kind} = 'imprint' AND ${t.parentId} IS NOT NULL AND ${t.parentId} <> ${t.id})`,
    ),
  ],
);

export const publisherAliases = pgTable(
  "publisher_aliases",
  {
    publisherId: uuid("publisher_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.publisherId, t.name] }),
    index("publisher_aliases_name_idx").on(t.name),
  ],
);

export const publishingHousesRelations = relations(
  publishingHouses,
  ({ one, many }) => ({
    countryRef: one(countries, {
      fields: [publishingHouses.countryId],
      references: [countries.id],
    }),
    publishingHouseSpecialties: many(publishingHouseSpecialties),
  }),
);

export const publisherSpecialties = pgTable("publisher_specialties", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const publisherSpecialtiesRelations = relations(
  publisherSpecialties,
  ({ many }) => ({
    publishingHouseSpecialties: many(publishingHouseSpecialties),
  }),
);

export const publishingHouseSpecialties = pgTable(
  "publishing_house_specialties",
  {
    publishingHouseId: uuid("publishing_house_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "cascade" }),
    specialtyId: uuid("specialty_id")
      .notNull()
      .references(() => publisherSpecialties.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.publishingHouseId, t.specialtyId] })],
);

export const publishingHouseSpecialtiesRelations = relations(
  publishingHouseSpecialties,
  ({ one }) => ({
    publishingHouse: one(publishingHouses, {
      fields: [publishingHouseSpecialties.publishingHouseId],
      references: [publishingHouses.id],
    }),
    specialty: one(publisherSpecialties, {
      fields: [publishingHouseSpecialties.specialtyId],
      references: [publisherSpecialties.id],
    }),
  }),
);
