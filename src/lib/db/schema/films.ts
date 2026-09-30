import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  primaryKey,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { works } from "./works";
import { countries } from "./countries";
import { languages } from "./languages";
import { catalogueDates, sourceRecords } from "./provenance";
import { publishingHouses } from "./publishing-houses";
import { locations, subLocations } from "./locations";
import { venues } from "./venues";
import {
  FILM_HOLDING_MEDIA,
  FILM_ORGANIZATION_ROLES,
  FILM_RELEASE_FORMATS,
} from "@/lib/catalogue/films";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";

const source = () =>
  uuid("source_record_id").references(() => sourceRecords.id);

/** One profile per film work. Cast and crew are shared `work_credits`. */
export const filmDetails = pgTable(
  "film_details",
  {
    workId: uuid("work_id")
      .primaryKey()
      .references(() => works.id, { onDelete: "cascade" }),
    /** The title in the original language, when it differs from the catalogue title. */
    originalTitle: text("original_title"),
    /** First public release or premiere, at any known precision. */
    releaseDateId: uuid("release_date_id").references(() => catalogueDates.id),
    sourceRecordId: source(),
  },
  (t) => [
    check(
      "film_original_title_check",
      sql`${t.originalTitle} is null or length(trim(${t.originalTitle})) between 1 and 500`,
    ),
  ],
);
/** Production countries, in credited order. */
export const filmCountries = pgTable(
  "film_countries",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => filmDetails.workId, { onDelete: "cascade" }),
    countryId: uuid("country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.countryId] }),
    index("film_country_idx").on(t.countryId),
    check("film_country_order_check", sql`${t.sortOrder}>=0`),
  ],
);
/** Original spoken languages, in credited order. */
export const filmLanguages = pgTable(
  "film_languages",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => filmDetails.workId, { onDelete: "cascade" }),
    languageId: uuid("language_id")
      .notNull()
      .references(() => languages.id, { onDelete: "restrict" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.languageId] }),
    index("film_language_idx").on(t.languageId),
    check("film_language_order_check", sql`${t.sortOrder}>=0`),
  ],
);
export const filmOrganizations = pgTable(
  "film_organizations",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => filmDetails.workId, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => publishingHouses.id, { onDelete: "restrict" }),
    role: text("role", { enum: FILM_ORGANIZATION_ROLES }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceRecordId: source(),
  },
  (t) => [
    primaryKey({ columns: [t.workId, t.organizationId, t.role] }),
    index("film_organization_idx").on(t.organizationId, t.role),
    check(
      "film_organization_role_check",
      sql`${t.role} in ('production_company') and ${t.sortOrder}>=0`,
    ),
  ],
);
/**
 * A cut or version of one film. A remake is a separate work; a director's cut
 * is a version. An unknown or unnamed version has a null label.
 */
export const filmVersions = pgTable(
  "film_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => filmDetails.workId, { onDelete: "cascade" }),
    label: text("label"),
    /** Null when unknown; never guessed from another version. */
    runtimeSeconds: integer("runtime_seconds"),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    sourceRecordId: source(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("film_version_identity_unique")
      .on(t.workId, t.label)
      .nullsNotDistinct(),
    index("film_version_work_idx").on(t.workId, t.sortOrder, t.id),
    check(
      "film_version_check",
      sql`(${t.label} is null or length(trim(${t.label})) between 1 and 200) and (${t.runtimeSeconds} is null or ${t.runtimeSeconds} between 1 and 3600000) and ${t.sortOrder}>=0`,
    ),
  ],
);
/** One public release of a version: territory, date, format and distributor. */
export const filmReleases = pgTable(
  "film_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => filmVersions.id, { onDelete: "cascade" }),
    /** Null for a worldwide or unspecified territory. */
    countryId: uuid("country_id").references(() => countries.id, {
      onDelete: "restrict",
    }),
    /** A festival, region or other territory a country cannot express. */
    territoryLabel: text("territory_label"),
    format: text("format", { enum: FILM_RELEASE_FORMATS }).notNull(),
    releaseDateId: uuid("release_date_id").references(() => catalogueDates.id),
    distributorId: uuid("distributor_id").references(
      () => publishingHouses.id,
      { onDelete: "restrict" },
    ),
    notes: text("notes"),
    sourceRecordId: source(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("film_release_version_idx").on(t.versionId),
    index("film_release_country_idx").on(t.countryId),
    index("film_release_distributor_idx").on(t.distributorId),
    check(
      "film_release_check",
      sql`${t.format} in ('theatrical','festival','television','home_media','streaming','other') and (${t.territoryLabel} is null or length(trim(${t.territoryLabel})) between 1 and 200)`,
    ),
  ],
);
/**
 * An optional personal copy. Curating or watching a film never creates one;
 * a copy may name the version and the release it reproduces.
 */
export const filmHoldings = pgTable(
  "film_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => filmDetails.workId, { onDelete: "restrict" }),
    versionId: uuid("version_id").references(() => filmVersions.id, {
      onDelete: "restrict",
    }),
    releaseId: uuid("release_id").references(() => filmReleases.id, {
      onDelete: "restrict",
    }),
    medium: text("medium", { enum: FILM_HOLDING_MEDIA }).notNull(),
    /** Blu-ray, 35 mm print, MKV file and similar. */
    formatLabel: text("format_label"),
    status: text("status", { enum: PERSONAL_HOLDING_STATUSES })
      .notNull()
      .default("held"),
    condition: text("condition"),
    locationId: uuid("location_id").references(() => locations.id, {
      onDelete: "restrict",
    }),
    subLocationId: uuid("sub_location_id").references(() => subLocations.id, {
      onDelete: "restrict",
    }),
    acquisitionDateId: uuid("acquisition_date_id").references(
      () => catalogueDates.id,
    ),
    supplierId: uuid("supplier_id").references(() => publishingHouses.id, {
      onDelete: "restrict",
    }),
    venueId: uuid("venue_id").references(() => venues.id, {
      onDelete: "restrict",
    }),
    acquisitionPrice: numeric("acquisition_price", {
      precision: 11,
      scale: 2,
      mode: "number",
    }),
    acquisitionCurrency: text("acquisition_currency"),
    dispositionDateId: uuid("disposition_date_id").references(
      () => catalogueDates.id,
    ),
    dispositionReason: text("disposition_reason"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("film_holding_work_idx").on(t.workId),
    index("film_holding_version_idx").on(t.versionId),
    index("film_holding_release_idx").on(t.releaseId),
    index("film_holding_location_idx").on(t.locationId),
    index("film_holding_supplier_idx").on(t.supplierId),
    index("film_holding_venue_idx").on(t.venueId),
    check(
      "film_holding_kind_check",
      sql`${t.medium} in ('physical','digital') and ${t.status} in ('held','lent_out','in_storage','missing','disposed') and (${t.formatLabel} is null or length(trim(${t.formatLabel})) between 1 and 200)`,
    ),
    check(
      "film_holding_location_check",
      sql`${t.subLocationId} is null or ${t.locationId} is not null`,
    ),
    check(
      "film_holding_price_check",
      sql`(${t.acquisitionPrice} is null and ${t.acquisitionCurrency} is null) or (${t.acquisitionPrice} is not null and ${t.acquisitionPrice}>=0 and ${t.acquisitionPrice}<=999999999.99 and ${t.acquisitionCurrency} is not null and ${t.acquisitionCurrency} ~ '^[A-Z]{3}$')`,
    ),
    check(
      "film_holding_disposition_check",
      sql`${t.status}='disposed' or (${t.dispositionDateId} is null and ${t.dispositionReason} is null)`,
    ),
  ],
);

export const filmDetailsRelations = relations(filmDetails, ({ one, many }) => ({
  work: one(works, { fields: [filmDetails.workId], references: [works.id] }),
  countries: many(filmCountries),
  languages: many(filmLanguages),
  organizations: many(filmOrganizations),
  versions: many(filmVersions),
  holdings: many(filmHoldings),
}));
export const filmCountriesRelations = relations(filmCountries, ({ one }) => ({
  film: one(filmDetails, {
    fields: [filmCountries.workId],
    references: [filmDetails.workId],
  }),
  country: one(countries, {
    fields: [filmCountries.countryId],
    references: [countries.id],
  }),
}));
export const filmLanguagesRelations = relations(filmLanguages, ({ one }) => ({
  film: one(filmDetails, {
    fields: [filmLanguages.workId],
    references: [filmDetails.workId],
  }),
  language: one(languages, {
    fields: [filmLanguages.languageId],
    references: [languages.id],
  }),
}));
export const filmOrganizationsRelations = relations(
  filmOrganizations,
  ({ one }) => ({
    film: one(filmDetails, {
      fields: [filmOrganizations.workId],
      references: [filmDetails.workId],
    }),
    organization: one(publishingHouses, {
      fields: [filmOrganizations.organizationId],
      references: [publishingHouses.id],
    }),
  }),
);
export const filmVersionsRelations = relations(
  filmVersions,
  ({ one, many }) => ({
    film: one(filmDetails, {
      fields: [filmVersions.workId],
      references: [filmDetails.workId],
    }),
    releases: many(filmReleases),
  }),
);
export const filmReleasesRelations = relations(filmReleases, ({ one }) => ({
  version: one(filmVersions, {
    fields: [filmReleases.versionId],
    references: [filmVersions.id],
  }),
  country: one(countries, {
    fields: [filmReleases.countryId],
    references: [countries.id],
  }),
  distributor: one(publishingHouses, {
    fields: [filmReleases.distributorId],
    references: [publishingHouses.id],
  }),
}));
export const filmHoldingsRelations = relations(filmHoldings, ({ one }) => ({
  film: one(filmDetails, {
    fields: [filmHoldings.workId],
    references: [filmDetails.workId],
  }),
  version: one(filmVersions, {
    fields: [filmHoldings.versionId],
    references: [filmVersions.id],
  }),
  release: one(filmReleases, {
    fields: [filmHoldings.releaseId],
    references: [filmReleases.id],
  }),
}));
