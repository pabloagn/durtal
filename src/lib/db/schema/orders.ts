import {
  pgTable,
  uuid,
  text,
  numeric,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { works } from "./works";
import { editions } from "./editions";
import { instances } from "./instances";
import { venues } from "./venues";
import { places } from "./places";
import { locations, subLocations } from "./locations";
import { orderStatusEnum, acquisitionMethodEnum } from "./enums";
import { orderStatusHistory } from "./order-status-history";

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  editionId: uuid("edition_id").references(() => editions.id, {
    onDelete: "set null",
  }),
  instanceId: uuid("instance_id").references(() => instances.id, {
    onDelete: "set null",
  }),
  venueId: uuid("venue_id").references(() => venues.id, {
    onDelete: "set null",
  }),

  acquisitionMethod: acquisitionMethodEnum("acquisition_method").notNull(),
  status: orderStatusEnum("status").notNull().default("placed"),

  orderDate: date("order_date").notNull(),
  orderConfirmation: text("order_confirmation"),
  orderUrl: text("order_url"),

  price: numeric("price", { precision: 10, scale: 2 }),
  shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }),
  totalCost: numeric("total_cost", { precision: 10, scale: 2 }),
  currency: text("currency"),

  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  trackingUrl: text("tracking_url"),
  shippedDate: date("shipped_date"),
  estimatedDeliveryDate: date("estimated_delivery_date"),
  actualDeliveryDate: date("actual_delivery_date"),

  originDescription: text("origin_description"),
  originPlaceId: uuid("origin_place_id").references(() => places.id, {
    onDelete: "set null",
  }),
  destinationLocationId: uuid("destination_location_id").references(
    () => locations.id,
    { onDelete: "set null" },
  ),
  destinationSubLocationId: uuid("destination_sub_location_id").references(
    () => subLocations.id,
    { onDelete: "set null" },
  ),

  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  work: one(works, {
    fields: [orders.workId],
    references: [works.id],
  }),
  edition: one(editions, {
    fields: [orders.editionId],
    references: [editions.id],
  }),
  instance: one(instances, {
    fields: [orders.instanceId],
    references: [instances.id],
  }),
  venue: one(venues, {
    fields: [orders.venueId],
    references: [venues.id],
  }),
  originPlace: one(places, {
    fields: [orders.originPlaceId],
    references: [places.id],
  }),
  destinationLocation: one(locations, {
    fields: [orders.destinationLocationId],
    references: [locations.id],
    relationName: "orderDestinationLocation",
  }),
  destinationSubLocation: one(subLocations, {
    fields: [orders.destinationSubLocationId],
    references: [subLocations.id],
    relationName: "orderDestinationSubLocation",
  }),
  statusHistory: many(orderStatusHistory),
}));
