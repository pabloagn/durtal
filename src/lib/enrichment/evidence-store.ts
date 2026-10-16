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
import { MAX_RELATED_AUTHORS, sourceRequests, type SourceField } from "./source-profiles";
import { openLibraryAuthorKeys } from "./identity";
import { assessSourceContent, blockedSourceText, usableSourceQuality, type SourceIdentity, type SourceQuality } from "./source-quality";
import type { SourceSection, RelatedAuthor } from "./source-extract";
import { EVIDENCE_KINDS, evidencePagePayloadSchema, evidenceTextPayloadSchema, type EvidencePagePayload } from "./evidence-payload";

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
  fields?: SourceField[];
  identityText?: string;
  sections?: SourceSection[];
  partial?: boolean;
}
export interface MainTextExtractor {
  name: string;
  version: string;
  extract: (html: string, url: string, kind?: string, authors?: RelatedAuthor[]) => ExtractedPage | null;
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

const ownerWhere = (owner: EvidenceOwner) => (owner.kind === "book" ? eq(sourceRecords.workId, owner.workId) : eq(sourceRecords.editionId, owner.editionId));

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
  // Hash exactly the JSON representation persisted by PostgreSQL, omitting
  // undefined optional metadata rather than hashing it as a null field.
  const storedPayload = JSON.parse(json) as Record<string, unknown>;
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
          payload: storedPayload,
          payloadHash: sourcePayloadHash(storedPayload),
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
  outletKind?: string;
  expectedIdentity?: SourceIdentity;
}

function requireUsable(quality: SourceQuality) {
  if (usableSourceQuality(quality)) return;
  const reason = quality.status === "blocked" ? "source_blocked" : quality.status === "identity_mismatch" ? "identity_mismatch" : "extraction_failed";
  throw new EvidenceFetchError(reason, `Source rejected: ${quality.reasons.join(", ")}`);
}

/** Recheck old cache entries; nonempty legacy text is not a quality certificate. */
async function validateCached(record: StoredEvidence, input: StorePageInput) {
  const payload = evidencePagePayloadSchema.parse(record.payload);
  const read = await readEvidenceText(payload.textSha256, input.objects);
  if (read.status !== "ok") throw new EvidenceFetchError("extraction_failed", "Cached source text was purged; refresh required");
  const quality = assessSourceContent(
    {
      text: read.value,
      title: payload.title,
      identityText: payload.identityText,
      fields: payload.quality?.present,
    },
    payload.finalUrl,
    {
      profile: sourceRequests(input.url, input.outletKind).profile,
      identity: input.expectedIdentity,
    },
  );
  requireUsable(quality);
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
      await validateCached(stored, input);
      // The owner's newest row of this URL, whichever run wrote it
      const [own] = await database
        .select()
        .from(sourceRecords)
        .where(and(isEvidence, sql`${sourceRecords.payload} ->> 'kind' = 'evidence_page'`, ownerWhere(owner), eq(sourceRecords.url, stored.url!)))
        .orderBy(desc(sourceRecords.retrievedAt), desc(sourceRecords.id))
        .limit(1);
      if (own) {
        await validateCached(own, input);
        return { record: own, fetched: false, created: false };
      }
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

  const route = sourceRequests(input.url, input.outletKind);
  let page = await input.fetchPage(route.urls[0]);
  // A single authority fallback is allowed only for an explicitly empty BnF
  // result, never for a refusal, broken response or mismatched identity.
  if (route.urls[1] && /<(?:\w+:)?numberOfRecords>\s*0\s*<\//.test(page.html)) page = await input.fetchPage(route.urls[1]);
  if (blockedSourceText(page.html)) throw new EvidenceFetchError("source_blocked", "Source returned a verification or access page");
  let extracted = input.extractor.extract(page.html, page.finalUrl, input.outletKind);
  const relatedRecords: { url: string; key: string; name: string; retrievedAt: string; payloadSha256: string }[] = [];
  if (extracted && route.profile.key === "open-library") {
    let record: Record<string, unknown>;
    try { record = JSON.parse(page.html); } catch { throw new EvidenceFetchError("extraction_failed", "Invalid Open Library JSON"); }
    for (const key of openLibraryAuthorKeys(record).slice(0, MAX_RELATED_AUTHORS)) {
      const url = `https://openlibrary.org${key}.json`;
      const authorPage = await input.fetchPage(url);
      let author: { key?: unknown; name?: unknown };
      try { author = JSON.parse(authorPage.html); } catch { throw new EvidenceFetchError("extraction_failed", "Invalid Open Library author JSON"); }
      if (!author || typeof author !== "object" || Array.isArray(author)) throw new EvidenceFetchError("extraction_failed", "Invalid Open Library author record");
      if (new URL(authorPage.finalUrl).origin !== "https://openlibrary.org" || new URL(authorPage.finalUrl).pathname !== `${key}.json` || author.key !== key)
        throw new EvidenceFetchError("identity_mismatch", "Open Library returned another author record");
      if (typeof author.name !== "string" || !author.name.trim() || author.name.length > 500)
        throw new EvidenceFetchError("extraction_failed", "Open Library author record has no usable name");
      relatedRecords.push({ url, key, name: author.name, retrievedAt: new Date().toISOString(), payloadSha256: sha256(authorPage.raw) });
    }
    extracted = input.extractor.extract(page.html, page.finalUrl, input.outletKind, relatedRecords);
  }
  const quality = assessSourceContent(extracted, page.finalUrl, {
    profile: route.profile,
    identity: input.expectedIdentity,
  });
  requireUsable(quality);
  if (!extracted) throw new EvidenceFetchError("no_main_text", "The page has no main text");
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
    quality,
    sections: extracted.sections,
    identityText: extracted.identityText?.slice(0, 2000),
    ...(relatedRecords.length ? { relatedRecords } : {}),
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
            notExists(
              database
                .select({ id: sql`1` })
                .from(sql`source_records successor`)
                .where(sql`successor.supersedes_id = ${sourceRecords.id}`),
            ),
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
  expectedIdentity?: SourceIdentity;
}): Promise<StoredEvidence> {
  await ownerColumns(input.database, input.owner);
  const quality = assessSourceContent({ text: input.text }, input.url ?? "https://snippet.invalid", { identity: input.expectedIdentity, snippet: true });
  requireUsable(quality);
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
    quality,
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
