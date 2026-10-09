import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import { isDeliverable } from "../delivery/files";
import { isReadableFormat } from "../formats";
import { medallionOf } from "../medallion";
import { parseStageKey, coverKeySha256 } from "../keys";
import { indexCatalogue, type MatchCatalogue } from "./catalogue";
import { digitalLocationAllowed } from "./location-policy";
import { matchFingerprint } from "./keys";
import type { MatchAuthor, MatchEbook, MatchEdition, MatchWork } from "./types";

/** Some tables have composite keys or a boolean settings key. */
export type StoredRow = Record<string, unknown>;
function storedId(row: StoredRow): string {
  if (typeof row.id !== "string" || !row.id)
    throw new Error("Expected a stored row with a string id");
  return row.id;
}
export const MATCH_TABLES = [
  "works",
  "editions",
  "authors",
  "person_aliases",
  "work_authors",
  "catalogue_identifiers",
  "series",
  "instances",
  "app_settings",
  "locations",
  "ebooks",
  "ebook_files",
  "ebook_match_candidates",
] as const;
export type MatchTable = (typeof MATCH_TABLES)[number];
export interface LoadedMatchCatalogue {
  catalogue: MatchCatalogue;
  rows: Record<MatchTable, readonly StoredRow[]>;
  catalogueFingerprint: string;
  inputFingerprint: string;
}
export const dataFingerprint = (value: unknown) =>
  createHash("sha256").update(stableStringify(value)).digest("hex");
const stringOrNull = (value: unknown) =>
  typeof value === "string" ? value : null;
const numberOrNull = (value: unknown) => (value == null ? null : Number(value));
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
function addId(
  ids: Record<string, string[]>,
  provider: string,
  value: unknown,
) {
  if (typeof value === "string" && value.trim())
    ids[provider] = [...(ids[provider] ?? []), value.trim()];
}
function externalIds(
  row: StoredRow,
  provenance: readonly StoredRow[],
  owner: "work_id" | "edition_id",
) {
  const ids: Record<string, string[]> = {};
  for (const [field, provider] of [
    ["asin", "asin"],
    ["google_books_id", "google"],
    ["goodreads_id", "goodreads"],
    ["open_library_key", "openlibrary"],
    ["oclc", "oclc"],
  ])
    addId(ids, provider, row[field]);
  for (const observation of provenance.filter((id) => id[owner] === row.id))
    addId(ids, String(observation.provider), observation.external_id);
  return ids;
}
function fileDto(row: StoredRow) {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const file = {
    id: storedId(row),
    ebookId: String(row.ebook_id),
    sha256: String(row.sha256),
    s3Key: String(row.s3_key),
    format: String(row.format),
    sizeBytes: Number(row.size_bytes),
    contentType: String(row.content_type),
    status: String(row.status),
    drm: stringOrNull(row.drm),
    metadata,
  };
  const deliverable = isDeliverable(file);
  const stages = medallionOf(metadata);
  const native =
    deliverable &&
    isReadableFormat(file.format) &&
    (!parseStageKey(file.s3Key) || !!stages?.validation.nativeReadable);
  const cover = stringOrNull(row.cover_key);
  const parsed = cover ? parseStageKey(cover) : null;
  const validCover =
    deliverable &&
    cover &&
    (parsed
      ? parsed.stage === "gold" &&
        parsed.kind === "derived" &&
        parsed.name === "cover-800.webp" &&
        parsed.sha256 === file.sha256 &&
        parsed.reportHash === stages?.silver.sha256 &&
        !!stages?.gold.some(
          (object) =>
            object.key === cover && object.contentType.startsWith("image/"),
        )
      : coverKeySha256(cover) === file.sha256);
  return {
    id: file.id,
    sha256: file.sha256,
    format: file.format,
    sizeBytes: file.sizeBytes,
    status: file.status,
    drm: file.drm,
    availability: !deliverable
      ? ("blocked" as const)
      : native
        ? ("native" as const)
        : ("download" as const),
    textLanguage: stringOrNull(row.text_language),
    coverKey: validCover ? cover : null,
  };
}
/** Explicit connection only. Await every table read in the protected callback.
 * Raw JSON rows preserve full values/timestamps for later transaction guards. */
export async function loadMatchCatalogue(
  conn: Db,
): Promise<LoadedMatchCatalogue> {
  const rows = {} as Record<MatchTable, StoredRow[]>;
  for (const table of MATCH_TABLES) {
    rows[table] = resultRows<{ row: StoredRow }>(
      await conn.execute(
        sql`select to_jsonb(r) as row from ${sql.identifier(table)} r order by to_jsonb(r)::text`,
      ),
    ).map(({ row }) => row);
  }
  const authors: MatchAuthor[] = rows.authors.map((row) => ({
    id: storedId(row),
    name: String(row.name),
    sortName: stringOrNull(row.sort_name),
    realName: stringOrNull(row.real_name),
    firstName: stringOrNull(row.first_name),
    lastName: stringOrNull(row.last_name),
    aliases: rows.person_aliases
      .filter((alias) => alias.person_id === row.id)
      .map((alias) => String(alias.name)),
  }));
  const authorMap = new Map(authors.map((author) => [author.id, author]));
  const ebooks: MatchEbook[] = rows.ebooks.map((row) => ({
    id: storedId(row),
    title: String(row.title),
    subtitle: stringOrNull(row.subtitle),
    authors: strings(row.authors),
    language: stringOrNull(row.language),
    isbns: strings(row.isbns),
    identifiers: (row.identifiers ?? {}) as Record<string, string[]>,
    series: stringOrNull(row.series),
    seriesIndex: numberOrNull(row.series_index),
    publisher: stringOrNull(row.publisher),
    publishedYear: numberOrNull(row.published_year),
    coverKey: stringOrNull(row.cover_key),
    preferredFileId: stringOrNull(row.preferred_file_id),
    files: rows.ebook_files
      .filter((file) => file.ebook_id === row.id)
      .map(fileDto),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    instanceId: stringOrNull(row.instance_id),
    matchState: row.match_state as MatchEbook["matchState"],
    matchFingerprint: stringOrNull(row.match_fingerprint),
    exclusionReason: row.exclusion_reason as MatchEbook["exclusionReason"],
  }));
  const works: MatchWork[] = rows.works
    .filter((row) => row.kind === "book")
    .map((row) => {
      const editions: MatchEdition[] = rows.editions
        .filter((edition) => edition.work_id === row.id)
        .map((edition) => ({
          id: storedId(edition),
          workId: storedId(row),
          title: String(edition.title),
          subtitle: stringOrNull(edition.subtitle),
          language: stringOrNull(edition.language),
          isbn13: stringOrNull(edition.isbn_13),
          isbn10: stringOrNull(edition.isbn_10),
          identifiers: externalIds(
            edition,
            rows.catalogue_identifiers,
            "edition_id",
          ),
          metadataSource: stringOrNull(edition.metadata_source),
          metadataLocked: edition.metadata_locked === true,
          updatedAt: String(edition.updated_at),
        }));
      const editionIds = new Set(editions.map((edition) => edition.id));
      const linked = new Map(
        ebooks
          .filter((ebook) => ebook.instanceId)
          .map((ebook) => [ebook.instanceId, ebook.id]),
      );
      return {
        id: storedId(row),
        kind: "book",
        title: String(row.title),
        originalTitle: stringOrNull(row.original_title),
        originalLanguage: stringOrNull(row.original_language),
        originalYear: numberOrNull(row.original_year),
        catalogueStatus: String(row.catalogue_status),
        authors: rows.work_authors
          .filter(
            (credit) =>
              credit.work_id === row.id &&
              ["author", "co_author"].includes(String(credit.role)),
          )
          .map((credit) => authorMap.get(String(credit.author_id))!)
          .filter(Boolean),
        identifiers: externalIds(row, rows.catalogue_identifiers, "work_id"),
        editions,
        copies: rows.instances
          .filter((copy) => editionIds.has(String(copy.edition_id)))
          .map((copy) => ({
            id: storedId(copy),
            editionId: String(copy.edition_id),
            locationId: String(copy.location_id),
            status: String(copy.status),
            linkedEbookId: linked.get(storedId(copy)) ?? null,
            updatedAt: String(copy.updated_at),
          })),
        series: [
          stringOrNull(row.series_name),
          stringOrNull(
            rows.series.find((series) => series.id === row.series_id)?.title,
          ),
        ].filter((s): s is string => !!s),
        seriesPosition: stringOrNull(row.series_position),
        updatedAt: String(row.updated_at),
      };
    });
  const configuredId = stringOrNull(rows.app_settings[0]?.ebook_location_id);
  const location = rows.locations.find((row) => row.id === configuredId);
  const ebookLocationId = digitalLocationAllowed(
    location
      ? {
          id: storedId(location),
          type: String(location.type),
          isActive: location.is_active === true,
        }
      : undefined,
    configuredId,
  )
    ? configuredId
    : null;
  const catalogue = indexCatalogue({ works, ebooks, authors, ebookLocationId });
  return {
    catalogue,
    rows,
    catalogueFingerprint: dataFingerprint({
      works: catalogue.source.works,
      authors: catalogue.source.authors,
      locations: rows.locations,
      settings: rows.app_settings,
    }),
    inputFingerprint: dataFingerprint(
      ebooks.sort(byId).map((ebook) => [ebook.id, matchFingerprint(ebook)]),
    ),
  };
}
