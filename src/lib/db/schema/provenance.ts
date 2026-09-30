import { relations, sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  smallint,
  bigint,
  boolean,
  timestamp,
  jsonb,
  check,
  unique,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { works } from "./works";
import { editions } from "./editions";
import { authors } from "./authors";
import { publishingHouses } from "./publishing-houses";
import { venues } from "./venues";
import { SOURCE_ENTITY_KINDS } from "@/lib/catalogue/provenance";
import { DATE_PRECISIONS } from "@/lib/catalogue/dates";

const ownerColumns = () => ({
  entityKind: text("entity_kind", { enum: SOURCE_ENTITY_KINDS }).notNull(),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  editionId: uuid("edition_id").references(() => editions.id, {
    onDelete: "cascade",
  }),
  personId: uuid("person_id").references(() => authors.id, {
    onDelete: "cascade",
  }),
  organizationId: uuid("organization_id").references(
    () => publishingHouses.id,
    { onDelete: "cascade" },
  ),
  venueId: uuid("venue_id").references(() => venues.id, {
    onDelete: "restrict",
  }),
});
const ownerCheck = sql`num_nonnulls(work_id,edition_id,person_id,organization_id,venue_id)=1 and case entity_kind when 'book' then work_id is not null when 'film' then work_id is not null when 'perfume' then work_id is not null when 'painting' then work_id is not null when 'edition' then edition_id is not null when 'person' then person_id is not null when 'organization' then organization_id is not null when 'venue' then venue_id is not null else false end`;
export const catalogueIdentifiers = pgTable(
  "catalogue_identifiers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...ownerColumns(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("catalogue_identifier_namespace_unique").on(
      t.provider,
      t.entityKind,
      t.externalId,
    ),
    check("catalogue_identifier_owner_check", ownerCheck),
    check(
      "catalogue_identifier_value_check",
      sql`length(${t.provider}) between 1 and 100 and ${t.provider} ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(trim(${t.externalId})) between 1 and 500 and ${t.externalId}=trim(${t.externalId})`,
    ),
    index("catalogue_identifier_work_idx").on(t.workId),
    index("catalogue_identifier_edition_idx").on(t.editionId),
    index("catalogue_identifier_person_idx").on(t.personId),
    index("catalogue_identifier_organization_idx").on(t.organizationId),
    index("catalogue_identifier_venue_idx").on(t.venueId),
  ],
);

/** Provider observations, not a second store of canonical domain metadata. */
export const sourceRecords = pgTable(
  "source_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ...ownerColumns(),
    identifierId: uuid("identifier_id").references(
      () => catalogueIdentifiers.id,
      { onDelete: "set null" },
    ),
    provider: text("provider").notNull(),
    url: text("url"),
    attribution: text("attribution"),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: text("payload_hash").notNull(),
    reviewStatus: text("review_status", {
      enum: ["pending", "accepted", "rejected"],
    })
      .notNull()
      .default("pending"),
    locked: boolean("locked").notNull().default(false),
    revision: integer("revision").notNull().default(0),
    supersedesId: uuid("supersedes_id").references(
      (): AnyPgColumn => sourceRecords.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("source_record_owner_check", ownerCheck),
    unique("source_record_successor_unique").on(t.supersedesId),
    check(
      "source_record_review_check",
      sql`${t.reviewStatus} in ('pending','accepted','rejected')`,
    ),
    check(
      "source_record_value_check",
      sql`length(${t.provider}) between 1 and 100 and ${t.provider} ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and (${t.url} is null or (${t.url} ~ '^https?://' and length(${t.url}) <= 4000)) and jsonb_typeof(${t.payload})='object' and ${t.payloadHash} ~ '^[a-f0-9]{64}$' and ${t.supersedesId} is distinct from ${t.id}`,
    ),
    index("source_record_work_idx").on(t.workId, t.retrievedAt),
    index("source_record_edition_idx").on(t.editionId, t.retrievedAt),
    index("source_record_person_idx").on(t.personId, t.retrievedAt),
    index("source_record_organization_idx").on(t.organizationId, t.retrievedAt),
    index("source_record_venue_idx").on(t.venueId, t.retrievedAt),
    index("source_record_identifier_idx").on(t.identifierId),
  ],
);

/** Referenced by typed date fields in the domain tables, not generic field keys. */
export const catalogueDates = pgTable(
  "catalogue_dates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    precision: text("precision", { enum: DATE_PRECISIONS }).notNull(),
    startYear: integer("start_year"),
    startMonth: smallint("start_month"),
    startDay: smallint("start_day"),
    endYear: integer("end_year"),
    endMonth: smallint("end_month"),
    endDay: smallint("end_day"),
    approximate: boolean("approximate").notNull().default(false),
    label: text("label"),
    lowerBound: bigint("lower_bound", { mode: "number" }).generatedAlwaysAs(
      sql`catalogue_date_lower(start_year,start_month,start_day)`,
    ),
    upperBound: bigint("upper_bound", { mode: "number" }).generatedAlwaysAs(
      sql`catalogue_date_upper(coalesce(end_year,start_year),case when end_year is null then start_month else end_month end,case when end_year is null then start_day else end_day end)`,
    ),
  },
  (t) => [
    check(
      "catalogue_date_components_check",
      sql`catalogue_date_valid(${t.startYear},${t.startMonth},${t.startDay}) and catalogue_date_valid(${t.endYear},${t.endMonth},${t.endDay})`,
    ),
    check(
      "catalogue_date_precision_check",
      sql`case ${t.precision} when 'unknown' then ${t.startYear} is null and ${t.endYear} is null when 'range' then ${t.startYear} is not null and ${t.endYear} is not null and ${t.lowerBound}<=${t.upperBound} when 'year' then ${t.startYear} is not null and ${t.startMonth} is null and ${t.endYear} is null when 'month' then ${t.startYear} is not null and ${t.startMonth} is not null and ${t.startDay} is null and ${t.endYear} is null when 'day' then ${t.startYear} is not null and ${t.startMonth} is not null and ${t.startDay} is not null and ${t.endYear} is null else false end`,
    ),
    check(
      "catalogue_date_label_check",
      sql`${t.label} is null or length(trim(${t.label})) between 1 and 300`,
    ),
    index("catalogue_date_bounds_idx").on(t.lowerBound, t.upperBound),
  ],
);
export const sourceRecordsRelations = relations(sourceRecords, ({ one }) => ({
  identifier: one(catalogueIdentifiers, {
    fields: [sourceRecords.identifierId],
    references: [catalogueIdentifiers.id],
  }),
  previous: one(sourceRecords, {
    fields: [sourceRecords.supersedesId],
    references: [sourceRecords.id],
    relationName: "sourceHistory",
  }),
}));
