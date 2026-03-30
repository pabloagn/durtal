import {
  pgTable,
  uuid,
  text,
  boolean,
  smallint,
  numeric,
  integer,
  date,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { places } from "./places";
import { venueTypeEnum } from "./enums";

export const venues = pgTable("venues", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  type: venueTypeEnum("type").notNull(),
  subtype: text("subtype"),
  description: text("description"),

  // Web presence
  website: text("website"),
  instagramHandle: text("instagram_handle"),
  socialLinks: jsonb("social_links"), // { twitter, facebook, etc. }

  // Physical location
  placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
  formattedAddress: text("formatted_address"),
  googlePlaceId: text("google_place_id"),
  phone: text("phone"),
  email: text("email"),

  // Operating info
  openingHours: jsonb("opening_hours"),
  timezone: text("timezone"),

  // Visual
  posterS3Key: text("poster_s3_key"),
  thumbnailS3Key: text("thumbnail_s3_key"),
  color: text("color"),

  // Personal
  isFavorite: boolean("is_favorite").notNull().default(false),
  personalRating: smallint("personal_rating"),
  notes: text("notes"),
  specialties: text("specialties"),
  tags: text("tags").array(),
  firstVisitDate: date("first_visit_date"),
  lastVisitDate: date("last_visit_date"),

  // Stats (denormalized)
  totalOrders: integer("total_orders").notNull().default(0),
  totalSpent: numeric("total_spent", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  lastOrderDate: date("last_order_date"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const venuesRelations = relations(venues, ({ one }) => ({
  place: one(places, { fields: [venues.placeId], references: [places.id] }),
}));
