import { BOOK_EXPORT_COLUMNS, PEOPLE_EXPORT_COLUMNS, FILM_EXPORT_COLUMNS, PERFUME_EXPORT_COLUMNS, PAINTING_EXPORT_COLUMNS, NOTE_EXPORT_COLUMNS, READING_EXPORT_COLUMNS, SESSION_EXPORT_COLUMNS } from "./columns";
export { BOOK_EXPORT_COLUMNS, PEOPLE_EXPORT_COLUMNS, FILM_EXPORT_COLUMNS, PERFUME_EXPORT_COLUMNS, PAINTING_EXPORT_COLUMNS } from "./columns";

export type NativeField = Readonly<
  | { kind: "text" | "int32" | "int64" | "double" | "boolean" | "date" | "instant"; nullable: boolean }
  | { kind: "list"; nullable: boolean; element: NativeField }
  | { kind: "struct"; nullable: boolean; fields: Readonly<Record<string, NativeField>> }
>;
export interface ExportDefinition {
  readonly entity: string;
  readonly version: number;
  readonly legacyHeaders: readonly string[];
  readonly fields: Readonly<Record<string, NativeField>>;
}
const scalar = (kind: "text" | "int32" | "int64" | "double" | "boolean" | "date" | "instant", nullable = true): NativeField => ({ kind, nullable });
export const text = (nullable = true) => scalar("text", nullable);
const integer = (nullable = true) => scalar("int64", nullable);
const year = () => scalar("int32");
const number = () => scalar("double");
const boolean = (nullable = true) => scalar("boolean", nullable);
const list = (element: NativeField = text(false)): NativeField => ({ kind: "list", nullable: true, element });
const struct = (fields: Record<string, NativeField>, nullable = true): NativeField => ({ kind: "struct", nullable, fields });
const point = () => struct({ year: scalar("int32", false), month: year(), day: year() });
export const CATALOGUE_DATE = struct({ precision: text(false), start: point(), end: point(), approximate: boolean(false), label: text() });

const target = struct({
  id: text(false), workId: text(false), editionId: text(), publisherId: text(), perfumeVariantId: text(), perfumeContainer: text(),
  perfumeCapacityValue: number(), perfumeVolumeUnit: text(), filmVersionId: text(), filmReleaseId: text(), filmMedium: text(),
  filmFormatLabel: text(), artObjectId: text(), artReproducesObjectId: text(), isCancelled: boolean(false),
  createdAt: scalar("instant", false), state: text(false), fulfilled_instance_id: text(),
}, false);
const publisher = struct({ id: text(false), name: text(false), kind: text(), parent_id: text() }, false);
const editionPublishers = struct({ edition_id: text(false), isbn_13: text(), publishers: list(publisher) }, false);

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function definition(entity: string, headers: readonly string[], overrides: Record<string, NativeField>): ExportDefinition {
  const fields = Object.fromEntries(headers.map((key) => [key, overrides[key] ?? text()]));
  for (const [key, value] of Object.entries(overrides)) if (!(key in fields)) fields[key] = value;
  return freeze({ entity, version: 2, legacyHeaders: [...headers], fields });
}
const lists = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, list()]));
const integers = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, integer()]));
const years = (...keys: string[]) => Object.fromEntries(keys.map((key) => [key, year()]));

/** Complete ordered contracts, independent of row count, values or row order. */
export const NATIVE_EXPORTS = freeze({
  works: definition("books", BOOK_EXPORT_COLUMNS, {
    title: text(false), ...lists("ebook_formats", "authors"), ...years("original_year", "publication_year"),
    ...integers("page_count", "edition_count", "instance_count"), catalogue_status: text(false), acquisition_priority: text(false), edition_count: integer(false), instance_count: integer(false), rating: number(), is_anthology: boolean(false),
    acquisition_targets: list(target), edition_publishers: list(editionPublishers),
  }),
  authors: definition("people", PEOPLE_EXPORT_COLUMNS, {
    name: text(false), roles: list(), ...years("birth_year", "birth_month", "birth_day", "death_year", "death_month", "death_day"), works_count: integer(false),
    birth_date: CATALOGUE_DATE, death_date: CATALOGUE_DATE, birth_year_gregorian: year(), death_year_gregorian: year(),
    birth_year_is_approximate: boolean(false), death_year_is_approximate: boolean(false),
  }),
  films: definition("films", FILM_EXPORT_COLUMNS, {
    title: text(false), ...lists("directors", "writers", "cast", "countries", "languages", "genres"), released: CATALOGUE_DATE,
    physical_copies: integer(false), digital_copies: integer(false), rating: number(), favourite: boolean(false), runtime_seconds: integer(),
  }),
  perfumes: definition("perfumes", PERFUME_EXPORT_COLUMNS, {
    title: text(false), ...lists("houses", "manufacturers", "perfumers", "families", "accords", "top_notes", "heart_notes", "base_notes", "other_notes"),
    released: CATALOGUE_DATE, concentrations: list(struct({ concentration: text(), concentration_label: text() }, false)),
    bottles: integer(false), samples: integer(false), decants: integer(false), rating: number(), favourite: boolean(false),
  }),
  paintings: definition("paintings", PAINTING_EXPORT_COLUMNS, {
    title: text(false), ...lists("painters", "movements", "genres", "techniques", "media", "supports"), painted: CATALOGUE_DATE,
    height_cm: number(), width_cm: number(), objects_owned: integer(false), rating: number(), favourite: boolean(false),
  }),
  readings: definition("readings", READING_EXPORT_COLUMNS, {
    reading_id: text(false), work_id: text(false), title: text(false), status: text(false), format: text(false), unit: text(false),
    started_precision: text(false), finished_precision: text(false), source_key: text(false),
    ...integers("total_pages", "total_minutes", "start_page", "current_page", "current_minutes", "session_count", "minutes_read", "pages_read"),
    session_count: integer(false), minutes_read: integer(false), pages_read: integer(false), current_percent: number(), rating: number(), ...lists("authors", "translators"), started_on: CATALOGUE_DATE, finished_on: CATALOGUE_DATE,
  }),
  "reading-sessions": definition("reading-sessions", SESSION_EXPORT_COLUMNS, {
    session_id: text(false), reading_id: text(false), work_title: text(false), time_zone: text(false), format: text(false), source: text(false),
    day: scalar("date", false), started_at: scalar("instant"), ended_at: scalar("instant"),
    ...integers("duration_seconds", "start_page", "end_page", "start_minutes", "end_minutes", "pages_counted"), pages_counted: integer(false), start_percent: number(), end_percent: number(),
  }),
  "reading-notes": definition("reading-notes", NOTE_EXPORT_COLUMNS, {
    note_id: text(false), work_id: text(false), title: text(false), kind: text(false), body: text(false), source: text(false),
    ...integers("page", "end_page"), percent: number(), favourite: boolean(false), page_roman: boolean(false),
    ...lists("authors", "translators"), created_at: scalar("instant", false),
  }),
});
export type NativeEntity = keyof typeof NATIVE_EXPORTS;

/** Explicit projection prevents raw SQL sidecars from becoming public columns. */
export function nativeProjection(entity: NativeEntity, legacy: Record<string, unknown>, values: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.keys(NATIVE_EXPORTS[entity].fields).map((key) => [key, Object.hasOwn(values, key) ? values[key] : legacy[key]]));
}
