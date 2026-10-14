import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/catalogue/work-store";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import {
  isEbookFileDownloadableWithPrefix,
  isEbookFileNativeReadableWithPrefix,
} from "../conditions";
import { acceptedPublication } from "../publication-evidence";
import { parseStageKey, coverKeySha256, ebooksPrefix } from "../keys";
import { indexCatalogue, type MatchCatalogue } from "./catalogue";
import { digitalLocationAllowed } from "./location-policy";
import { matchFingerprint } from "./keys";
import { sealParsedJson } from "./writer-input";
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
/** Rows by one column's value, each group in table order. */
function groupBy(rows: readonly StoredRow[], column: string) {
  const groups = new Map<unknown, StoredRow[]>();
  for (const row of rows) {
    const group = groups.get(row[column]);
    if (group) group.push(row);
    else groups.set(row[column], [row]);
  }
  return groups;
}
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
/** `prefix` is EBOOKS_PREFIX when the caller has read it already. */
export function matchFileFromStoredRow(row: StoredRow, prefix?: string) {
  const metadata = row.metadata;
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
    manifestKey: stringOrNull(row.manifest_key),
  };
  const deliverable = isEbookFileDownloadableWithPrefix(file, prefix);
  const stages = acceptedPublication(metadata, file);
  const native = isEbookFileNativeReadableWithPrefix(file, prefix);
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
      : coverKeySha256(cover, prefix) === file.sha256);
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
/** A table's hash: its rows as the database's JSON text, sorted as the
 * database sorts them, one per line. */
const sha256Hex = (text: string) => createHash("sha256").update(text).digest("hex");
export const tableDigestSql = (table: string) =>
  sql`(select encode(sha256(convert_to(coalesce(string_agg(x.s, chr(10) order by x.s), ''), 'UTF8')), 'hex')
    from (select to_jsonb(r)::text s from ${sql.identifier(table)} r) x)`;
/** The hash of each table as read, by the frozen rows it read. A writer's
 * guard has the database compare it under lock, rather than sending 30 MB of
 * rows back on 6,000 eBooks (SLN-691). */
const readDigests = new WeakMap<readonly StoredRow[], string>();
export const storedTableDigest = (rows: readonly StoredRow[] | undefined) =>
  rows ? readDigests.get(rows) : undefined;
/** The matching tables' raw JSON rows alone, in the order the transaction
 * guards compare them, without indexing a catalogue. */
export async function loadMatchRows(
  conn: Db,
  bounds?: { maxRowsPerTable: number; maxSnapshotBytes: number },
): Promise<Record<MatchTable, readonly StoredRow[]>> {
  let loadedBytes = 0;
  const rows = {} as Record<MatchTable, StoredRow[]>;
  for (const table of MATCH_TABLES) {
    const texts = resultRows<{ s: string }>(
      await conn.execute(
        sql`select to_jsonb(r)::text as s from ${sql.identifier(table)} r order by s
          ${bounds ? sql`limit ${bounds.maxRowsPerTable + 1}` : sql``}`,
      ),
    ).map(({ s }) => s);
    // Sealed as read: a plan's writer input then shares them, not a copy
    rows[table] = sealParsedJson(texts.map((text) => JSON.parse(text) as StoredRow));
    readDigests.set(rows[table], sha256Hex(texts.join("\n")));
    if (bounds) {
      loadedBytes += Buffer.byteLength(JSON.stringify(rows[table]), "utf8");
      if (rows[table].length > bounds.maxRowsPerTable || loadedBytes > bounds.maxSnapshotBytes)
        throw new Error("Matching snapshot changed beyond the post-create bound");
    }
  }
  return rows;
}
/** Explicit connection only. Await every table read in the protected callback.
 * Raw JSON rows preserve full values/timestamps for later transaction guards. */
export async function loadMatchCatalogue(
  conn: Db,
  bounds?: { maxRowsPerTable: number; maxSnapshotBytes: number },
): Promise<LoadedMatchCatalogue> {
  if (bounds && (!Number.isSafeInteger(bounds.maxRowsPerTable) || bounds.maxRowsPerTable < 1 ||
      bounds.maxRowsPerTable > 10000 || !Number.isSafeInteger(bounds.maxSnapshotBytes) ||
      bounds.maxSnapshotBytes < 1 || bounds.maxSnapshotBytes > 64 * 1024 * 1024))
    throw new Error("Invalid bounded matching snapshot limits");
  if (bounds) {
    let bytes = 0;
    for (const table of MATCH_TABLES) {
      const [size] = resultRows<{ count: number; bytes: number }>(await conn.execute(sql`
        select count(*)::int count, coalesce(sum(octet_length(to_jsonb(r)::text)), 0)::bigint bytes
        from (select * from ${sql.identifier(table)} limit ${bounds.maxRowsPerTable + 1}) r`));
      if (!size || Number(size.count) > bounds.maxRowsPerTable ||
          !Number.isSafeInteger(Number(size.bytes)) || Number(size.bytes) < 0)
        throw new Error("Matching snapshot exceeds the post-create row bound");
      bytes += Number(size.bytes);
      if (bytes > bounds.maxSnapshotBytes)
        throw new Error("Matching snapshot exceeds the post-create byte bound");
    }
  }
  const rows = await loadMatchRows(conn, bounds);
  // One pass per table: filtering every child table for each parent row was
  // quadratic, about 3 s of each review decision on 6,000 eBooks (SLN-691)
  const aliasesByPerson = groupBy(rows.person_aliases, "person_id");
  const filesByEbook = groupBy(rows.ebook_files, "ebook_id");
  // Validating the environment for each file's legacy key was about 1.4 s of
  // each read on 6,000 eBooks; an invalid one still blocks every file
  let prefix: string | undefined;
  try { prefix = ebooksPrefix(); } catch { prefix = undefined; }
  const editionsByWork = groupBy(rows.editions, "work_id");
  const creditsByWork = groupBy(rows.work_authors, "work_id");
  // A work's copies keep the instances table's order, as the filter did
  const workOfEdition = new Map(rows.editions.map((edition) => [String(edition.id), edition.work_id]));
  const copiesByWork = new Map<unknown, StoredRow[]>();
  for (const copy of rows.instances) {
    if (!workOfEdition.has(String(copy.edition_id))) continue;
    const work = workOfEdition.get(String(copy.edition_id));
    const group = copiesByWork.get(work);
    if (group) group.push(copy);
    else copiesByWork.set(work, [copy]);
  }
  const seriesById = new Map(rows.series.map((series) => [series.id, series]));
  const identifiersByEdition = groupBy(rows.catalogue_identifiers, "edition_id");
  const identifiersByWork = groupBy(rows.catalogue_identifiers, "work_id");
  const authors: MatchAuthor[] = rows.authors.map((row) => ({
    id: storedId(row),
    name: String(row.name),
    sortName: stringOrNull(row.sort_name),
    realName: stringOrNull(row.real_name),
    firstName: stringOrNull(row.first_name),
    lastName: stringOrNull(row.last_name),
    aliases: (aliasesByPerson.get(row.id) ?? []).map((alias) => String(alias.name)),
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
    files: (filesByEbook.get(row.id) ?? []).map((file) => matchFileFromStoredRow(file, prefix)),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    instanceId: stringOrNull(row.instance_id),
    matchState: row.match_state as MatchEbook["matchState"],
    matchFingerprint: stringOrNull(row.match_fingerprint),
    exclusionReason: row.exclusion_reason as MatchEbook["exclusionReason"],
  }));
  const linked = new Map(
    ebooks
      .filter((ebook) => ebook.instanceId)
      .map((ebook) => [ebook.instanceId, ebook.id]),
  );
  const works: MatchWork[] = rows.works
    .filter((row) => row.kind === "book")
    .map((row) => {
      const editions: MatchEdition[] = (editionsByWork.get(row.id) ?? [])
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
            identifiersByEdition.get(edition.id) ?? [],
            "edition_id",
          ),
          metadataSource: stringOrNull(edition.metadata_source),
          metadataLocked: edition.metadata_locked === true,
          updatedAt: String(edition.updated_at),
        }));
      return {
        id: storedId(row),
        kind: "book",
        title: String(row.title),
        originalTitle: stringOrNull(row.original_title),
        originalLanguage: stringOrNull(row.original_language),
        originalYear: numberOrNull(row.original_year),
        catalogueStatus: String(row.catalogue_status),
        authors: (creditsByWork.get(row.id) ?? [])
          .filter((credit) => ["author", "co_author"].includes(String(credit.role)))
          .map((credit) => authorMap.get(String(credit.author_id))!)
          .filter(Boolean),
        identifiers: externalIds(row, identifiersByWork.get(row.id) ?? [], "work_id"),
        editions,
        copies: (copiesByWork.get(row.id) ?? [])
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
            seriesById.get(row.series_id)?.title,
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
  const catalogue = indexCatalogue({
    works,
    ebooks,
    authors,
    ebookLocationId,
    digitalLocationIds: rows.locations
      .filter(
        (location) =>
          location.type === "digital" && location.is_active === true,
      )
      .map(storedId),
  });
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
