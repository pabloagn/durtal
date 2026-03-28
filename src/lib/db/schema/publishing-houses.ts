import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { countries } from "./countries";

export const publishingHouses = pgTable("publishing_houses", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  country: text("country"),
  countryId: uuid("country_id").references(() => countries.id, {
    onDelete: "set null",
  }),
  description: text("description"),
  website: text("website"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publishingHousesRelations = relations(publishingHouses, ({ one, many }) => ({
  countryRef: one(countries, {
    fields: [publishingHouses.countryId],
    references: [countries.id],
  }),
  publishingHouseSpecialties: many(publishingHouseSpecialties),
}));

export const publisherSpecialties = pgTable("publisher_specialties", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publisherSpecialtiesRelations = relations(publisherSpecialties, ({ many }) => ({
  publishingHouseSpecialties: many(publishingHouseSpecialties),
}));

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
