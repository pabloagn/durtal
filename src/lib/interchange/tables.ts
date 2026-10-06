import type { PgTable } from "drizzle-orm/pg-core";
import * as s from "@/lib/db/schema";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { tableShape, type TableShape } from "./columns";

/*
 * The tables of interchange format version 1 (SLN-375), in the order an
 * import writes them. Three kinds:
 *
 * - record: belongs to one work and travels inside that work's record, in a
 *   named section. `parent` names the column that ties a row to its owner.
 * - entity: shared by many works (people, organizations, venues, places,
 *   storage locations, collections, series, vocabularies). It travels once,
 *   in `shared`. An import adds it when it is missing and never changes it.
 *   With `natural`, a row is the local row of the same natural key (a
 *   country by its ISO code, a taxonomy item by family and slug): its id is
 *   translated. Without `create`, a missing one is an error.
 * - part: a row that belongs to an entity (an organization's roles, a
 *   person's other names). It travels with its entity and is added when
 *   missing; `forExisting` parts are also added to an entity that is already
 *   here, because records need them (a perfume house needs that role).
 *
 * Not carried in version 1: images and their files, comments, activity,
 * readings (the Durtal reading CSV carries them), orders and acquisition
 * targets, Calibre links and harmonization history; nor the colours derived
 * from a cover (`DERIVED_COLUMNS` in `./columns.ts`), which the cover-colour
 * backfill recomputes.
 *
 * Changing any of these tables changes the format: the test in
 * `interchange-format.test.ts` pins every column, and a change needs a new
 * version with a reader for the old one.
 */

export const SECTIONS = [
  "identity",
  "credits",
  "realizations",
  "holdings",
  "history",
  "taxonomy",
  "sources",
  "dates",
  "retail",
  "curation",
  "collections",
  "relations",
] as const;
export type Section = (typeof SECTIONS)[number];

interface BaseSpec {
  table: PgTable;
}
export interface RecordSpec extends BaseSpec {
  mode: "record";
  section: Section;
  /** The collections whose records carry this table; every collection when absent */
  domains?: readonly WorkKind[];
  /** The column and table that own a row, up to `works`; none for `works` and dates */
  parent?: { column: string; table: string };
  /** A second owner column: a source belongs to a work or to one of its editions */
  alsoParent?: { column: string; table: string };
  /** Pulled into a record when one of its rows refers to it (a date, a cited source) */
  referenced?: boolean;
  /**
   * Shared records that may own a row instead of a work: an identifier or a
   * source of a person, an organization or a venue travels in `shared` with
   * its owner.
   */
  entityOwners?: readonly { column: string; table: string }[];
}
export interface EntitySpec extends BaseSpec {
  mode: "entity";
  natural?: readonly string[];
  create: boolean;
  /** How the error names a missing one */
  label: string;
}
export interface PartSpec extends BaseSpec {
  mode: "part";
  parent: { column: string; table: string };
  forExisting?: boolean;
  /** A new entity has exactly the file's parts: what the database adds on its own goes */
  exact?: boolean;
}
export type TableSpec = RecordSpec | EntitySpec | PartSpec;

const BOOK = ["book"] as const;
const work = { column: "work_id", table: "works" };
const edition = { column: "edition_id", table: "editions" };
const perfume = { column: "work_id", table: "perfume_details" };
const variant = { column: "variant_id", table: "perfume_variants" };
const film = { column: "work_id", table: "film_details" };
const painting = { column: "work_id", table: "painting_details" };
const object = { column: "object_id", table: "art_objects" };

const entityOwners = [
  { column: "person_id", table: "authors" },
  { column: "organization_id", table: "publishing_houses" },
  { column: "venue_id", table: "venues" },
] as const;

const vocabulary = (table: PgTable, label: string, natural: readonly string[] = ["slug"], create = true): EntitySpec => ({
  table,
  mode: "entity",
  natural,
  create,
  label,
});
const entity = (table: PgTable, label: string): EntitySpec => ({ table, mode: "entity", create: true, label });

const SPECS: TableSpec[] = [
  // Vocabularies, matched by natural key
  vocabulary(s.countries, "country", ["alpha_2"], false),
  vocabulary(s.languages, "language", ["name"], false),
  vocabulary(s.creditRoles, "credit role", ["id"], false),
  vocabulary(s.contributionTypes, "contribution type"),
  vocabulary(s.taxonomyFamilies, "taxonomy family", ["slug"], false),
  vocabulary(s.customTaxonomyItems, "taxonomy item", ["family_id", "slug"]),
  vocabulary(s.subjects, "subject"),
  vocabulary(s.genres, "genre"),
  vocabulary(s.tags, "tag", ["name"]),
  vocabulary(s.themes, "theme"),
  vocabulary(s.keywords, "keyword"),
  vocabulary(s.bookCategories, "category"),
  vocabulary(s.attributes, "attribute"),
  vocabulary(s.literaryMovements, "literary movement"),
  vocabulary(s.artTypes, "art type"),
  vocabulary(s.artMovements, "art movement"),
  vocabulary(s.workTypes, "work type"),
  vocabulary(s.publisherSpecialties, "publisher specialty"),

  // Shared records, matched by id
  entity(s.places, "place"),
  entity(s.locations, "storage location"),
  { table: s.subLocations, mode: "entity", create: true, label: "storage place" },
  entity(s.series, "series"),
  entity(s.recommenders, "recommender"),
  entity(s.collections, "collection"),
  entity(s.publishingHouses, "organization"),
  { table: s.organizationRoles, mode: "part", parent: { column: "organization_id", table: "publishing_houses" }, forExisting: true },
  { table: s.publisherAliases, mode: "part", parent: { column: "publisher_id", table: "publishing_houses" } },
  { table: s.publishingHouseSpecialties, mode: "part", parent: { column: "publishing_house_id", table: "publishing_houses" } },
  { table: s.publisherIsbnPrefixes, mode: "part", parent: { column: "publisher_id", table: "publishing_houses" } },
  entity(s.authors, "person"),
  // A new person is a book person until told otherwise (legacy_author_domain)
  { table: s.personDomains, mode: "part", parent: { column: "person_id", table: "authors" }, forExisting: true, exact: true },
  { table: s.personAliases, mode: "part", parent: { column: "person_id", table: "authors" } },
  entity(s.venues, "venue"),
  { table: s.organizationVenues, mode: "part", parent: { column: "organization_id", table: "publishing_houses" } },

  // Records
  { table: s.catalogueDates, mode: "record", section: "dates", referenced: true },
  { table: s.works, mode: "record", section: "identity" },
  { table: s.editions, mode: "record", section: "realizations", domains: BOOK, parent: work },
  { table: s.catalogueIdentifiers, mode: "record", section: "sources", parent: work, alsoParent: edition, referenced: true, entityOwners },
  { table: s.sourceRecords, mode: "record", section: "sources", parent: work, alsoParent: edition, referenced: true, entityOwners },
  { table: s.workAuthors, mode: "record", section: "credits", domains: BOOK, parent: work },
  { table: s.editionContributors, mode: "record", section: "credits", domains: BOOK, parent: edition },
  { table: s.editionPublishers, mode: "record", section: "realizations", domains: BOOK, parent: edition },
  { table: s.instances, mode: "record", section: "holdings", domains: BOOK, parent: edition },
  { table: s.instanceStatusHistory, mode: "record", section: "history", domains: BOOK, parent: { column: "instance_id", table: "instances" } },
  { table: s.workStatusHistory, mode: "record", section: "history", parent: work },
  { table: s.workSubjects, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workThemes, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workKeywords, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workCategories, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workAttributes, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workLiteraryMovements, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workArtTypes, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.workArtMovements, mode: "record", section: "taxonomy", domains: BOOK, parent: work },
  { table: s.editionGenres, mode: "record", section: "taxonomy", domains: BOOK, parent: edition },
  { table: s.editionTags, mode: "record", section: "taxonomy", domains: BOOK, parent: edition },
  { table: s.customTaxonomyItemEditions, mode: "record", section: "taxonomy", domains: BOOK, parent: edition },
  { table: s.customTaxonomyItemWorks, mode: "record", section: "taxonomy", parent: work },
  { table: s.workCredits, mode: "record", section: "credits", parent: work },
  { table: s.workRecommenders, mode: "record", section: "curation", parent: work },

  { table: s.perfumeDetails, mode: "record", section: "identity", domains: ["perfume"], parent: work },
  { table: s.perfumeOrganizations, mode: "record", section: "credits", domains: ["perfume"], parent: perfume },
  { table: s.perfumeNotes, mode: "record", section: "taxonomy", domains: ["perfume"], parent: perfume },
  { table: s.perfumeVariants, mode: "record", section: "realizations", domains: ["perfume"], parent: perfume },
  { table: s.perfumeVariantPerfumers, mode: "record", section: "credits", domains: ["perfume"], parent: variant },
  { table: s.perfumeVariantOverrides, mode: "record", section: "realizations", domains: ["perfume"], parent: variant },
  { table: s.perfumeVariantTaxa, mode: "record", section: "taxonomy", domains: ["perfume"], parent: variant },
  { table: s.perfumeVariantNotes, mode: "record", section: "taxonomy", domains: ["perfume"], parent: variant },
  { table: s.perfumeBottles, mode: "record", section: "holdings", domains: ["perfume"], parent: variant },
  { table: s.perfumeRetailerLinks, mode: "record", section: "retail", domains: ["perfume"], parent: perfume },
  {
    table: s.perfumeRetailerObservations,
    mode: "record",
    section: "retail",
    domains: ["perfume"],
    parent: { column: "link_id", table: "perfume_retailer_links" },
  },

  { table: s.filmDetails, mode: "record", section: "identity", domains: ["film"], parent: work },
  { table: s.filmCountries, mode: "record", section: "identity", domains: ["film"], parent: film },
  { table: s.filmLanguages, mode: "record", section: "identity", domains: ["film"], parent: film },
  { table: s.filmOrganizations, mode: "record", section: "credits", domains: ["film"], parent: film },
  { table: s.filmVersions, mode: "record", section: "realizations", domains: ["film"], parent: film },
  {
    table: s.filmReleases,
    mode: "record",
    section: "realizations",
    domains: ["film"],
    parent: { column: "version_id", table: "film_versions" },
  },
  { table: s.filmHoldings, mode: "record", section: "holdings", domains: ["film"], parent: film },

  { table: s.paintingDetails, mode: "record", section: "identity", domains: ["painting"], parent: work },
  { table: s.artObjects, mode: "record", section: "realizations", domains: ["painting"], parent: painting },
  { table: s.artObjectCredits, mode: "record", section: "credits", domains: ["painting"], parent: object },
  { table: s.artObjectTaxa, mode: "record", section: "taxonomy", domains: ["painting"], parent: object },
  { table: s.artObjectWhereabouts, mode: "record", section: "history", domains: ["painting"], parent: object },

  // Membership and links last: they point at records and shared rows alike
  { table: s.collectionWorks, mode: "record", section: "collections", parent: work },
  { table: s.collectionEditions, mode: "record", section: "collections", domains: BOOK, parent: edition },
  { table: s.workRelations, mode: "record", section: "relations", parent: { column: "from_work_id", table: "works" } },
];

export interface Table {
  spec: TableSpec;
  shape: TableShape;
  /** Its place in write order */
  order: number;
}

/** Every table of the format by name, built once */
export const TABLES: ReadonlyMap<string, Table> = new Map(
  SPECS.map((spec, order) => {
    const shape = tableShape(spec.table);
    return [shape.name, { spec, shape, order }];
  }),
);

export function table(name: string): Table {
  const found = TABLES.get(name);
  if (!found) throw new Error(`${name} is not part of the interchange format`);
  return found;
}

export const RECORD_TABLES = [...TABLES.values()].filter((t) => t.spec.mode === "record");
export const SHARED_TABLES = [...TABLES.values()].filter((t) => t.spec.mode !== "record");

/** Whether a collection's records may carry this table */
export function carries(t: Table, domain: WorkKind) {
  return t.spec.mode === "record" && (!t.spec.domains || t.spec.domains.includes(domain));
}

/**
 * The person, organization or venue that owns a row of an identifier or
 * source table, when no work or edition does. Null for a row of a work or an
 * edition, and for a row with no owner or more than one.
 */
export function entityOwner(t: Table, row: Record<string, unknown>): { column: string; table: string } | null {
  if (t.spec.mode !== "record" || !t.spec.entityOwners) return null;
  const set = (column: string | undefined) => !!column && row[column] !== null && row[column] !== undefined;
  if (set(t.spec.parent?.column) || set(t.spec.alsoParent?.column)) return null;
  const owners = t.spec.entityOwners.filter((owner) => set(owner.column));
  return owners.length === 1 ? owners[0] : null;
}

/**
 * The single-column foreign keys of a table: column to table. The kind
 * columns of composite keys are checked by the database.
 */
export function references(t: Table) {
  return t.shape.foreignKeys.map((fk) => ({ column: fk.columns[0], table: fk.table }));
}
