import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { countries } from "./countries";

export const places = pgTable("places", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  fullName: text("full_name"), // precomputed: "Auteuil, Paris, Île-de-France, France"
  type: text("type").notNull(), // country | region | state | province | city | town | village | district | neighborhood
  parentId: uuid("parent_id").references((): any => places.id, { onDelete: "set null" }),
  countryId: uuid("country_id").references(() => countries.id, { onDelete: "set null" }),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geonameId: integer("geoname_id"),
  wikidataId: text("wikidata_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const placesRelations = relations(places, ({ one, many }) => ({
  parent: one(places, {
    fields: [places.parentId],
    references: [places.id],
    relationName: "placeHierarchy",
  }),
  children: many(places, { relationName: "placeHierarchy" }),
  country: one(countries, {
    fields: [places.countryId],
    references: [countries.id],
  }),
}));
