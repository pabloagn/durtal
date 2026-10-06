import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, desc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { atomicOn } from "@/lib/db/atomic";
import type { Db } from "@/lib/catalogue/work-store";
import { editions, sourceRecords } from "@/lib/db/schema";
import { requireBookWork } from "@/lib/catalogue/book-boundary";
import { providerSchema, sourceUrlSchema } from "@/lib/catalogue/provenance";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";
import { evidenceRawKey, evidenceTextKey } from "@/lib/s3/keys";
import type { EvidenceObjects } from "@/lib/s3/evidence-objects";
import { EvidenceFetchError, type FetchedPage } from "@/lib/net/safe-fetch-page";
import { canonicalEvidenceUrl } from "./evidence-url";
import { fingerprint } from "./fingerprint";
import {
  EVIDENCE_KINDS,
  evidencePagePayloadSchema,
  evidenceTextPayloadSchema,
  type EvidencePagePayload,
} from "./evidence-payload";

/**
 * The evidence store (SLN-468): a fetched page or a search snippet, kept as
 * a private copy in S3 under its content hash, and one `source_records` row
 * per document and owner. The stored text is the extractor's main text in
 * Unicode NFC, nothing else changed (R3): the research agent quotes from it
 * and every read checks its hash. No page text goes into the database (R10).
 */

export const FETCHER_VERSION = "sln468.1";

export type EvidenceOwner = { kind: "book"; workId: string } | { kind: "edition"; editionId: string };

/** What a main-text extractor returns for one page */
export interface ExtractedPage {
  /** The main text, paragraphs joined by a blank line */
  text: string;
  title: string | null;
  byline: string | null;
  publishedOn: string | null;
  language: string | null;
  canonicalUrl: string | null;
}
export interface MainTextExtractor {
  name: string;
  version: string;
  extract: (html: string, url: string) => ExtractedPage | null;
}

export type StoredEvidence = typeof sourceRecords.$inferSelect;

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const isEvidence = inArray(sql<string>`${sourceRecords.payload} ->> 'kind'`, [...EVIDENCE_KINDS]);

/** The owner's columns, once the owner is checked to be a book or a book's edition */
async function ownerColumns(database: Db, owner: EvidenceOwner) {
  if (owner.kind === "book") await requireBookWork(owner.workId, database);
  else {
    const [edition] = await database.select({ workId: editions.workId }).from(editions).where(eq(editions.id, owner.editionId));
    if (!edition) throw new Error("Book not found: this action only accepts existing books");
    await requireBookWork(edition.workId, database);
  }
  return owner.kind === "book"
    ? { entityKind: "book" as const, workId: owner.workId, editionId: null }
    : { entityKind: "edition" as const, workId: null, editionId: owner.editionId };
}

const ownerWhere = (owner: EvidenceOwner) =>
  owner.kind === "book" ? eq(sourceRecords.workId, owner.workId) : eq(sourceRecords.editionId, owner.editionId);

/** Insert one evidence row; the payload is checked and hashed as source records require */
async function insertEvidence(
  database: Db,
  owner: EvidenceOwner,
  row: { provider: string; url: string | null; attribution: string; retrievedAt: Date; payload: Record<string, unknown>; supersedesId: string | null },
): Promise<StoredEvidence> {
  providerSchema.parse(row.provider);
  if (row.url) sourceUrlSchema.parse(row.url);
  const columns = await ownerColumns(database, owner);
  const json = JSON.stringify(row.payload);
  if (Buffer.byteLength(json, "utf8") > 1_000_000) throw new Error("A source observation must be at most 1 MB");
  const [inserted] = (await atomicOn(database, (d) => [
      d
        .insert(sourceRecords)
        .values({
          ...columns,
          provider: row.provider,
          url: row.url,
          attribution: row.attribution,
          retrievedAt: row.retrievedAt,
          verifiedAt: row.retrievedAt,
          reviewStatus: "accepted",
          payload: row.payload,
          payloadHash: sourcePayloadHash(row.payload),
          supersedesId: row.supersedesId,
        })
        .returning(),
  ])) as StoredEvidence[][];
  return inserted[0];
}

/** Store the text under its hash; the stored text is NFC */
async function storeText(objects: EvidenceObjects, text: string) {
  const stored = text.normalize("NFC");
  const bytes = Buffer.from(stored, "utf8");
  const textSha256 = sha256(bytes);
  const textKey = evidenceTextKey(textSha256);
  await objects.putIfMissing(textKey, bytes, "text/plain; charset=utf-8");
  return { stored, textSha256, textKey, textChars: [...stored].length, textBytes: bytes.length };
}

/** The newest stored page of a URL, for any owner: by its canonical form or as it was requested */
export async function findStoredPage(database: Db, url: string): Promise<StoredEvidence | null> {
  const [stored] = await database
    .select()
    .from(sourceRecords)
    .where(
      and(
        isEvidence,
        sql`${sourceRecords.payload} ->> 'kind' = 'evidence_page'`,
        or(eq(sourceRecords.url, canonicalEvidenceUrl(url)), sql`${sourceRecords.payload} ->> 'requestedUrl' = ${url}`),
      ),
    )
    .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id))
    .limit(1);
  return stored ?? null;
}

export interface StorePageInput {
  database: Db;
  owner: EvidenceOwner;
  url: string;
  runId: string;
  jobId?: string | null;
  /** Fetch again even when the URL is stored */
  refresh?: boolean;
  fetchPage: (url: string) => Promise<FetchedPage>;
  extractor: MainTextExtractor;
  objects: EvidenceObjects;
  /** The outlet's name, for the row's attribution */
  outletName: (key: string) => string;
}

/**
 * Store one page as evidence for a book or an edition. A URL already stored
 * with the same kind is reused, for any owner, without a fetch: a new owner
 * gets a row of its own with the original retrieval time. A refresh fetches
 * again and supersedes the owner's older row of the same final URL.
 */
export async function storeEvidencePage(input: StorePageInput): Promise<{ record: StoredEvidence; fetched: boolean; created: boolean }> {
  const { database, owner } = input;
  // The owner is checked before any fetch or upload
  await ownerColumns(database, owner);

  if (!input.refresh) {
    const stored = await findStoredPage(database, input.url);
    if (stored) {
      // The owner's newest row of this URL, whichever run wrote it
      const [own] = await database
        .select()
        .from(sourceRecords)
        .where(and(isEvidence, sql`${sourceRecords.payload} ->> 'kind' = 'evidence_page'`, ownerWhere(owner), eq(sourceRecords.url, stored.url!)))
        .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id))
        .limit(1);
      if (own) return { record: own, fetched: false, created: false };
      const payload = { ...(stored.payload as EvidencePagePayload), runId: input.runId, jobId: input.jobId ?? null };
      const record = await insertEvidence(database, owner, {
        provider: stored.provider,
        url: stored.url,
        attribution: stored.attribution ?? stored.provider,
        retrievedAt: stored.retrievedAt,
        payload,
        supersedesId: null,
      });
      return { record, fetched: false, created: true };
    }
  }

  const page = await input.fetchPage(input.url);
  const extracted = input.extractor.extract(page.html, page.finalUrl);
  if (!extracted?.text.trim()) throw new EvidenceFetchError("no_main_text", "The page has no main text");
  const text = await storeText(input.objects, extracted.text);
  const rawSha256 = sha256(page.raw);
  const rawKey = evidenceRawKey(rawSha256);
  const gzipped = gzipSync(page.raw);
  await input.objects.putIfMissing(rawKey, gzipped, "application/gzip");

  const finalUrl = canonicalEvidenceUrl(page.finalUrl);
  const retrievedAt = new Date();
  const payload = evidencePagePayloadSchema.parse({
    kind: "evidence_page",
    retrievedVia: "fetch",
    outlet: page.outlet,
    requestedUrl: input.url,
    finalUrl: page.finalUrl,
    canonicalUrl: extracted.canonicalUrl,
    httpStatus: page.httpStatus,
    contentType: page.contentType,
    charset: page.charset,
    rawSha256,
    rawBytes: page.raw.length,
    rawStoredBytes: gzipped.length,
    rawKey,
    textSha256: text.textSha256,
    textChars: text.textChars,
    textBytes: text.textBytes,
    textKey: text.textKey,
    title: extracted.title?.slice(0, 1000) ?? null,
    byline: extracted.byline?.slice(0, 1000) ?? null,
    publishedOn: extracted.publishedOn?.slice(0, 100) ?? null,
    language: extracted.language?.slice(0, 35) ?? null,
    extractor: { name: input.extractor.name, version: input.extractor.version },
    fetcherVersion: FETCHER_VERSION,
    robots: page.robots,
    fingerprint: fingerprint(text.stored),
    runId: input.runId,
    jobId: input.jobId ?? null,
  });
  // A refresh of the same owner, outlet and final URL supersedes the newest row of that chain
  const [previous] = input.refresh
    ? await database
        .select({ id: sourceRecords.id })
        .from(sourceRecords)
        .where(
          and(
            isEvidence,
            ownerWhere(owner),
            eq(sourceRecords.provider, page.outlet),
            eq(sourceRecords.url, finalUrl),
            notExists(database.select({ id: sql`1` }).from(sql`source_records successor`).where(sql`successor.supersedes_id = ${sourceRecords.id}`)),
          ),
        )
        .orderBy(desc(sourceRecords.retrievedAt))
        .limit(1)
    : [];
  const record = await insertEvidence(database, owner, {
    provider: page.outlet,
    url: finalUrl,
    attribution: input.outletName(page.outlet),
    retrievedAt,
    payload,
    supersedesId: previous?.id ?? null,
  });
  return { record, fetched: true, created: true };
}

/**
 * Store a search snippet of a snippet-only outlet as evidence, with the same
 * format and hashing as a page; it records the search provider and the query.
 */
export async function storeEvidenceText(input: {
  database: Db;
  owner: EvidenceOwner;
  outlet: string;
  outletName: string;
  url: string | null;
  text: string;
  searchProvider: string;
  query: string;
  runId: string;
  jobId?: string | null;
  objects: EvidenceObjects;
}): Promise<StoredEvidence> {
  await ownerColumns(input.database, input.owner);
  const text = await storeText(input.objects, input.text);
  const payload = evidenceTextPayloadSchema.parse({
    kind: "evidence_text",
    retrievedVia: `search:${input.searchProvider}`,
    outlet: input.outlet,
    query: input.query,
    textSha256: text.textSha256,
    textChars: text.textChars,
    textBytes: text.textBytes,
    textKey: text.textKey,
    fingerprint: fingerprint(text.stored),
    runId: input.runId,
    jobId: input.jobId ?? null,
  });
  return insertEvidence(input.database, input.owner, {
    provider: input.outlet,
    url: input.url ? canonicalEvidenceUrl(input.url) : null,
    attribution: input.outletName,
    retrievedAt: new Date(),
    payload,
    supersedesId: null,
  });
}

export type EvidenceRead<T> = { status: "ok"; value: T } | { status: "purged" };

/** The stored text, when its hash matches; a missing object reads as purged */
export async function readEvidenceText(textSha256: string, objects: EvidenceObjects): Promise<EvidenceRead<string>> {
  const bytes = await objects.get(evidenceTextKey(textSha256));
  if (!bytes) return { status: "purged" };
  if (sha256(bytes) !== textSha256) throw new Error(`The stored text ${textSha256.slice(0, 12)} does not match its hash`);
  return { status: "ok", value: bytes.toString("utf8") };
}

/** The raw page of an evidence row, decoded with its charset, when its hash matches */
export async function readEvidencePage(record: Pick<StoredEvidence, "payload">, objects: EvidenceObjects): Promise<EvidenceRead<string>> {
  const payload = evidencePagePayloadSchema.parse(record.payload);
  const gzipped = await objects.get(payload.rawKey);
  if (!gzipped) return { status: "purged" };
  const raw = gunzipSync(gzipped);
  if (sha256(raw) !== payload.rawSha256) throw new Error(`The stored page ${payload.rawSha256.slice(0, 12)} does not match its hash`);
  return { status: "ok", value: new TextDecoder(payload.charset).decode(raw) };
}

/**
 * Undo a run's evidence: delete its rows that no claim cites, and keep the
 * cited ones. The objects stay until `--purge`, as other rows may share them.
 */
export async function undoEvidenceRun(database: Db, runId: string): Promise<{ deleted: number; kept: string[] }> {
  const rows = await database
    // In a select list drizzle leaves columns unqualified, so the subquery names its tables in full
    .select({ id: sourceRecords.id, cited: sql<boolean>`exists (select 1 from claim_evidence ce where ce.source_record_id = source_records.id)` })
    .from(sourceRecords)
    .where(and(isEvidence, sql`${sourceRecords.payload} ->> 'runId' = ${runId}`));
  const uncited = rows.filter((r) => !r.cited).map((r) => r.id);
  if (uncited.length) await atomicOn(database, (d) => [d.delete(sourceRecords).where(inArray(sourceRecords.id, uncited))]);
  return { deleted: uncited.length, kept: rows.filter((r) => r.cited).map((r) => r.id) };
}
