import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { instances } from "./instances";

export const locations = pgTable("locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'physical' | 'digital'
  street: text("street"),
  city: text("city"),
  region: text("region"),
  country: text("country"),
  countryCode: text("country_code"), // ISO 3166-1 alpha-2
  postalCode: text("postal_code"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  icon: text("icon"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const locationsRelations = relations(locations, ({ many }) => ({
  instances: many(instances, { relationName: "instanceLocation" }),
  subLocations: many(subLocations),
}));

export const subLocations = pgTable("sub_locations", {
  id: uuid("id").defaultRandom().primaryKey(),
  locationId: uuid("location_id")
    .notNull()
    .references(() => locations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const subLocationsRelations = relations(subLocations, ({ one, many }) => ({
  location: one(locations, {
    fields: [subLocations.locationId],
    references: [locations.id],
  }),
  instances: many(instances, { relationName: "instanceSubLocation" }),
}));
