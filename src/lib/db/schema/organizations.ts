import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  primaryKey,
  index,
  check,
} from "drizzle-orm/pg-core";
import { publishingHouses } from "./publishing-houses";
import { venues } from "./venues";
import { NON_PUBLISHING_ROLES } from "@/lib/catalogue/organizations";

// Book roles are derived from the existing kind/parent profile, never duplicated.
export const organizationRoles = pgTable(
  "organization_roles",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "cascade" }),
    role: text("role", { enum: NON_PUBLISHING_ROLES }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.role] }),
    index("organization_role_idx").on(t.role, t.organizationId),
    check(
      "organization_role_check",
      sql`${t.role} in ('perfume_house', 'brand', 'manufacturer', 'retailer', 'production_company', 'distribution_company', 'museum', 'gallery')`,
    ),
  ],
);

export const organizationVenues = pgTable(
  "organization_venues",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "restrict" }),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id, { onDelete: "restrict" }),
    role: text("role", { enum: ["operator", "owner"] })
      .notNull()
      .default("operator"),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.venueId, t.role] }),
    index("organization_venue_idx").on(t.venueId),
    check(
      "organization_venue_role_check",
      sql`${t.role} in ('operator', 'owner')`,
    ),
  ],
);
export const organizationRolesRelations = relations(
  organizationRoles,
  ({ one }) => ({
    organization: one(publishingHouses, {
      fields: [organizationRoles.organizationId],
      references: [publishingHouses.id],
    }),
  }),
);
export const organizationVenuesRelations = relations(
  organizationVenues,
  ({ one }) => ({
    organization: one(publishingHouses, {
      fields: [organizationVenues.organizationId],
      references: [publishingHouses.id],
    }),
    venue: one(venues, {
      fields: [organizationVenues.venueId],
      references: [venues.id],
    }),
  }),
);
