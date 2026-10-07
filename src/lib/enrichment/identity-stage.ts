import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import { sourcePayloadHash } from "@/lib/publishers/enrichment";
import { isbn10To13, validIsbn10, validIsbn13 } from "@/lib/match/plan";
import { PLACEHOLDER_SOURCE } from "@/lib/match/identify";
import type { Db } from "@/lib/catalogue/work-store";
import type { EvidenceInput } from "@/lib/validations/enrichment";
import { applyClaim, createHumanClaim, currentVocabularyVersion, proposeClaims, rejectClaim } from "./claims";
import { enqueueEnrichmentJob } from "./jobs";
import { scopePriority } from "./queue";
import type { EnrichmentStage, StageContext, StageStep } from "./stages";
import { fetchIdentityAnswers } from "./identity-sources";
import { IDENTITY_REVIEW, entryDecisions, identityReviewSchema, type IdentityReviewEntry } from "./identity-review";
import {
  ANSWER,
  CONFIDENCE,
  IDENTITY_DIMENSIONS,
  IDENTITY_RULES_VERSION,
  normalizeLccn,
  openLibraryId,
  planIdentity,
  type Answers,
  type EvidenceRef,
  type IdentityBook,
  type IdentityDimension,
  type IdentityPlan,
  type OpenLibraryEdition,
  type OpenLibraryWork,
  type Owner,
  type WikidataItem,
  type WorkDimension,
} from "./identity";

/*
 * The identity stage of the enrichment worker (SLN-464). Its jobs propose a
 * book's Wikidata QID, Open Library work, OCLC work ID and each edition's
 * LCCN as claims, with the stored answers as evidence; an exact claim is
 * applied by its dimension's exact-match rule while Pablo has it on, under
 * the daily cap. Its steps, before the jobs of an apply: Pablo's review file,
 * the sweep of exact claims the cap held back, and the re-queue of books
 * whose QID or Open Library work was accepted since their last job.
 */

type Row = Record<string, unknown>;
const rows = async <T = Row>(conn: Db, query: SQL) => resultRows<T>(await conn.execute(query));
const uuid = (id: string) => sql`${id}::uuid`;
const list = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const QID_OR_WORK: WorkDimension[] = ["wikidata_qid", "open_library_work"];

/** The identity dimensions of the current vocabulary; the worker refuses one the seed lacks (R4) */
async function identityDimensions(conn: Db) {
  const version = await currentVocabularyVersion(conn);
  const found = version
    ? await rows<{ key: IdentityDimension; provider: string }>(
        conn,
        sql`select key, provider from enrichment_dimensions where key in (${list(IDENTITY_DIMENSIONS)})
          and introduced_in <= ${version} and (retired_in is null or retired_in > ${version})`,
      )
    : [];
  const missing = IDENTITY_DIMENSIONS.filter((k) => !found.some((d) => d.key === k));
  if (missing.length) throw new Error(`The vocabulary has no identity dimension ${missing.join(", ")}: load its seed first`);
  return Object.fromEntries(found.map((d) => [d.key, d.provider])) as Record<IdentityDimension, string>;
}

/** The books of the jobs, with their editions, authors' IDs and known identity values */
async function loadBooks(conn: Db, workIds: string[], providers: Record<IdentityDimension, string>): Promise<IdentityBook[]> {
  if (!workIds.length) return [];
  const ids = sql.join(workIds.map(uuid), sql`, `);
  const books = await rows<{ workId: string; slug: string; title: string; authorQids: string[]; authorKeys: string[]; editions: Row[] }>(
    conn,
    sql`select w.id as "workId", w.slug, w.title,
        coalesce((select array_agg(distinct i.external_id) from work_authors wa join catalogue_identifiers i
          on i.entity_kind = 'person' and i.person_id = wa.author_id and i.provider = ${providers.wikidata_qid} where wa.work_id = w.id), '{}') as "authorQids",
        coalesce((select array_agg(distinct a.open_library_key) from work_authors wa join authors a on a.id = wa.author_id
          where wa.work_id = w.id and a.open_library_key is not null), '{}') as "authorKeys",
        -- Its editions with a copy; a book with none uses all of them. Placeholders belong to Identify.
        coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'isbn13', e.isbn_13, 'isbn10', e.isbn_10,
            'year', e.publication_year, 'locked', e.metadata_locked) order by e.id)
          from editions e where e.work_id = w.id and coalesce(e.metadata_source, '') <> ${PLACEHOLDER_SOURCE}
            and (exists (select 1 from instances i where i.edition_id = e.id and i.status <> 'deaccessioned')
              or not exists (select 1 from editions x join instances i on i.edition_id = x.id where x.work_id = w.id and i.status <> 'deaccessioned'))),
          '[]'::jsonb) as editions
      from works w where w.kind = 'book' and w.id in (${ids}) order by w.id`,
  );
  // Accepted claims, and identifiers registered by any writer
  const known = await rows<{ workId: string; editionId: string | null; dimension: IdentityDimension; value: string }>(
    conn,
    sql`select c.work_id as "workId", c.edition_id as "editionId", d.key as dimension, c.text_value as value
        from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
        where c.status = 'accepted' and d.key in (${list(IDENTITY_DIMENSIONS)}) and c.work_id in (${ids})
      union all
      select coalesce(i.work_id, e.work_id), i.edition_id, p.key, i.external_id from catalogue_identifiers i
        join (values ${sql.join(
          IDENTITY_DIMENSIONS.map((k) => sql`(${k}::text, ${providers[k]}::text, ${k === "lccn" ? "edition" : "book"}::text)`),
          sql`, `,
        )}) p(key, provider, kind) on p.provider = i.provider and p.kind = i.entity_kind
        left join editions e on e.id = i.edition_id
        where i.work_id in (${ids}) or e.work_id in (${ids})`,
  );
  return books.map((b) => {
    const mine = known.filter((k) => k.workId === b.workId);
    return {
      workId: b.workId,
      slug: b.slug,
      title: b.title,
      authorQids: b.authorQids,
      authorOpenLibraryIds: b.authorKeys.map((k) => openLibraryId(k, "A")).filter((k): k is string => !!k),
      editions: b.editions.map((e) => {
        const ten = validIsbn10(e.isbn10 as string | null);
        return {
          id: e.id as string,
          title: e.title as string,
          isbn13: validIsbn13(e.isbn13 as string | null) ?? (ten ? isbn10To13(ten) : null),
          year: (e.year as number | null) ?? null,
          locked: e.locked as boolean,
        };
      }),
      known: Object.fromEntries(mine.filter((k) => !k.editionId).map((k) => [k.dimension, k.value])),
      knownLccn: Object.fromEntries(mine.filter((k) => k.editionId && k.dimension === "lccn").map((k) => [k.editionId, k.value])),
      taken: {},
    };
  });
}

/** QIDs and Open Library work ids registered for another book */
async function takenBy(conn: Db, workId: string, values: string[], providers: Record<IdentityDimension, string>) {
  if (!values.length) return {};
  const taken = await rows<{ value: string; workId: string; slug: string }>(
    conn,
    sql`select i.external_id as value, w.id as "workId", w.slug from catalogue_identifiers i join works w on w.id = i.work_id
      where i.entity_kind = 'book' and i.work_id <> ${uuid(workId)} and i.provider in (${providers.wikidata_qid}, ${providers.open_library_work})
        and i.external_id in (${list(values)})`,
  );
  return Object.fromEntries(taken.map((t) => [t.value, { workId: t.workId, slug: t.slug }]));
}

/** One book's plan, with the IDs other books hold */
async function bookPlan(conn: Db, book: IdentityBook, answers: Answers, providers: Record<IdentityDimension, string>) {
  const first = planIdentity(book, answers);
  const values = first.proposals.filter((p) => QID_OR_WORK.includes(p.dimension as WorkDimension)).map((p) => p.value);
  book.taken = await takenBy(conn, book.workId, values, providers);
  return Object.keys(book.taken).length ? planIdentity(book, answers) : first;
}

// ── Stored answers ──────────────────────────────────────────────────────────

/** The provider, page and attribution of a cached answer */
function describe(key: string, answer: unknown) {
  if (key.startsWith("openlibrary:isbn:"))
    return { provider: "open_library", url: `https://openlibrary.org${(answer as OpenLibraryEdition).key}`, attribution: "Open Library" };
  if (key.startsWith("openlibrary:work:"))
    return { provider: "open_library", url: `https://openlibrary.org${(answer as OpenLibraryWork).key}`, attribution: "Open Library" };
  return { provider: "wikidata", url: `https://www.wikidata.org/wiki/${(answer as WikidataItem).id}`, attribution: "Wikidata (CC0)" };
}

/**
 * Stores one answer as a source record of the book or edition it describes:
 * the fields read, copied as fetched, and the run id. Its identifier stays
 * null: the identifier exists only once a claim is applied, and reaches this
 * record through its claim's evidence.
 */
async function recordAnswer(conn: Db, answerKey: string, owner: Owner, ctx: StageContext) {
  const cached = ctx.cache.get(answerKey);
  if (!cached?.answer) throw new Error(`No answer for ${answerKey} in the cache`);
  const payload = { ...(cached.answer as Row), runId: ctx.runId };
  if (Buffer.byteLength(stableStringify(payload), "utf8") > 1_000_000) throw new Error("A source observation must be at most 1 MB");
  const { provider, url, attribution } = describe(answerKey, cached.answer);
  const [row] = await rows<{ id: string }>(
    conn,
    sql`insert into source_records (entity_kind, work_id, edition_id, provider, url, attribution, retrieved_at, payload, payload_hash, review_status)
      values (${owner.kind}, ${owner.kind === "book" ? owner.id : null}::uuid, ${owner.kind === "edition" ? owner.id : null}::uuid,
        ${provider}, ${url}, ${attribution}, ${cached.retrievedAt}::timestamptz, ${JSON.stringify(payload)}::jsonb, ${sourcePayloadHash(payload)}, 'accepted')
      returning id`,
  );
  return row.id;
}

/** Evidence inputs for refs, storing each answer once per owner */
async function evidenceFor(conn: Db, refs: EvidenceRef[], ctx: StageContext, stored: Map<string, string>): Promise<EvidenceInput[]> {
  const inputs: EvidenceInput[] = [];
  for (const ref of refs) {
    const key = `${ref.answer}|${ref.owner.id}`;
    if (!stored.has(key)) stored.set(key, await recordAnswer(conn, ref.answer, ref.owner, ctx));
    inputs.push({ locator: "payload", sourceRecordId: stored.get(key)!, extractorVersion: IDENTITY_RULES_VERSION, excerpt: ref.excerpt, payloadPath: ref.path });
  }
  return inputs;
}

/** The enabled exact-match rules of the identity dimensions, by dimension */
async function enabledRules(conn: Db) {
  const found = await rows<{ key: IdentityDimension; id: string }>(
    conn,
    sql`select d.key, r.id from enrichment_auto_accept_rules r join enrichment_dimensions d on d.id = r.dimension_id
      where r.enabled and r.basis = 'exact_identifier_match' and d.retired_in is null and d.key in (${list(IDENTITY_DIMENSIONS)})`,
  );
  return Object.fromEntries(found.map((r) => [r.key, r.id])) as Partial<Record<IdentityDimension, string>>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const byDimension = (a: { dimension: IdentityDimension }, b: { dimension: IdentityDimension }) =>
  IDENTITY_DIMENSIONS.indexOf(a.dimension) - IDENTITY_DIMENSIONS.indexOf(b.dimension);

// ── The job ─────────────────────────────────────────────────────────────────

export type IdentityJobPlan = IdentityPlan & { slug: string };

/** The outcome a job keeps in its payload, for the report and the inbox (SLN-470) */
export interface IdentityOutcome {
  result: IdentityPlan["result"];
  proposed: number;
  applied: number;
  /** Exact claims left proposed: their rule is off, or the cap is reached */
  waiting: number;
  collisions: IdentityPlan["collisions"];
  tried: string[];
  notes: string[];
  [key: string]: unknown;
}

/**
 * Writes one job's plan in its transaction: a QID or Open Library work
 * another book took earlier in this run is held too; each answer used is
 * stored once; each value becomes a claim with its evidence; then the exact
 * claims are applied by their enabled rule, the QID first.
 */
async function writeJob(tx: Db, workId: string, jobId: string, plan: IdentityJobPlan, ctx: StageContext): Promise<IdentityOutcome> {
  const work = plan.proposals.filter((p) => QID_OR_WORK.includes(p.dimension as WorkDimension));
  const inRun = work.length
    ? await rows<{ value: string; workId: string; slug: string }>(
        tx,
        sql`select c.text_value as value, w.id as "workId", w.slug from enrichment_claims c
          join enrichment_dimensions d on d.id = c.dimension_id join works w on w.id = c.work_id
          where c.run_id = ${uuid(ctx.runId)} and c.work_id <> ${uuid(workId)} and d.key in (${list(QID_OR_WORK)})
            and c.status in ('proposed', 'accepted') and c.text_value in (${list(work.map((p) => p.value))})`,
      )
    : [];
  const collisions = [...plan.collisions];
  const proposals = plan.proposals.filter((p) => {
    const other = inRun.find((r) => r.value === p.value && QID_OR_WORK.includes(p.dimension as WorkDimension));
    if (other) collisions.push({ dimension: p.dimension as WorkDimension, value: p.value, workId: other.workId, slug: other.slug });
    return !other;
  });

  const version = (await currentVocabularyVersion(tx))!;
  const stored = new Map<string, string>();
  const inputs = [];
  for (const p of proposals)
    inputs.push({
      workId,
      editionId: p.editionId,
      dimension: p.dimension,
      value: { text: p.value },
      method: "api" as const,
      confidence: p.confidence,
      vocabularyVersion: version,
      runId: ctx.runId,
      jobId,
      note: p.note,
      evidence: await evidenceFor(tx, p.evidence, ctx, stored),
    });
  const results = await proposeClaims(inputs, tx);
  const refused = results.flatMap((r, i) => (r.status === "refused" ? [`${proposals[i].dimension} ${proposals[i].value}: ${r.reason}`] : []));
  if (refused.length) throw new Error(`Refused proposals: ${refused.join("; ")}`);

  const rules = await enabledRules(tx);
  let applied = 0;
  let waiting = 0;
  const exact = proposals
    .map((p, i) => ({ dimension: p.dimension, confidence: p.confidence, result: results[i] }))
    .filter((x) => x.confidence === CONFIDENCE.exact && "claimId" in x.result)
    .sort(byDimension);
  for (const x of exact) {
    const ruleId = rules[x.dimension];
    try {
      if (!ruleId) throw new Error("its rule is off");
      await applyClaim((x.result as { claimId: string }).claimId, { by: "rule", ruleId, batchId: ctx.runId }, tx);
      applied++;
    } catch {
      waiting++;
    }
  }
  return {
    result: collisions.length ? "collision" : plan.result,
    proposed: results.filter((r) => r.status === "created").length,
    applied,
    waiting,
    collisions,
    tried: plan.tried,
    notes: plan.notes,
  };
}

const summaryOf = (plan: IdentityJobPlan) =>
  [
    plan.result,
    ...plan.proposals.map((p) => `${p.dimension} ${p.value} (${p.confidence}: ${p.note})`),
    ...plan.collisions.map((c) => `${c.dimension} ${c.value} held: /library/${c.slug} has it`),
  ].join("; ");

// ── Steps ───────────────────────────────────────────────────────────────────

const entryHash = (entry: IdentityReviewEntry) => createHash("md5").update(stableStringify(entry)).digest("hex").slice(0, 12);

/**
 * Pablo's review file: plan prints what each entry would do; apply does it.
 * An unknown slug or a title that differs stops the run. An entry already
 * applied (live or undone) is skipped until it changes.
 */
async function reviewFile(conn: Db, ctx: StageContext, review: Record<string, IdentityReviewEntry>, apply: boolean) {
  const entries = Object.entries(identityReviewSchema.parse(review));
  if (!entries.length) return ["- no entries"];
  const books = await rows<{ id: string; slug: string; title: string; editions: { id: string; isbn13: string | null; isbn10: string | null }[] }>(
    conn,
    sql`select w.id, w.slug, w.title, coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'isbn13', e.isbn_13, 'isbn10', e.isbn_10))
        from editions e where e.work_id = w.id), '[]'::jsonb) as editions
      from works w where w.kind = 'book' and w.slug in (${list(entries.map(([slug]) => slug))})`,
  );
  const lines: string[] = [];
  for (const [slug, entry] of entries) {
    const book = books.find((b) => b.slug === slug);
    if (!book) throw new Error(`Review file: no book has the slug ${slug}`);
    if (book.title !== entry.title) throw new Error(`Review file: ${slug} is titled "${book.title}", not "${entry.title}"`);
    const marker = `${entry.note} (review ${entryHash(entry)})`;
    const [done] = await rows<{ done: boolean }>(
      conn,
      sql`select exists (select 1 from enrichment_applications where work_id = ${uuid(book.id)} and note = ${marker}) as done`,
    );
    if (done.done) {
      lines.push(`- ${slug}: applied before; change the entry to apply it again`);
      continue;
    }
    for (const decision of entryDecisions(entry)) {
      const edition = decision.isbn
        ? book.editions.find((e) => validIsbn13(e.isbn13) === decision.isbn || (validIsbn10(e.isbn10) && isbn10To13(validIsbn10(e.isbn10)!) === decision.isbn))
        : null;
      const what = `${slug}: ${decision.dimension}${decision.isbn ? ` of ${decision.isbn}` : ""}`;
      if (decision.isbn && !edition) {
        lines.push(`- ${what}: no edition has this ISBN`);
        continue;
      }
      const open = await rows<{ id: string; value: string }>(
        conn,
        sql`select c.id, c.text_value as value from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
          where c.work_id = ${uuid(book.id)} and d.key = ${decision.dimension} and c.status = 'proposed'
            and c.edition_id is not distinct from ${edition?.id ?? null}::uuid order by c.created_at, c.id`,
      );
      const match = open.find((c) => c.value === decision.value);
      const confirm = decision.value === null || match ? null : confirmation(decision.dimension, decision.value, decision.isbn, book.id, edition?.id ?? null, ctx);
      if (confirm === undefined) {
        lines.push(`- ${what}: ${decision.value} was not looked up (the fetch stopped): skipped`);
        continue;
      }
      lines.push(
        `- ${what}: ${
          decision.value === null
            ? `rejects ${open.length} proposals`
            : match
              ? `accepts the proposal ${decision.value}`
              : `records Pablo's ${decision.value}${confirm ? `, confirmed by ${describe(confirm.answer, ctx.cache.get(confirm.answer)!.answer).url}` : " (no source confirms it)"}`
        }`,
      );
      if (!apply) continue;
      try {
        for (const c of open.filter((c) => c !== match)) await rejectClaim(c.id, { reason: "wrong_book", note: entry.note }, conn);
        if (decision.value === null) continue;
        if (match) await applyClaim(match.id, { by: "pablo", batchId: ctx.runId, note: marker }, conn);
        else
          await createHumanClaim(
            { workId: book.id, editionId: edition?.id, dimension: decision.dimension, value: { text: decision.value } },
            conn,
            { batchId: ctx.runId, note: marker, evidence: confirm ? await evidenceFor(conn, [confirm], ctx, new Map()) : [] },
          );
      } catch (error) {
        lines.push(`  refused: ${message(error)}`);
      }
    }
  }
  return lines;
}

/**
 * The stored answer that confirms a value Pablo typed: null when its source
 * has no such record (or none can, like an OCLC work ID), undefined when the
 * fetch never looked it up
 */
function confirmation(dimension: IdentityDimension, value: string, isbn: string | null, workId: string, editionId: string | null, ctx: StageContext): EvidenceRef | null | undefined {
  const book: Owner = { kind: "book", id: workId };
  if (dimension === "oclc_work") return null;
  if (dimension === "wikidata_qid") {
    const cached = ctx.cache.get(ANSWER.item(value));
    if (!cached) return undefined;
    const item = cached.answer as WikidataItem | null;
    return item?.id === value ? { answer: ANSWER.item(value), owner: book, path: ["id"], excerpt: value } : null;
  }
  if (dimension === "open_library_work") {
    const cached = ctx.cache.get(ANSWER.work(value));
    if (!cached) return undefined;
    const work = cached.answer as OpenLibraryWork | null;
    return work?.key === `/works/${value}` ? { answer: ANSWER.work(value), owner: book, path: ["key"], excerpt: work.key } : null;
  }
  const cached = ctx.cache.get(ANSWER.edition(isbn!));
  if (!cached) return undefined;
  const raw = (cached.answer as OpenLibraryEdition | null)?.lccn ?? [];
  const at = raw.findIndex((l) => normalizeLccn(l) === value);
  return at >= 0 ? { answer: ANSWER.edition(isbn!), owner: { kind: "edition", id: editionId! }, path: ["lccn", String(at)], excerpt: raw[at] } : null;
}

/** Proposed exact claims a rule may apply now: rule on, confidence at its minimum, never undone. The QIDs first. */
const sweepable = (conn: Db) =>
  rows<{ id: string; ruleId: string }>(
    conn,
    sql`select c.id, r.id as "ruleId" from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
        join enrichment_auto_accept_rules r on r.dimension_id = d.id
      where c.status = 'proposed' and c.method = 'api' and r.enabled and r.basis = 'exact_identifier_match'
        and c.confidence >= r.minimum_confidence and d.key in (${list(IDENTITY_DIMENSIONS)})
        and not exists (select 1 from enrichment_applications a where a.claim_id = c.id and a.undone_at is not null)
      order by array_position(array[${list(IDENTITY_DIMENSIONS)}]::text[], d.key), c.created_at, c.id`,
  );

const sweep: StageStep = {
  name: "Sweep",
  async plan(conn) {
    return [`- ${(await sweepable(conn)).length} exact identity claims a rule may apply, under the daily cap`];
  },
  async apply(tx, ctx) {
    const claims = await sweepable(tx);
    let applied = 0;
    const lines: string[] = [];
    for (const c of claims) {
      try {
        await applyClaim(c.id, { by: "rule", ruleId: c.ruleId, batchId: ctx.runId }, tx);
        applied++;
      } catch (error) {
        if (message(error) === "The daily cap on automatic applies is reached") {
          lines.push(`- the daily cap is reached; the other claims wait for the next run`);
          break;
        }
        lines.push(`- claim ${c.id}: ${message(error)}`);
      }
    }
    return [`- applied ${applied} of ${claims.length}`, ...lines];
  },
};

/** Books whose QID or Open Library work was accepted after their last identity job, with no open job */
const requeueable = (conn: Db) =>
  rows<{ workId: string; priority: number }>(
    conn,
    sql`select distinct on (c.work_id) c.work_id as "workId", ${scopePriority(sql`c.work_id`)} as priority
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
      where c.status = 'accepted' and d.key in (${list(QID_OR_WORK)})
        and c.decided_at > coalesce((select max(j.finished_at) from enrichment_jobs j
          where j.work_id = c.work_id and j.kind = 'identity' and j.status = 'done'), '-infinity'::timestamptz)
        and not exists (select 1 from enrichment_jobs j where j.work_id = c.work_id and j.kind = 'identity' and j.status in ('queued', 'running', 'held'))
      order by c.work_id`,
  );

const requeue: StageStep = {
  name: "Re-queue",
  async plan(conn) {
    return [`- ${(await requeueable(conn)).length} books to queue again for their derived IDs`];
  },
  async apply(tx) {
    const books = await requeueable(tx);
    for (const b of books) await enqueueEnrichmentJob({ workId: b.workId, kind: "identity", reason: "manual", priority: Number(b.priority) }, tx);
    return [`- queued ${books.length} books; the next run works them`];
  },
};

// ── The report ──────────────────────────────────────────────────────────────

/** The page of an ID, for Pablo; an OCLC work ID has none without a subscription */
const PAGES: Partial<Record<IdentityDimension, (value: string) => string>> = {
  wikidata_qid: (v) => `https://www.wikidata.org/wiki/${v}`,
  open_library_work: (v) => `https://openlibrary.org/works/${v}`,
  lccn: (v) => `https://lccn.loc.gov/${v}`,
};

/** The report's last sections, read from the database: what waits, what needs Pablo, and the unresolved books */
async function report(conn: Db) {
  const claims = await rows<{ slug: string; title: string; dimension: IdentityDimension; isbn: string | null; value: string; confidence: number; note: string | null; undone: boolean; ruleOn: boolean }>(
    conn,
    sql`select w.slug, w.title, d.key as dimension, e.isbn_13 as isbn, c.text_value as value, c.confidence::float8 as confidence, c.note,
        exists (select 1 from enrichment_applications a where a.claim_id = c.id and a.undone_at is not null) as undone,
        exists (select 1 from enrichment_auto_accept_rules r where r.dimension_id = d.id and r.enabled) as "ruleOn"
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id join works w on w.id = c.work_id
        left join editions e on e.id = c.edition_id
      where c.status = 'proposed' and d.key in (${list(IDENTITY_DIMENSIONS)})
      order by w.slug, array_position(array[${list(IDENTITY_DIMENSIONS)}]::text[], d.key), c.confidence desc, c.text_value`,
  );
  const line = (c: (typeof claims)[number]) => `- ${c.slug}: ${c.dimension}${c.isbn ? ` of ${c.isbn}` : ""} ${[c.value, PAGES[c.dimension]?.(c.value)].filter(Boolean).join(" ")}`;
  const waiting = claims.filter((c) => !c.undone && c.confidence === CONFIDENCE.exact);
  const undone = claims.filter((c) => c.undone);
  const doubtful = claims.filter((c) => !c.undone && c.confidence < CONFIDENCE.exact);
  const unresolved = await rows<{ slug: string; title: string; outcome: { result: string; tried?: string[]; collisions?: { slug: string; value: string }[] } }>(
    conn,
    sql`select w.slug, w.title, j.payload -> 'outcome' as outcome from works w
      join lateral (select payload from enrichment_jobs where work_id = w.id and kind = 'identity' and status = 'done' order by finished_at desc limit 1) j on true
      where j.payload -> 'outcome' ->> 'result' in ('not_found', 'collision')
        and not exists (select 1 from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id
          where c.work_id = w.id and d.key = 'wikidata_qid' and c.status in ('proposed', 'accepted'))
      order by w.slug`,
  );
  const entry = (slug: string, title: string, fields: string) => `  ${JSON.stringify(slug)}: { title: ${JSON.stringify(title)}, ${fields}, note: "" },`;
  const bySlug = [...new Set(doubtful.map((c) => c.slug))];
  return [
    `## Exact, waiting for the rule (${waiting.length})`,
    ...waiting.map((c) => `${line(c)}${c.ruleOn ? " (the daily cap held it)" : ""}`),
    `## Undone, waiting for Pablo (${undone.length})`,
    ...undone.map(line),
    `## For review (${bySlug.length} books): candidates, then a ready IDENTITY_REVIEW entry`,
    ...bySlug.flatMap((slug) => {
      const mine = doubtful.filter((c) => c.slug === slug);
      const dims = [...new Set(mine.map((c) => c.dimension))];
      return [
        ...mine.map((c) => `${line(c)} (${c.confidence}: ${c.note ?? ""})`),
        entry(
          slug,
          mine[0].title,
          dims
            .map((d) =>
              d === "lccn"
                ? `lccn: { ${[...new Set(mine.filter((c) => c.dimension === "lccn").map((c) => c.isbn))].map((isbn) => `${JSON.stringify(isbn)}: null`).join(", ")} }`
                : `${d}: null`,
            )
            .join(", "),
        ),
      ];
    }),
    `## Unresolved books (${unresolved.length})`,
    ...unresolved.flatMap((u) => [
      `- ${u.slug}: ${u.outcome.result}; tried ${(u.outcome.tried ?? []).join(", ") || "nothing"}${(u.outcome.collisions ?? []).map((c) => `; ${c.value} is held by /library/${c.slug}`).join("")}`,
      entry(u.slug, u.title, "wikidata_qid: null"),
    ]),
  ];
}

/** What each path found across the run's books (the reverse-P648 yield among them) */
function summarize(plans: IdentityJobPlan[]) {
  const count = (test: (p: IdentityJobPlan) => boolean) => plans.filter(test).length;
  return [
    `## Identity: what each path found (${plans.length} books)`,
    `- Open Library edition by ISBN: ${count((p) => p.found.edition)}; its work: ${count((p) => p.found.work)}`,
    `- Wikidata item by its P648 (reverse lookup): ${count((p) => p.found.byP648)}; by the Open Library work's link: ${count((p) => p.found.byLink)}; by both: ${count((p) => p.found.byP648 && p.found.byLink)}`,
    `- Title search by author QID: ${count((p) => p.found.bySearch)}; nothing found: ${count((p) => p.result === "not_found")}`,
    `- Exact QIDs: ${count((p) => p.proposals.some((q) => q.dimension === "wikidata_qid" && q.confidence === CONFIDENCE.exact))}; held collisions: ${count((p) => p.collisions.length > 0)}`,
  ];
}

// ── The stage ───────────────────────────────────────────────────────────────

/** The identity stage, with Pablo's review file (a test passes its own) */
export function identityStage(review: Record<string, IdentityReviewEntry> = IDENTITY_REVIEW): EnrichmentStage<IdentityJobPlan> {
  const lookups = () => {
    const entries = Object.values(review);
    return {
      qids: entries.map((e) => e.wikidata_qid).filter((v): v is string => !!v),
      works: entries.map((e) => e.open_library_work).filter((v): v is string => !!v),
      isbns: entries.flatMap((e) => Object.keys(e.lccn ?? {})),
    };
  };
  return {
    kind: "identity",
    callsOut: true,
    async fetch(conn, jobs, ctx) {
      const providers = await identityDimensions(conn);
      await fetchIdentityAnswers(await loadBooks(conn, jobs.map((j) => j.workId), providers), ctx.cache, ctx.pace, lookups());
    },
    async plan(conn, job, ctx) {
      const providers = await identityDimensions(conn);
      const [book] = await loadBooks(conn, [job.workId], providers);
      const plan = { ...(await bookPlan(conn, book, ctx.cache, providers)), slug: book.slug };
      return { plan, summary: summaryOf(plan) };
    },
    write: (tx, job, plan, ctx) => writeJob(tx, job.workId, job.id, plan, ctx),
    steps: [
      { name: "Review file", plan: (conn, ctx) => reviewFile(conn, ctx, review, false), apply: (tx, ctx) => reviewFile(tx, ctx, review, true) },
      sweep,
      requeue,
    ],
    /** A run's own proposals that were never applied are withdrawn; an undone apply's claim stays, waiting for Pablo */
    async undo(tx, runId) {
      const withdrawn = await rows(
        tx,
        sql`update enrichment_claims c set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'run_undone'
          from enrichment_dimensions d where d.id = c.dimension_id and d.key in (${list(IDENTITY_DIMENSIONS)})
            and c.run_id = ${uuid(runId)} and c.status = 'proposed' and c.method = 'api'
            and not exists (select 1 from enrichment_applications a where a.claim_id = c.id)
          returning c.id`,
      );
      return [`Identity: withdrew ${withdrawn.length} proposals the run made and never applied`];
    },
    summarize,
    epilogue: report,
  };
}
