import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import type { Db } from "@/lib/catalogue/work-store";
import { bucketEvidenceObjects, type EvidenceObjects } from "@/lib/s3/evidence-objects";
import { currentVocabularyVersion, proposeClaims } from "../claims";
import { enqueueEnrichmentJob } from "../jobs";
import { readEvidenceText } from "../evidence-store";
import { costOf, priceFor } from "../prices";
import { capLine, metered, monthSpend, WorkCeilingStop } from "../meter";
import { goldSetHiddenCondition, GOLD_SET_WORK_IDS } from "../gold-set";
import type { EnrichmentStage, StageContext, StageStep } from "../stages";
import type { SourceCache } from "../source-cache";
import { EXTRACTION_MODEL, RESEARCH_CONFIG } from "./config";
import { loadProfiles, type ResearchProfile } from "./profile";
import { storedDocuments, type StoredDocument } from "./documents";
import { aboutWork, passagesOf } from "./text";
import { answerSchema, buildRequest, EXTRACTOR_VERSION, PROMPT_VERSION, requestHash, type ExtractDimension, type ExtractionRequest } from "./request";
import { verifyValue, type ValueCheck, type VerifiedValue } from "./verify";
import { checkIndependence, type EvidenceRow } from "./independence";
import { researchConfidence } from "./confidence";
import { conflictsOf, type OtherValue } from "./conflicts";
import { anthropicModel, type ExtractionModel, type ModelAnswer } from "./model";

/*
 * The extract stage (SLN-469, sections 3 to 8): for each book, the stored
 * documents about it, one model request per document with only its passages,
 * the checks of every returned value (R4, R3, length), then per value the
 * independence rule (R6), the conflicts and the confidence, and the
 * proposals: `agent` claims with text evidence, or R6 rejections. Nothing is
 * applied. A request is never sent twice: an extraction row records each,
 * and the run's cache keeps each answer by request hash until its rows are
 * written. Every call goes through the cost meter, its estimate the free
 * token count plus the full output cap.
 */

const rows = async <T>(conn: Db, query: SQL) => resultRows<T>(await conn.execute(query));
const list = (values: readonly string[]) => sql.join(values.map((v) => sql`${v}`), sql`, `);
const sha256 = (value: unknown) => createHash("sha256").update(stableStringify(value)).digest("hex");
/** Characters per token for a plan's estimate, until the trial measures it; an apply counts tokens */
const CHARS_PER_TOKEN = 4;
const usd = (amount: number) => `$${amount.toFixed(amount < 1 ? 3 : 2)}`;
/** The first `n` code points of a text, never half of an astral character: jsonb refuses one */
const clip = (text: string, n: number) => [...text.toWellFormed()].slice(0, n).join("");

/** A dimension the research agent extracts: experience terms and scales, and facts terms marked for research */
const RESEARCH_DIMENSION = sql.raw(`((d.layer = 'experience' and d.value_kind in ('term', 'terms', 'scale'))
  or (d.layer = 'facts' and d.value_kind in ('term', 'terms') and (d.parameters ->> 'research') = 'true'))`);

/**
 * A dimension's revision: the last vocabulary version, up to `version`, that
 * introduced or retired a row of it or of one of its terms
 */
const revision = (key: SQL, version: number) =>
  sql`(select max(x.v) from (
      select unnest(array[d2.introduced_in, d2.retired_in]) as v from enrichment_dimensions d2 where d2.key = ${key}
      union all select unnest(array[t2.introduced_in, t2.retired_in]) from enrichment_terms t2 join enrichment_dimensions d2 on d2.id = t2.dimension_id where d2.key = ${key}
    ) x where x.v <= ${version})`;

type Dimension = ExtractDimension & { independent: boolean; revision: number };

/** The research dimensions of a vocabulary version, with every term's definition and rules (never examples) */
async function extractDimensions(conn: Db, version: number, keys?: string[]): Promise<Dimension[]> {
  const current = (alias: string) => sql.raw(`${alias}.introduced_in <= ${version} and (${alias}.retired_in is null or ${alias}.retired_in > ${version})`);
  return rows(
    conn,
    sql`select d.key, d.label, d.definition, d.value_kind as "valueKind", d.requires_independent_sources as independent,
        ${revision(sql`d.key`, version)} as revision,
        coalesce(d.parameters -> 'exclusiveTerms', '[]'::jsonb) as exclusive,
        coalesce((select jsonb_agg(jsonb_build_object('key', t.key, 'label', t.label, 'definition', t.definition, 'appliesWhen', t.applies_when,
            'doesNotApplyWhen', t.does_not_apply_when, 'scaleValue', t.scale_value) order by t.scale_value nulls last, t.key)
          from enrichment_terms t where t.dimension_id = d.id and ${current("t")}), '[]'::jsonb) as terms
      from enrichment_dimensions d
      where ${current("d")} ${keys?.length ? sql`and d.key in (${list(keys)})` : sql``} and ${RESEARCH_DIMENSION}
      order by d.layer desc, d.key`,
  );
}

type Status = "not_about_work" | "answered" | "invalid_answer";
interface Failure {
  dimension: string;
  term: string;
  check: ValueCheck;
  excerpt: string;
}
/** One document's extraction, or why it has none */
interface DocumentResult {
  document: StoredDocument;
  status: Status | "skipped";
  reason?: string;
  requestSha256?: string;
  passages?: { id: string; start: number; end: number }[];
  valuesReturned: number;
  verified: VerifiedValue[];
  failures: Failure[];
}

export interface ExtractPlan {
  profile: ResearchProfile | null;
  skipped: string | null;
  version: number;
  dimensions: Dimension[];
  documents: StoredDocument[];
  estimate: number;
  /** All enrichment spend this month when the job was planned: settled and reserved */
  spentThisMonth: number;
  results?: DocumentResult[];
}

export interface ExtractDeps {
  /** Null without ANTHROPIC_API_KEY */
  model: () => ExtractionModel | null;
  objects: EvidenceObjects;
}
const DEFAULTS: ExtractDeps = {
  model: () => {
    const key = process.env.ANTHROPIC_API_KEY?.trim();
    return key ? anthropicModel(key) : null;
  },
  objects: bucketEvidenceObjects,
};

/** The extraction of a document already sent with this request hash, not undone */
async function extractedBefore(conn: Db, sourceRecordId: string, hash: string) {
  const [row] = await rows<{ found: boolean }>(
    conn,
    sql`select exists (select 1 from enrichment_extractions where source_record_id = ${sourceRecordId}::uuid and request_sha256 = ${hash} and undone_at is null) as found`,
  );
  return row.found;
}

/** An answer of the pinned model that ended on its own and parses against the schema: its values, else null */
function valuesOf(answer: ModelAnswer, dimensions: ExtractDimension[]) {
  if (answer.stopReason !== "end_turn" || answer.model !== EXTRACTION_MODEL.model) return null;
  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch {
    return null;
  }
  const parsed = answerSchema(dimensions.filter((d) => d.terms.length)).safeParse(json);
  if (!parsed.success) return null;
  return Object.entries(parsed.data).flatMap(([dimension, values]) => values.map((v) => ({ dimension, ...v })));
}

/** One evidence row of a value: a verified excerpt of a stored document */
interface ValueEvidence extends EvidenceRow {
  start: number;
  end: number;
  textSha256: string;
  extractorVersion: string;
  /** The run whose check verified it */
  runId: string;
}

/** Earlier evidence of the book's open and R6-rejected agent claims, except an undone run's */
async function earlierEvidence(conn: Db, workId: string, dimensionKeys: string[]) {
  if (!dimensionKeys.length) return [];
  return rows<ValueEvidence & { dimension: string; term: string }>(
    conn,
    sql`select d.key as dimension, t.key as term, e.source_record_id as "sourceRecordId", 'agent' as method, o.key as outlet, o.kind as "outletKind",
        o.weight::float8 as weight, o.syndication_group as "syndicationGroup", s.payload ->> 'byline' as byline, s.payload -> 'fingerprint' as fingerprint,
        e.excerpt, e.start_offset as start, e.end_offset as "end", e.text_sha256 as "textSha256", e.extractor_version as "extractorVersion", e.run_id as "runId"
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id join enrichment_terms t on t.id = c.term_id
        join claim_evidence e on e.claim_id = c.id join source_records s on s.id = e.source_record_id join evidence_outlets o on o.key = s.provider
      where c.work_id = ${workId}::uuid and c.method = 'agent' and d.key in (${list(dimensionKeys)}) and e.locator = 'text'
        and (c.status = 'proposed' or (c.status = 'rejected' and c.decision_reason = 'not_independent'))
        and not exists (select 1 from enrichment_extractions x where x.run_id = e.run_id and x.undone_at is not null)`,
  );
}

/** The book's open and accepted values of these dimensions, by any method, for the conflict check */
async function otherValues(conn: Db, workId: string, dimensionKeys: string[]) {
  if (!dimensionKeys.length) return [];
  return rows<OtherValue & { dimension: string }>(
    conn,
    sql`select d.key as dimension, t.key as term, c.method, c.status,
        case c.method when 'human' then 'Pablo' when 'api' then coalesce((select s.provider from claim_evidence e join source_records s on s.id = e.source_record_id where e.claim_id = c.id limit 1), 'an API')
          else coalesce((select o.name from claim_evidence e join source_records s on s.id = e.source_record_id join evidence_outlets o on o.key = s.provider where e.claim_id = c.id limit 1), 'research') end as source
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id join enrichment_terms t on t.id = c.term_id
      where c.work_id = ${workId}::uuid and d.key in (${list(dimensionKeys)}) and c.status in ('proposed', 'accepted')`,
  );
}

/**
 * Decides and proposes the values of one book (sections 4 to 6): per value,
 * its evidence, R6, the conflicts and the confidence; then the proposals,
 * each with all its evidence. A value that fails R6 is stored as rejected
 * (`not_independent`); an accepted value is not proposed again.
 */
async function decide(
  tx: Db,
  input: {
    workId: string;
    dimensions: Dimension[];
    version: number;
    runId: string;
    jobId: string | null;
    /** Evidence per dimension and term */
    values: Map<string, ValueEvidence[]>;
    names: Map<string, string>;
    /** A gold-set book: an error names no term */
    hidden: boolean;
  },
) {
  const counts = { proposed: 0, merged: 0, rejectedR6: 0, conflicts: 0, confirmed: 0 };
  const proposals: { dimension: string; term: string; confidence: number; outlet: string; excerpt: string }[] = [];
  const others = await otherValues(tx, input.workId, input.dimensions.map((d) => d.key));
  for (const dimension of input.dimensions) {
    const mine = [...input.values].filter(([key]) => key.startsWith(`${dimension.key}\u0000`));
    if (!mine.length) continue;
    const verified = new Map(mine.map(([key, evidence]) => [key.split("\u0000")[1], input.names.get(evidence[0].outlet) ?? evidence[0].outlet]));
    const notes = conflictsOf(dimension, verified, others.filter((o) => o.dimension === dimension.key && !verified.has(o.term)));
    const items = mine.map(([key, evidence]) => {
      const term = key.split("\u0000")[1];
      const { sources, passes } = checkIndependence(evidence);
      const conflict = notes.get(term);
      const r6 = dimension.independent && !passes;
      return {
        term,
        evidence,
        r6,
        conflict: Boolean(conflict),
        proposal: {
          workId: input.workId,
          dimension: dimension.key,
          value: { term },
          method: "agent" as const,
          confidence: researchConfidence({ sources, conflict: Boolean(conflict), support: null }),
          vocabularyVersion: input.version,
          runId: input.runId,
          jobId: input.jobId ?? undefined,
          note: conflict?.join("; ").slice(0, 2000),
          evidence: evidence.map((e) => ({
            locator: "text" as const,
            sourceRecordId: e.sourceRecordId,
            extractorVersion: e.extractorVersion,
            excerpt: e.excerpt,
            startOffset: e.start,
            endOffset: e.end,
            textSha256: e.textSha256,
            // Each row keeps the run that verified it, so that run's undo finds it
            runId: e.runId,
          })),
          ...(r6 ? { rejectAs: "not_independent" as const } : {}),
        },
      };
    });
    const results = await proposeClaims(
      items.map((i) => i.proposal),
      tx,
    );
    results.forEach((r, i) => {
      const item = items[i];
      if (r.status === "refused") throw new Error(`A ${dimension.key} proposal was refused${input.hidden ? "" : `: ${r.reason}`}`);
      if (r.status === "skipped") {
        if (r.reason === "already accepted") counts.confirmed++;
        return;
      }
      if (r.status === "merged") counts.merged++;
      else if (item.r6) counts.rejectedR6++;
      else counts.proposed++;
      if (item.conflict) counts.conflicts++;
      proposals.push({
        dimension: dimension.key,
        term: item.term,
        confidence: item.proposal.confidence,
        outlet: item.evidence[0].outlet,
        excerpt: clip(item.evidence[0].excerpt, 200),
      });
    });
  }
  return { counts, proposals };
}

/** A key of one value: its dimension and term */
const valueKey = (dimension: string, term: string) => `${dimension}\u0000${term}`;

export function extractStage(overrides: Partial<ExtractDeps> = {}): EnrichmentStage<ExtractPlan> {
  const deps = { ...DEFAULTS, ...overrides };
  const price = () => priceFor(EXTRACTION_MODEL.provider, "extract");

  const sweep: StageStep = {
    name: "Vocabulary sweep",
    plan: async (conn) => {
      const affected = await affectedByVocabulary(conn);
      return [`- ${affected.length} books to extract again for a vocabulary change`, ...affected.map((a) => `  - ${a.slug}: ${a.dimensions.join(", ")}`)];
    },
    apply: async (tx) => {
      const affected = await affectedByVocabulary(tx);
      for (const a of affected) await enqueueEnrichmentJob({ workId: a.workId, kind: "extract", reason: "vocabulary", dimensions: a.dimensions }, tx);
      // A retired research dimension is never extracted again: its open agent claims close here
      const closed = await rows<{ id: string }>(
        tx,
        sql`update enrichment_claims c set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'vocabulary_changed',
            note = 'its dimension was retired'
          from enrichment_dimensions d
          where d.id = c.dimension_id and c.method = 'agent' and c.status = 'proposed' and ${RESEARCH_DIMENSION}
            and not exists (select 1 from enrichment_dimensions d2 where d2.key = d.key and d2.retired_in is null)
          returning c.id`,
      );
      return [`- queued ${affected.length} books to extract again for a vocabulary change`, `- closed ${closed.length} open claims of retired dimensions`];
    },
  };

  return {
    kind: "extract",
    callsOut: true,

    preflight() {
      if (!deps.model()) throw new Error("Extraction needs ANTHROPIC_API_KEY: set it in .env.local (docs/13_CONFIGURATION.md)");
    },

    // The model is paid: its calls run per job in `work`, an apply only
    async fetch() {},

    async plan(conn, job) {
      const version = (await currentVocabularyVersion(conn)) ?? 0;
      const { profiles, skipped } = await loadProfiles(conn, [job.workId]);
      const profile = profiles[0] ?? null;
      // The job's dimensions (research names every research dimension; a vocabulary change those it touched), or all
      const keys = Array.isArray(job.payload.dimensions) ? (job.payload.dimensions as string[]) : [];
      const dimensions = version ? await extractDimensions(conn, version, keys) : [];
      const documents = profile ? await storedDocuments(conn, [job.workId]) : [];
      // A plan's estimate: characters for tokens, plus the full output cap
      const vocabularyChars = profile ? buildRequest(profile, dimensions, []).system[0].text.length : 0;
      const estimate = documents.reduce(
        (sum, d) =>
          sum +
          costOf(
            {
              input_tokens: Math.ceil((Math.min(d.textChars, RESEARCH_CONFIG.maxPassageChars) + vocabularyChars) / CHARS_PER_TOKEN),
              output_tokens: EXTRACTION_MODEL.maxOutputTokens,
            },
            price(),
          ),
        0,
      );
      const plan: ExtractPlan = {
        profile,
        skipped: profile ? null : (skipped[0]?.reason ?? "not a book"),
        version,
        dimensions,
        documents,
        estimate,
        spentThisMonth: await monthSpend(conn),
      };
      const summary = !profile
        ? `skipped: ${plan.skipped}`
        : `${documents.length} documents, ${dimensions.length} dimensions (${dimensions.map((d) => d.key).join(", ")}), estimate ${usd(estimate)} at most`;
      return { plan, summary };
    },

    async work(conn, job, plan, ctx) {
      if (!plan.profile || !plan.dimensions.length) return { ...plan, results: [] };
      const model = deps.model()!;
      const terms = new Map(plan.dimensions.map((d) => [d.key, new Set(d.terms.map((t) => t.key))]));
      // A change to an asked dimension makes every request new, so a vocabulary job writes rows at its version
      const revisions = Object.fromEntries(plan.dimensions.map((d) => [d.key, d.revision]));
      const results: DocumentResult[] = [];
      for (const document of plan.documents) {
        const result: DocumentResult = { document, status: "skipped", valuesReturned: 0, verified: [], failures: [] };
        results.push(result);
        // A hash mismatch skips the document; any other storage error fails the job, which retries
        const read = await readEvidenceText(document.textSha256, deps.objects).catch((error: Error) => {
          if (!error.message.includes("does not match its hash")) throw error;
          return null;
        });
        if (!read || read.status === "purged") {
          result.reason = read ? "its text was purged" : "its text does not match its hash";
          continue;
        }
        const text = read.value;
        if (text !== text.normalize("NFC")) {
          result.reason = "its text is not in Unicode NFC";
          continue;
        }
        const gate = aboutWork(text, plan.profile);
        if (!gate.about) {
          // Not sent: its row names the gate and the inputs it read
          const hash = sha256({ gate: PROMPT_VERSION, titles: plan.profile.titles, authors: plan.profile.authors, text: document.textSha256, revisions });
          if (await extractedBefore(conn, document.sourceRecordId, hash)) result.reason = "found not about the book before";
          else Object.assign(result, { status: "not_about_work", requestSha256: hash, passages: [] });
          continue;
        }
        const passages = passagesOf(text, gate.matches);
        const request = buildRequest(plan.profile, plan.dimensions, passages);
        const hash = requestHash(request, revisions);
        if (await extractedBefore(conn, document.sourceRecordId, hash)) {
          result.reason = "sent with this request before";
          continue;
        }
        const answer = await ask(conn, ctx, model, request, hash, { workId: job.workId, jobId: job.id });
        const values = valuesOf(answer, plan.dimensions);
        Object.assign(result, { requestSha256: hash, passages: passages.map(({ id, start, end }) => ({ id, start, end })) });
        if (!values) {
          result.status = "invalid_answer";
          continue;
        }
        result.status = "answered";
        result.valuesReturned = values.length;
        const chars = [...text];
        for (const value of values) {
          const verdict = verifyValue(value, { chars, passages, terms });
          if (verdict.ok) result.verified.push(verdict.value);
          else result.failures.push({ dimension: value.dimension, term: value.term, check: verdict.check, excerpt: clip(value.excerpt, 200) });
        }
      }
      return { ...plan, results };
    },

    async write(tx, job, plan, ctx) {
      if (!plan.profile) return { result: "skipped", reason: plan.skipped };
      const results = plan.results ?? [];
      const keys = plan.dimensions.map((d) => d.key);
      // First, the open claims of an asked dimension that changed after their version are closed
      const closed = keys.length
        ? await rows<{ id: string }>(
            tx,
            sql`update enrichment_claims c set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'vocabulary_changed',
                note = ${`vocabulary version ${plan.version} changed this dimension`}
              from enrichment_dimensions d
              where d.id = c.dimension_id and c.work_id = ${job.workId}::uuid and d.key in (${list(keys)}) and c.method = 'agent'
                and c.status = 'proposed' and c.vocabulary_version < ${revision(sql`d.key`, plan.version)}
              returning c.id`,
          )
        : [];
      for (const r of results.filter((x) => x.status !== "skipped"))
        await tx.execute(sql`insert into enrichment_extractions (work_id, source_record_id, vocabulary_version, dimension_keys, extractor_version, request_sha256,
            status, passages, values_returned, values_verified, failures, run_id, job_id)
          values (${job.workId}::uuid, ${r.document.sourceRecordId}::uuid, ${plan.version}, ${`{${keys.join(",")}}`}::text[], ${EXTRACTOR_VERSION},
            ${r.requestSha256!}, ${r.status}, ${JSON.stringify(r.passages ?? [])}::jsonb, ${r.valuesReturned}, ${r.verified.length},
            ${JSON.stringify(r.failures)}::jsonb, ${ctx.runId}::uuid, ${job.id}::uuid)`);

      // Each value: this run's verified evidence, and the earlier evidence of its open and R6-rejected claims
      const values = new Map<string, ValueEvidence[]>();
      const add = (key: string, row: ValueEvidence) => {
        const all = values.get(key) ?? [];
        if (!all.some((e) => e.sourceRecordId === row.sourceRecordId && e.excerpt === row.excerpt)) values.set(key, [...all, row]);
      };
      for (const r of results)
        for (const v of r.verified)
          add(valueKey(v.dimension, v.term), {
            sourceRecordId: r.document.sourceRecordId,
            method: "agent",
            outlet: r.document.outlet,
            outletKind: r.document.outletKind,
            weight: r.document.weight,
            syndicationGroup: r.document.syndicationGroup,
            byline: r.document.byline,
            fingerprint: r.document.fingerprint,
            excerpt: v.excerpt,
            start: v.start,
            end: v.end,
            textSha256: r.document.textSha256,
            extractorVersion: EXTRACTOR_VERSION,
            runId: ctx.runId,
          });
      const fresh = new Set(values.keys());
      for (const e of await earlierEvidence(tx, job.workId, keys)) if (fresh.has(valueKey(e.dimension, e.term))) add(valueKey(e.dimension, e.term), e);
      const names = new Map(plan.documents.map((d) => [d.outlet, d.outletName]));
      // A gold-set book's values stay hidden until Pablo labels it: counts only
      const hidden = GOLD_SET_WORK_IDS.includes(job.workId);
      const { counts, proposals } = await decide(tx, { workId: job.workId, dimensions: plan.dimensions, version: plan.version, runId: ctx.runId, jobId: job.id, values, names, hidden });

      const failures: Record<string, number> = {};
      for (const r of results) for (const f of r.failures) failures[f.check] = (failures[f.check] ?? 0) + 1;
      return {
        result: "extracted",
        documents: results.length,
        notAboutWork: results.filter((r) => r.status === "not_about_work").length,
        skipped: results.filter((r) => r.status === "skipped").map((r) => r.reason),
        calls: results.filter((r) => r.status === "answered" || r.status === "invalid_answer").length,
        invalidAnswers: results.filter((r) => r.status === "invalid_answer").length,
        valuesReturned: results.reduce((n, r) => n + r.valuesReturned, 0),
        valuesVerified: results.reduce((n, r) => n + r.verified.length, 0),
        failures,
        closed: closed.length,
        ...counts,
        outlets: Object.fromEntries(
          [...new Set(results.map((r) => r.document.outlet))].map((o) => [
            o,
            { about: results.filter((r) => r.document.outlet === o && r.status === "answered").length, verified: results.filter((r) => r.document.outlet === o).reduce((n, r) => n + r.verified.length, 0) },
          ]),
        ),
        ...(hidden ? { hidden: true } : { proposals }),
      };
    },

    steps: [sweep],

    summarize(plans) {
      const books = plans.filter((p) => p.profile);
      return [
        `## Extraction: ${books.length} books, ${plans.length - books.length} skipped`,
        `- Documents ${books.reduce((n, p) => n + p.documents.length, 0)}; estimate ${usd(books.reduce((sum, p) => sum + p.estimate, 0))} at most (each document at the full output cap)`,
        `- ${capLine(Math.max(0, ...plans.map((p) => p.spentThisMonth)))}; ceiling per book ${usd(RESEARCH_CONFIG.maxCostPerWork)}`,
      ];
    },

    async undo(tx, runId) {
      const undone = await rows<{ id: string }>(tx, sql`update enrichment_extractions set undone_at = now() where run_id = ${runId}::uuid and undone_at is null returning id`);
      // Every open claim holding this run's evidence is withdrawn, whichever run created it
      const withdrawn = await rows<{ id: string; workId: string; vocabularyVersion: number }>(
        tx,
        sql`update enrichment_claims c set status = 'rejected', decided_by = 'check', decided_at = now(), decision_reason = 'run_undone'
          where c.status = 'proposed' and c.method = 'agent' and exists (select 1 from claim_evidence e where e.claim_id = c.id and e.run_id = ${runId}::uuid)
          returning c.id, c.work_id as "workId", c.vocabulary_version as "vocabularyVersion"`,
      );
      // Their evidence from other runs is proposed again, so that work is kept
      let again = 0;
      const version = (await currentVocabularyVersion(tx)) ?? 0;
      for (const workId of new Set(withdrawn.map((w) => w.workId))) {
        const ids = withdrawn.filter((w) => w.workId === workId).map((w) => w.id);
        const kept = await rows<ValueEvidence & { dimension: string; term: string }>(
          tx,
          sql`select d.key as dimension, t.key as term, e.source_record_id as "sourceRecordId", 'agent' as method, o.key as outlet, o.kind as "outletKind",
              o.weight::float8 as weight, o.syndication_group as "syndicationGroup", s.payload ->> 'byline' as byline, s.payload -> 'fingerprint' as fingerprint,
              e.excerpt, e.start_offset as start, e.end_offset as "end", e.text_sha256 as "textSha256", e.extractor_version as "extractorVersion", e.run_id as "runId"
            from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id join enrichment_terms t on t.id = c.term_id
              join claim_evidence e on e.claim_id = c.id join source_records s on s.id = e.source_record_id join evidence_outlets o on o.key = s.provider
            where c.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}) and e.run_id <> ${runId}::uuid
              and not exists (select 1 from enrichment_extractions x where x.run_id = e.run_id and x.undone_at is not null)
              -- A retired dimension or term is not proposed again
              and d.retired_in is null and t.retired_in is null`,
        );
        if (!kept.length) continue;
        const dimensions = await extractDimensions(tx, version, [...new Set(kept.map((k) => k.dimension))]);
        // Each value goes back under the run of its newest remaining evidence
        for (const [key, evidence] of Object.entries(Object.groupBy(kept, (k) => valueKey(k.dimension, k.term)))) {
          const latestRun = evidence!.map((e) => e.runId).sort().at(-1)!;
          const { counts } = await decide(tx, {
            workId,
            dimensions,
            version,
            runId: latestRun,
            jobId: null,
            values: new Map([[key, evidence!]]),
            names: new Map(),
            hidden: GOLD_SET_WORK_IDS.includes(workId),
          });
          again += counts.proposed + counts.rejectedR6;
        }
      }
      return [`Extraction: ${undone.length} extractions undone; ${withdrawn.length} claims withdrawn; ${again} values proposed again from other runs' evidence`];
    },

    outcomes(outcomes) {
      const done = outcomes.filter((o) => o.result === "extracted");
      const sum = (key: string) => done.reduce((n, o) => n + Number(o[key] ?? 0), 0);
      const failures: Record<string, number> = {};
      for (const o of done) for (const [k, n] of Object.entries(o.failures as Record<string, number>)) failures[k] = (failures[k] ?? 0) + n;
      return [
        `## Extraction: what the run did (${done.length} books)`,
        `- Documents ${sum("documents")}, not about the book ${sum("notAboutWork")}; model calls ${sum("calls")}, invalid answers ${sum("invalidAnswers")}`,
        `- Values returned ${sum("valuesReturned")}, verified ${sum("valuesVerified")}; failed: ${Object.entries(failures).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
        `- Claims proposed ${sum("proposed")}, merged ${sum("merged")}, rejected for R6 ${sum("rejectedR6")}, in conflict ${sum("conflicts")}, confirmed ${sum("confirmed")}; closed for a vocabulary change ${sum("closed")}`,
        "## Extraction: proposals (gold-set books hidden)",
        ...done.flatMap((o) =>
          (o.proposals as { dimension: string; term: string; confidence: number; outlet: string; excerpt: string }[] | undefined)?.map(
            (p) => `- ${p.dimension} ${p.term} (${p.confidence}, ${p.outlet}): "${p.excerpt}"`,
          ) ?? [`- (a gold-set book: ${Number(o.proposed ?? 0) + Number(o.merged ?? 0)} proposals hidden)`],
        ),
      ];
    },

    async epilogue(conn) {
      const retired = await rows<{ slug: string; dimension: string; term: string }>(
        conn,
        sql`select w.slug, d.key as dimension, t.key as term from enrichment_claims c join works w on w.id = c.work_id
            join enrichment_dimensions d on d.id = c.dimension_id join enrichment_terms t on t.id = c.term_id
          where c.status = 'accepted' and c.method = 'agent' and t.retired_in is not null and not ${goldSetHiddenCondition(sql`c.work_id`)}
          order by w.slug, d.key, t.key`,
      );
      return [`## Accepted values whose term was retired, for Pablo (${retired.length})`, ...retired.map((r) => `- ${r.slug}: ${r.dimension} ${r.term}`)];
    },
  };

  /** One metered model call, from the run's cache when this request was answered before */
  async function ask(conn: Db, ctx: StageContext, model: ExtractionModel, request: ExtractionRequest, hash: string, ids: { workId: string; jobId: string }) {
    const cached = ctx.cache.get(`extract:${hash}`);
    if (cached) return (cached.answer as { answer: ModelAnswer }).answer;
    const estimate = { input_tokens: await model.countTokens(request), output_tokens: request.max_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    if ((await monthSpend(conn, { workId: ids.workId })) + costOf(estimate, price()) > RESEARCH_CONFIG.maxCostPerWork)
      throw new WorkCeilingStop(`The book's extraction would pass its ceiling of $${RESEARCH_CONFIG.maxCostPerWork} this month; its answers so far stay in the cache`);
    const answer = await metered(
      { database: conn, provider: EXTRACTION_MODEL.provider, operation: "extract", estimate, workId: ids.workId, jobId: ids.jobId, runId: ctx.runId },
      async () => {
        const a = await model.send(request);
        return { result: a, units: a.usage };
      },
    );
    // Kept before the rows are written: a crash does not pay twice
    ctx.cache.set(`extract:${hash}`, { request, answer });
    return answer;
  }
}

/**
 * Books to extract again for a vocabulary change (section 8): each book with
 * an extraction, and each current research dimension it was never extracted
 * for or whose revision is newer than its latest extraction of it.
 */
async function affectedByVocabulary(conn: Db) {
  const version = (await currentVocabularyVersion(conn)) ?? 0;
  return rows<{ workId: string; slug: string; dimensions: string[] }>(
    conn,
    sql`with latest as (
        select x.work_id, k.key, max(x.vocabulary_version) as version
        from enrichment_extractions x cross join unnest(x.dimension_keys) k(key) where x.undone_at is null group by x.work_id, k.key),
      books as (select distinct work_id from enrichment_extractions where undone_at is null),
      dimensions as (select d.key, ${revision(sql`d.key`, version)} as revision from enrichment_dimensions d where d.retired_in is null and ${RESEARCH_DIMENSION})
      select b.work_id as "workId", w.slug, array_agg(dm.key order by dm.key) as dimensions
      from books b cross join dimensions dm join works w on w.id = b.work_id
        left join latest l on l.work_id = b.work_id and l.key = dm.key
      where l.version is null or dm.revision > l.version
      group by b.work_id, w.slug order by w.slug`,
  );
}

/**
 * The determinism check (section 13): `n` answered requests of the cache sent
 * again through the meter and compared with their cached answers. Only cost
 * rows are written.
 */
export async function determinismCheck(conn: Db, options: { n: number; cache: SourceCache; runId: string; model: ExtractionModel }) {
  const entries = options.cache
    .entries()
    .filter(([key]) => key.startsWith("extract:"))
    .slice(0, options.n);
  const lines = [`## Determinism: ${entries.length} requests sent again`];
  for (const [key, cached] of entries) {
    const { request, answer } = cached.answer as { request: ExtractionRequest; answer: ModelAnswer };
    const again = await metered(
      {
        database: conn,
        provider: EXTRACTION_MODEL.provider,
        operation: "extract",
        estimate: { input_tokens: await options.model.countTokens(request), output_tokens: request.max_tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        runId: options.runId,
      },
      async () => {
        const a = await options.model.send(request);
        return { result: a, units: a.usage };
      },
    );
    const same = stableStringify(safeJson(answer.text)) === stableStringify(safeJson(again.text));
    lines.push(`- ${key.slice(8, 20)}: ${same ? "the same values" : "different values"}`);
  }
  return lines;
}

const safeJson = (text: string) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
