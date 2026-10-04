import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  smallint,
  boolean,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { countries } from "./countries";
import { places } from "./places";
import { organizationRoles, organizationVenues } from "./organizations";

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
    // group → publisher → imprint (task 0179): a group owns publishers, a
    // publisher owns imprints, a book links to the most specific one it shows.
    // Null: a shared organization without a book publishing profile.
    kind: text("kind", { enum: ["group", "publisher", "imprint"] }).default(
      "publisher",
    ),
    parentId: uuid("parent_id").references(
      (): AnyPgColumn => publishingHouses.id,
      { onDelete: "restrict" },
    ),
    isFavourite: boolean("is_favourite").notNull().default(false),
    notes: text("notes"),
    description: text("description"),
    website: text("website"),
    // When and where the house was founded (SLN-427)
    foundedYear: smallint("founded_year"),
    foundedPlaceId: uuid("founded_place_id").references(() => places.id, {
      onDelete: "set null",
    }),
    searchText: text("search_text").generatedAlwaysAs(
      sql`search_normalize(name)`,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("publishing_houses_name_idx").on(t.name),
    index("publishing_houses_parent_idx").on(t.parentId),
    index("organization_search_idx").using(
      "gin",
      t.searchText.op("gin_trgm_ops"),
    ),
    check(
      "publisher_founded_year_check",
      sql`${t.foundedYear} is null or ${t.foundedYear} between 1000 and 2100`,
    ),
    check(
      "publisher_kind_parent_check",
      sql`case when ${t.kind} is null then ${t.parentId} is null else (${t.kind} = 'group' AND ${t.parentId} IS NULL) OR (${t.kind} = 'publisher' AND (${t.parentId} IS NULL OR ${t.parentId} <> ${t.id})) OR (${t.kind} = 'imprint' AND ${t.parentId} IS NOT NULL AND ${t.parentId} <> ${t.id}) end`,
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
    searchText: text("search_text").generatedAlwaysAs(
      sql`search_normalize(name)`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.publisherId, t.name] }),
    index("publisher_aliases_name_idx").on(t.name),
    index("organization_alias_search_idx").using(
      "gin",
      t.searchText.op("gin_trgm_ops"),
    ),
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
    roles: many(organizationRoles),
    venues: many(organizationVenues),
    aliases: many(publisherAliases),
  }),
);

export const publisherAliasesRelations = relations(
  publisherAliases,
  ({ one }) => ({
    organization: one(publishingHouses, {
      fields: [publisherAliases.publisherId],
      references: [publishingHouses.id],
    }),
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
