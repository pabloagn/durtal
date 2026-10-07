import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { db as appDb } from "@/lib/db";
import { atomicOn } from "@/lib/db/atomic";
import { uniqueConstraint, withReadableErrors } from "@/lib/db/errors";
import { assertSql, resultRows } from "@/lib/harmonization/store";
import { stableStringify } from "@/lib/harmonization/normalize";
import type { Db } from "@/lib/catalogue/work-store";
import {
  humanClaimSchema,
  proposalSchema,
  type EvidenceInput,
  type HumanClaimInput,
  type ProposalInput,
} from "@/lib/validations/enrichment";
import {
  SINGLE_VALUE_KINDS,
  type ClaimStatus,
  type DecisionReason,
  type EnrichmentApplyTarget,
  type EnrichmentValueKind,
} from "./model";
import { APPLY_TARGETS, type ApplyContext, type TargetValue } from "./targets";
import { claimColumns, proposalOutcome, ruleCap, type ClaimColumns } from "./rules";

/*
 * The enrichment services (SLN-462, section 5): proposing claims with their
 * evidence, applying one (by Pablo or an enabled rule), undoing an apply, and
 * Pablo's own edit. Each reads and checks first, makes its ids up front, then
 * writes in one atomic unit on the connection it is given: the app's database
 * (a Neon batch) or a script's postgres-js Drizzle connection (a transaction).
 */

type Row = Record<string, unknown>;
const uuid = (id: string) => sql`${id}::uuid`;
async function rows<T = Row>(conn: Db, query: SQL) {
  return resultRows<T>(await conn.execute(query));
}

/** One dimension, with the family its terms govern items of */
export interface DimensionRow {
  id: string;
  key: string;
  label: string;
  valueKind: EnrichmentValueKind;
  entityLevel: "work" | "edition";
  provider: string | null;
  applyTarget: EnrichmentApplyTarget;
  autoAcceptEligible: boolean;
  introducedIn: number;
  retiredIn: number | null;
  family: { id: string; isSystem: boolean; systemTable: string | null } | null;
}
const DIMENSION_COLUMNS = sql`d.id, d.key, d.label, d.value_kind as "valueKind", d.entity_level as "entityLevel",
  d.provider, d.apply_target as "applyTarget", d.auto_accept_eligible as "autoAcceptEligible",
  d.introduced_in as "introducedIn", d.retired_in as "retiredIn",
  case when f.id is null then null else jsonb_build_object('id', f.id, 'isSystem', f.is_system, 'systemTable', f.system_table) end as family`;

/** The dimension current in a version, by key */
async function dimensionAt(conn: Db, key: string, version: number) {
  const [d] = await rows<DimensionRow>(
    conn,
    sql`select ${DIMENSION_COLUMNS} from enrichment_dimensions d left join taxonomy_families f on f.id = d.taxonomy_family_id
      where d.key = ${key} and d.introduced_in <= ${version} and (d.retired_in is null or d.retired_in > ${version})
        and exists (select 1 from enrichment_vocabulary_versions v where v.version = ${version})`,
  );
  return d ?? null;
}

/** A term of a dimension current in a version, by key, with the item it governs */
async function termAt(conn: Db, dimensionId: string, key: string, version: number) {
  const [t] = await rows<{ id: string; scaleValue: number | null; itemId: string | null; workTypeId: string | null }>(
    conn,
    sql`select id, scale_value::float8 as "scaleValue", coalesce(system_item_id, custom_item_id) as "itemId", work_type_id as "workTypeId"
      from enrichment_terms where dimension_id = ${uuid(dimensionId)} and key = ${key}
      and introduced_in <= ${version} and (retired_in is null or retired_in > ${version})`,
  );
  return t ?? null;
}

/** The newest approved vocabulary version */
export async function currentVocabularyVersion(conn: Db = appDb) {
  const [r] = await rows<{ version: number | null }>(conn, sql`select max(version) as version from enrichment_vocabulary_versions`);
  return r.version;
}

/** A claim's state, as an apply records it in `before` and an undo restores it */
interface ClaimState {
  id: string;
  status: ClaimStatus;
  decidedBy: string | null;
  decidedAt: string | null;
  ruleId: string | null;
  supersededByClaimId: string | null;
  decisionReason: DecisionReason | null;
}
const STATE_COLUMNS = sql`id, status, decided_by as "decidedBy", decided_at::text as "decidedAt", rule_id as "ruleId",
  superseded_by_claim_id as "supersededByClaimId", decision_reason as "decisionReason"`;
const statesJson = (ids: string[]) =>
  ids.length
    ? sql`(select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'decidedBy', decided_by, 'decidedAt', decided_at::text,
        'ruleId', rule_id, 'supersededByClaimId', superseded_by_claim_id, 'decisionReason', decision_reason) order by id), '[]'::jsonb)
        from enrichment_claims where id in (${sql.join(ids.map(uuid), sql`, `)}))`
    : sql`'[]'::jsonb`;

/** A claim with what its target needs */
interface LoadedClaim extends ApplyContext {
  status: ClaimStatus;
  method: "api" | "agent" | "human";
  confidence: number;
  updatedAt: string;
  termId: string | null;
  dimensionRow: DimensionRow;
}
async function loadClaim(conn: Db, claimId: string): Promise<LoadedClaim | null> {
  const [c] = await rows<Row & { dimension: DimensionRow }>(
    conn,
    sql`select c.id, c.work_id as "workId", c.edition_id as "editionId", c.status, c.method, c.confidence::float8 as confidence,
        c.updated_at::text as "updatedAt", c.term_id as "termId", c.number_value::float8 as "numberValue", c.text_value as "textValue",
        c.place_id as "placeId", c.person_id as "personId",
        coalesce(t.system_item_id, t.custom_item_id) as "itemId", t.work_type_id as "workTypeId",
        (select to_jsonb(x) from (select ${DIMENSION_COLUMNS} from enrichment_dimensions d left join taxonomy_families f on f.id = d.taxonomy_family_id where d.id = c.dimension_id) x) as dimension
      from enrichment_claims c left join enrichment_terms t on t.id = c.term_id where c.id = ${uuid(claimId)}`,
  );
  if (!c) return null;
  const d = c.dimension;
  return {
    claimId,
    workId: c.workId as string,
    editionId: (c.editionId as string | null) ?? null,
    status: c.status as ClaimStatus,
    method: c.method as LoadedClaim["method"],
    confidence: c.confidence as number,
    updatedAt: c.updatedAt as string,
    termId: (c.termId as string | null) ?? null,
    itemId: (c.itemId as string | null) ?? null,
    workTypeId: (c.workTypeId as string | null) ?? null,
    numberValue: (c.numberValue as number | null) ?? null,
    textValue: (c.textValue as string | null) ?? null,
    placeId: (c.placeId as string | null) ?? null,
    personId: (c.personId as string | null) ?? null,
    dimensionRow: d,
    dimension: { id: d.id, valueKind: d.valueKind, applyTarget: d.applyTarget, provider: d.provider, family: d.family },
  };
}

function targetOf(applyTarget: EnrichmentApplyTarget) {
  const target = APPLY_TARGETS[applyTarget];
  if (!target.writer) target.write({ execute: () => undefined }, {} as ApplyContext, {});
  return target;
}

async function currentValue(conn: Db, ctx: ApplyContext): Promise<TargetValue> {
  const [r] = await rows<{ value: TargetValue }>(conn, targetOf(ctx.dimension.applyTarget).current(ctx));
  return r.value;
}

/** md5 of a claim, its evidence and its target's current value: what the inbox showed */
export function claimFingerprint(claim: { id: string; status: string; confidence: number; updatedAt: string }, evidenceIds: string[], value: unknown) {
  return createHash("md5")
    .update(stableStringify({ claim: [claim.id, claim.status, claim.confidence, claim.updatedAt], evidence: [...evidenceIds].sort(), value }))
    .digest("hex");
}
async function evidenceIds(conn: Db, claimId: string) {
  return (await rows<{ id: string }>(conn, sql`select id from claim_evidence where claim_id = ${uuid(claimId)}`)).map((r) => r.id);
}
/** A claim's fingerprint as the inbox computes it */
export async function currentFingerprint(conn: Db, claimId: string) {
  const claim = await loadClaim(conn, claimId);
  if (!claim) return null;
  const value = APPLY_TARGETS[claim.dimension.applyTarget].writer ? await currentValue(conn, claim) : null;
  return claimFingerprint({ ...claim, id: claim.claimId }, await evidenceIds(conn, claimId), value);
}

const SAME_VALUE = (alias: string, c: ClaimColumns & { workId: string; editionId: string | null; dimensionId: string }) =>
  sql`${sql.raw(alias)}.work_id = ${uuid(c.workId)} and ${sql.raw(alias)}.dimension_id = ${uuid(c.dimensionId)}
    and (${sql.raw(alias)}.edition_id, ${sql.raw(alias)}.term_id, ${sql.raw(alias)}.number_value, ${sql.raw(alias)}.text_value, ${sql.raw(alias)}.place_id, ${sql.raw(alias)}.person_id)
    is not distinct from (${c.editionId}::uuid, ${c.termId}::uuid, ${c.numberValue}::numeric, ${c.textValue}::text, ${c.placeId}::uuid, ${c.personId}::uuid)`;

// ── Apply ───────────────────────────────────────────────────────────────────

/** `batchId` groups applies: an inbox action's, or a worker run's (its run id) */
export type ApplyBy =
  | { by: "pablo"; batchId?: string; note?: string; fingerprint?: string }
  | { by: "rule"; ruleId: string; batchId?: string; note?: string; basis?: "exact_identifier_match" | "evaluation_gate" };

/** The claims an apply supersedes: open proposals, and on a single value the replaced one */
async function supersededBy(conn: Db, claim: LoadedClaim, columns: ClaimColumns) {
  const single = SINGLE_VALUE_KINDS.includes(claim.dimension.valueKind);
  const scope = sql`c.work_id = ${uuid(claim.workId)} and c.dimension_id = ${uuid(claim.dimension.id)} and c.edition_id is not distinct from ${claim.editionId}::uuid and c.id <> ${uuid(claim.claimId)}`;
  return rows<ClaimState>(
    conn,
    single
      ? sql`select ${STATE_COLUMNS} from enrichment_claims c where ${scope} and c.status in ('proposed', 'accepted') order by c.id`
      : sql`select ${STATE_COLUMNS} from enrichment_claims c where ${scope} and c.status = 'proposed'
          and ${SAME_VALUE("c", { ...columns, workId: claim.workId, editionId: claim.editionId, dimensionId: claim.dimension.id })} order by c.id`,
  );
}

interface ApplyPlan {
  claim: LoadedClaim;
  /** The claim's state before, or null for Pablo's new claim inserted by this apply */
  before: ClaimState | null;
  insertClaim?: (d: Db) => unknown;
  /** Evidence of Pablo's new claim, inserted with it */
  evidence?: (d: Db) => unknown[];
  current: TargetValue;
  superseded: ClaimState[];
  by: ApplyBy;
  applicationId: string;
}

/** The writes of one apply, for one atomic unit */
function applyQueries(d: Db, plan: ApplyPlan) {
  const { claim, by } = plan;
  const target = targetOf(claim.dimension.applyTarget);
  const decidedBy = by.by;
  const ruleId = by.by === "rule" ? by.ruleId : null;
  const ids = [claim.claimId, ...plan.superseded.map((s) => s.id)];
  const before = { value: plan.current, claims: [...(plan.before ? [plan.before] : []), ...plan.superseded] };
  return [
    d.execute(sql`select id from works where id = ${uuid(claim.workId)} for update`),
    ...(plan.insertClaim
      ? [plan.insertClaim(d), ...(plan.evidence?.(d) ?? [])]
      : [
          d.execute(sql`select id from enrichment_claims where id = ${uuid(claim.claimId)} for update`),
          d.execute(
            assertSql(
              sql`exists (select 1 from enrichment_claims where id = ${uuid(claim.claimId)} and status = 'proposed' and updated_at::text = ${claim.updatedAt})`,
              "The claim changed or was decided. Review it again.",
            ),
          ),
        ]),
    d.execute(
      assertSql(
        sql`(select value from (${target.current(claim)}) c) = ${JSON.stringify(plan.current)}::jsonb`,
        "The book's value changed. Review it again.",
      ),
    ),
    ...(ruleId
      ? [
          // One rule apply at a time, under its daily cap (R9): exact identity links count apart
          d.execute(sql`select pg_advisory_xact_lock(hashtext('enrichment_rule_apply'))`),
          d.execute(
            assertSql(
              sql`(select count(*) from enrichment_applications a join enrichment_auto_accept_rules r on r.id = a.rule_id
                where a.applied_by = 'rule' and a.applied_at > now() - interval '24 hours'
                and (r.basis = 'exact_identifier_match') = ${by.by === "rule" && by.basis === "exact_identifier_match"}) < ${ruleCap(by.by === "rule" ? (by.basis ?? "evaluation_gate") : "evaluation_gate")}`,
              "The daily cap on automatic applies is reached",
            ),
          ),
          d.execute(
            assertSql(
              sql`exists (select 1 from enrichment_auto_accept_rules where id = ${uuid(ruleId)} and enabled and dimension_id = ${uuid(claim.dimension.id)})`,
              "The rule is off",
            ),
          ),
        ]
      : []),
    ...target.write(d, claim, plan.current),
    ...(plan.insertClaim
      ? []
      : [
          d.execute(sql`update enrichment_claims set status = 'accepted', decided_by = ${decidedBy}, rule_id = ${ruleId}::uuid, decided_at = now()
            where id = ${uuid(claim.claimId)}`),
        ]),
    ...(plan.superseded.length
      ? [
          d.execute(sql`update enrichment_claims set status = 'superseded', superseded_by_claim_id = ${uuid(claim.claimId)},
              decided_by = ${decidedBy}, rule_id = ${ruleId}::uuid, decided_at = now(), decision_reason = null
            where id in (${sql.join(plan.superseded.map((s) => uuid(s.id)), sql`, `)}) and status in ('proposed', 'accepted')`),
        ]
      : []),
    d.execute(sql`insert into enrichment_applications (id, claim_id, work_id, edition_id, dimension_id, target, before, after, applied_by, rule_id, batch_id, note)
      values (${uuid(plan.applicationId)}, ${uuid(claim.claimId)}, ${uuid(claim.workId)}, ${claim.editionId}::uuid, ${uuid(claim.dimension.id)},
        ${claim.dimension.applyTarget}, ${JSON.stringify(before)}::jsonb,
        jsonb_build_object('value', (select value from (${target.current(claim)}) c), 'claims', ${statesJson(ids)}),
        ${decidedBy}, ${ruleId}::uuid, ${by.batchId ?? null}::uuid, ${by.note ?? null})`),
  ];
}

/**
 * Accepts one proposed claim and writes its value (R5): by Pablo, or by an
 * enabled rule that may only fill an empty target, under the daily cap.
 */
export async function applyClaim(claimId: string, by: ApplyBy, conn: Db = appDb) {
  const claim = await loadClaim(conn, claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "proposed") throw new Error("Only a proposed claim can be accepted");
  const target = targetOf(claim.dimension.applyTarget);
  const current = await currentValue(conn, claim);
  if (target.refuseFilled && target.filled(current, claim)) throw new Error(target.refuseFilled);
  if (by.by === "pablo" && by.fingerprint) {
    const now = claimFingerprint({ ...claim, id: claimId }, await evidenceIds(conn, claimId), current);
    if (now !== by.fingerprint) throw new Error("The claim, its evidence or the book's value changed. Review it again.");
  }
  if (by.by === "rule") {
    const [rule] = await rows<{ enabled: boolean; dimensionId: string; minimumConfidence: number; basis: "exact_identifier_match" | "evaluation_gate" }>(
      conn,
      sql`select enabled, dimension_id as "dimensionId", minimum_confidence::float8 as "minimumConfidence", basis from enrichment_auto_accept_rules where id = ${uuid(by.ruleId)}`,
    );
    if (!rule?.enabled || rule.dimensionId !== claim.dimension.id) throw new Error("The rule is off");
    if (claim.method === "human") throw new Error("A rule never applies Pablo's own claim");
    if (claim.confidence < rule.minimumConfidence) throw new Error("The claim's confidence is below the rule's minimum");
    const [undone] = await rows<{ undone: boolean }>(
      conn,
      sql`select exists (select 1 from enrichment_applications where claim_id = ${uuid(claimId)} and undone_at is not null) as undone`,
    );
    if (undone.undone) throw new Error("An undone value waits for Pablo's decision");
    if (target.filled(current, claim)) throw new Error("A rule never replaces a value that is already there");
    by = { ...by, basis: rule.basis };
  }
  const columns: ClaimColumns = {
    termId: claim.termId,
    numberValue: claim.numberValue,
    textValue: claim.textValue,
    placeId: claim.placeId,
    personId: claim.personId,
  };
  const [before] = await rows<ClaimState>(conn, sql`select ${STATE_COLUMNS} from enrichment_claims where id = ${uuid(claimId)}`);
  const plan: ApplyPlan = {
    claim,
    before,
    current,
    superseded: await supersededBy(conn, claim, columns),
    by,
    applicationId: randomUUID(),
  };
  await withReadableErrors(() => atomicOn(conn, (d) => applyQueries(d, plan)));
  return { applicationId: plan.applicationId, workId: claim.workId, claimId };
}

/**
 * Pablo's own edit: a human claim, accepted and applied at once. The claim it
 * replaces becomes superseded. `evidence` cites a source that confirms his
 * value, when one does.
 */
export async function createHumanClaim(
  input: HumanClaimInput,
  conn: Db = appDb,
  options: { batchId?: string; note?: string; evidence?: EvidenceInput[] } = {},
) {
  const parsed = humanClaimSchema.parse(input);
  const version = await currentVocabularyVersion(conn);
  if (!version) throw new Error("No vocabulary is loaded");
  const dimension = await dimensionAt(conn, parsed.dimension, version);
  if (!dimension) throw new Error(`Unknown or retired dimension: ${parsed.dimension}`);
  const term = "term" in parsed.value ? await termAt(conn, dimension.id, parsed.value.term, version) : null;
  if ("term" in parsed.value && !term) throw new Error(`Unknown or retired term: ${parsed.value.term}`);
  const columns = claimColumns(dimension.valueKind, parsed.value, term);
  const claimId = randomUUID();
  const claim: LoadedClaim = {
    claimId,
    workId: parsed.workId,
    editionId: parsed.editionId ?? null,
    status: "accepted",
    method: "human",
    confidence: 1,
    updatedAt: "",
    termId: columns.termId,
    itemId: term?.itemId ?? null,
    workTypeId: term?.workTypeId ?? null,
    numberValue: columns.numberValue,
    textValue: columns.textValue,
    placeId: columns.placeId,
    personId: columns.personId,
    dimensionRow: dimension,
    dimension: { id: dimension.id, valueKind: dimension.valueKind, applyTarget: dimension.applyTarget, provider: dimension.provider, family: dimension.family },
  };
  const target = targetOf(dimension.applyTarget);
  const current = await currentValue(conn, claim);
  if (target.refuseFilled && target.filled(current, claim)) throw new Error(target.refuseFilled);
  const note = parsed.note ?? options.note ?? null;
  const plan: ApplyPlan = {
    claim,
    before: null,
    insertClaim: (d) =>
      d.execute(sql`insert into enrichment_claims (id, work_id, edition_id, dimension_id, term_id, number_value, text_value, place_id, person_id,
          method, confidence, vocabulary_version, status, decided_by, decided_at, note)
        values (${uuid(claimId)}, ${uuid(claim.workId)}, ${claim.editionId}::uuid, ${uuid(dimension.id)}, ${columns.termId}::uuid,
          ${columns.numberValue}::numeric, ${columns.textValue}, ${columns.placeId}::uuid, ${columns.personId}::uuid,
          'human', 1, ${version}, 'accepted', 'pablo', now(), ${note})`),
    evidence: (d) => evidenceQueries(d, claimId, options.evidence ?? [], null),
    current,
    superseded: await supersededBy(conn, claim, columns),
    by: { by: "pablo", batchId: options.batchId, note: note ?? undefined },
    applicationId: randomUUID(),
  };
  await withReadableErrors(() => atomicOn(conn, (d) => applyQueries(d, plan)));
  return { claimId, applicationId: plan.applicationId, workId: claim.workId };
}

// ── Undo ────────────────────────────────────────────────────────────────────

/**
 * A claim that still has evidence: an edition delete may have taken it (and
 * an open or accepted API or agent claim needs evidence at commit)
 */
const HAS_EVIDENCE = sql`exists (select 1 from claim_evidence e where e.claim_id = c.id)`;

/**
 * Restores an apply's `before`: the target's value and the claim statuses.
 * Superseded proposals reopen, except one whose value has a newer open
 * claim; a human claim the apply created becomes rejected (`undone`).
 * Refused when the target changed since.
 */
export async function undoApplication(applicationId: string, conn: Db = appDb) {
  const [app] = await rows<{ claimId: string; undoneAt: string | null; before: { value: TargetValue; claims: ClaimState[] }; after: { value: TargetValue } }>(
    conn,
    sql`select claim_id as "claimId", undone_at::text as "undoneAt", before, after from enrichment_applications where id = ${uuid(applicationId)}`,
  );
  if (!app) throw new Error("Apply not found");
  if (app.undoneAt) throw new Error("This apply is undone already");
  const claim = await loadClaim(conn, app.claimId);
  if (!claim) throw new Error("Claim not found");
  if (claim.status === "rejected") throw new Error("A removal by hand is undone by adding the item again");
  const target = targetOf(claim.dimension.applyTarget);
  const current = await currentValue(conn, claim);
  if (stableStringify(current) !== stableStringify(app.after.value))
    throw new Error("The value changed since it was applied; undo it from its newer apply first");
  const own = app.before.claims.find((s) => s.id === app.claimId);
  const others = app.before.claims.filter((s) => s.id !== app.claimId);
  const restore = (d: Db, s: ClaimState) =>
    s.status === "proposed"
      ? d.execute(sql`update enrichment_claims c set status = 'proposed', decided_by = null, decided_at = null, rule_id = null, superseded_by_claim_id = null
          where c.id = ${uuid(s.id)} and c.status = 'superseded' and ${HAS_EVIDENCE} and not exists (
            select 1 from enrichment_claims n where n.status = 'proposed' and n.id <> c.id and n.work_id = c.work_id and n.dimension_id = c.dimension_id
              and (n.edition_id, n.term_id, n.number_value, n.text_value, n.place_id, n.person_id) is not distinct from (c.edition_id, c.term_id, c.number_value, c.text_value, c.place_id, c.person_id))`)
      : d.execute(sql`update enrichment_claims c set status = ${s.status}, decided_by = ${s.decidedBy}, decided_at = ${s.decidedAt}::timestamptz,
          rule_id = ${s.ruleId}::uuid, superseded_by_claim_id = ${s.supersededByClaimId}::uuid
          where c.id = ${uuid(s.id)} and c.status = 'superseded' and (c.method = 'human' or ${HAS_EVIDENCE})`);
  await withReadableErrors(() =>
    atomicOn(conn, (d) => [
      d.execute(sql`select id from works where id = ${uuid(claim.workId)} for update`),
      d.execute(sql`select id from enrichment_applications where id = ${uuid(applicationId)} for update`),
      d.execute(assertSql(sql`exists (select 1 from enrichment_applications where id = ${uuid(applicationId)} and undone_at is null)`, "This apply is undone already")),
      d.execute(
        assertSql(
          sql`(select value from (${target.current(claim)}) c) = ${JSON.stringify(app.after.value)}::jsonb`,
          "The value changed since it was applied; undo it from its newer apply first",
        ),
      ),
      // The claim leaves its acceptance first: its value row goes with the restore
      own
        ? d.execute(sql`update enrichment_claims set status = 'proposed', decided_by = null, decided_at = null, rule_id = null where id = ${uuid(app.claimId)}`)
        : d.execute(sql`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now(), rule_id = null, decision_reason = 'undone' where id = ${uuid(app.claimId)}`),
      ...target.restore(d, claim, app.before.value, app.after.value),
      ...others.map((s) => restore(d, s)),
      d.execute(sql`update enrichment_applications set undone_at = now() where id = ${uuid(applicationId)}`),
    ]),
  );
  return { applicationId, workId: claim.workId };
}

// ── Propose ─────────────────────────────────────────────────────────────────

/** The evidence rows of a claim; the outlet is its source record's provider */
function evidenceQueries(d: Db, claimId: string, evidence: EvidenceInput[], runId: string | null) {
  return evidence.map((e) =>
    d.execute(sql`insert into claim_evidence (claim_id, source_record_id, outlet, extractor_version, run_id, locator, excerpt, excerpt_sha256,
        start_offset, end_offset, text_sha256, payload_path)
      select ${uuid(claimId)}, s.id, s.provider, ${e.extractorVersion}, ${runId}::uuid, ${e.locator}, ${e.excerpt},
        encode(sha256(convert_to(${e.excerpt}, 'UTF8')), 'hex'),
        ${e.locator === "text" ? e.startOffset : null}::int, ${e.locator === "text" ? e.endOffset : null}::int,
        ${e.locator === "text" ? e.textSha256 : null}, ${e.locator === "payload" ? `{${e.payloadPath.map((s) => JSON.stringify(s)).join(",")}}` : null}::text[]
      from source_records s where s.id = ${uuid(e.sourceRecordId)}
      on conflict (claim_id, source_record_id, excerpt_sha256) do nothing`),
  );
}

export type ProposalResult =
  | { status: "created"; claimId: string }
  | { status: "merged"; claimId: string }
  | { status: "skipped"; reason: string }
  | { status: "refused"; reason: string };

/**
 * Writes proposals and their evidence, one atomic unit per item. A second
 * source of an open value adds its evidence there (R6) and sets the new
 * confidence. Evidence that fails a guard (R3) refuses the item: it never
 * becomes a claim.
 */
export async function proposeClaims(items: ProposalInput[], conn: Db = appDb): Promise<ProposalResult[]> {
  const results: ProposalResult[] = [];
  for (const item of items) results.push(await proposeOne(item, conn, true));
  return results;
}

async function proposeOne(input: ProposalInput, conn: Db, retry: boolean): Promise<ProposalResult> {
  const parsed = proposalSchema.safeParse(input);
  if (!parsed.success) return { status: "refused", reason: parsed.error.issues[0]?.message ?? "Invalid proposal" };
  const p = parsed.data;
  const dimension = await dimensionAt(conn, p.dimension, p.vocabularyVersion);
  if (!dimension) return { status: "refused", reason: `Unknown or retired dimension: ${p.dimension}` };
  const term = "term" in p.value ? await termAt(conn, dimension.id, p.value.term, p.vocabularyVersion) : null;
  if ("term" in p.value && !term) return { status: "refused", reason: `Unknown or retired term: ${p.value.term}` };
  let columns: ClaimColumns;
  try {
    columns = claimColumns(dimension.valueKind, p.value, term);
  } catch (error) {
    return { status: "refused", reason: (error as Error).message };
  }
  const sourceIds = [...new Set(p.evidence.map((e) => e.sourceRecordId))];
  if (p.method === "human") {
    const exported = sourceIds.length
      ? await rows<{ n: number }>(
          conn,
          sql`select count(*)::int as n from source_records where provider = 'storygraph_export' and id in (${sql.join(sourceIds.map(uuid), sql`, `)})`,
        )
      : [{ n: 0 }];
    if (!sourceIds.length || exported[0].n !== sourceIds.length)
      return { status: "refused", reason: "A proposed human claim cites only Pablo's own export" };
  }
  const editionId = p.editionId ?? null;
  const key = { ...columns, workId: p.workId, editionId, dimensionId: dimension.id };
  const same = await rows<{ id: string; status: ClaimStatus; decisionReason: DecisionReason | null; sourceIds: string[] }>(
    conn,
    sql`select c.id, c.status, c.decision_reason as "decisionReason",
        coalesce((select array_agg(distinct e.source_record_id::text) from claim_evidence e where e.claim_id = c.id), '{}') as "sourceIds"
      from enrichment_claims c where ${SAME_VALUE("c", key)}`,
  );
  let linked = false;
  if (dimension.applyTarget === "taxonomy" && term?.itemId) {
    const value = await currentValue(conn, {
      claimId: "",
      workId: p.workId,
      editionId,
      dimension: { id: dimension.id, valueKind: dimension.valueKind, applyTarget: dimension.applyTarget, provider: dimension.provider, family: dimension.family },
      itemId: term.itemId,
      workTypeId: null,
      ...columns,
    });
    linked = (value.items as string[]).includes(term.itemId);
  }
  const outcome = proposalOutcome({ claims: same, linked, sourceIds });
  if (outcome.kind === "skip") return { status: "skipped", reason: outcome.reason };
  const claimId = outcome.kind === "merge" ? outcome.claimId : randomUUID();
  const evidence = (d: Db) => evidenceQueries(d, claimId, p.evidence, p.runId ?? null);
  const rejected = p.rejectAs === "not_independent";
  try {
    await atomicOn(conn, (d) =>
      outcome.kind === "merge"
        ? [
            d.execute(sql`update enrichment_claims set confidence = ${p.confidence} where id = ${uuid(claimId)} and status = 'proposed'`),
            ...evidence(d),
          ]
        : [
            d.execute(sql`insert into enrichment_claims (id, work_id, edition_id, dimension_id, term_id, number_value, text_value, place_id, person_id,
                method, confidence, vocabulary_version, run_id, job_id, note, status, decided_by, decided_at, decision_reason)
              values (${uuid(claimId)}, ${uuid(p.workId)}, ${editionId}::uuid, ${uuid(dimension.id)}, ${columns.termId}::uuid, ${columns.numberValue}::numeric,
                ${columns.textValue}, ${columns.placeId}::uuid, ${columns.personId}::uuid, ${p.method}, ${p.confidence}, ${p.vocabularyVersion},
                ${p.runId ?? null}::uuid, ${p.jobId ?? null}::uuid, ${p.note ?? null},
                ${rejected ? "rejected" : "proposed"}, ${rejected ? "check" : null}, ${rejected ? sql`now()` : null}, ${rejected ? "not_independent" : null})`),
            ...evidence(d),
          ],
    );
  } catch (error) {
    // A concurrent run opened the same value first: add to it instead
    if (retry && uniqueConstraint(error) === "enrichment_claim_open_unique") return proposeOne(input, conn, false);
    const readable = withReadableMessage(error);
    if (readable) return { status: "refused", reason: readable };
    throw error;
  }
  return { status: outcome.kind === "merge" ? "merged" : "created", claimId };
}

/** A guard's message, for a refused proposal; null for an unexpected error */
function withReadableMessage(error: unknown): string | null {
  let current = error as { code?: unknown; message?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "23514" || current.code === "P0001" || current.code === "23503") return String(current.message);
    current = current.cause as typeof current;
  }
  return null;
}

/** Pablo rejects a proposed claim, on a connection (the inbox action checks its fingerprint first) */
export async function rejectClaim(claimId: string, decision: { reason: DecisionReason; note?: string }, conn: Db = appDb) {
  await withReadableErrors(() =>
    atomicOn(conn, (d) => [
      d.execute(sql`select id from enrichment_claims where id = ${uuid(claimId)} for update`),
      d.execute(assertSql(sql`exists (select 1 from enrichment_claims where id = ${uuid(claimId)} and status = 'proposed')`, "Only a proposed claim can be rejected")),
      d.execute(sql`update enrichment_claims set status = 'rejected', decided_by = 'pablo', decided_at = now(),
          decision_reason = ${decision.reason}, note = coalesce(${decision.note ?? null}, note)
        where id = ${uuid(claimId)}`),
    ]),
  );
}

// ── Read ────────────────────────────────────────────────────────────────────

export interface WorkEnrichmentClaim {
  id: string;
  dimension: string;
  dimensionLabel: string;
  editionId: string | null;
  term: string | null;
  termLabel: string | null;
  numberValue: number | null;
  textValue: string | null;
  placeId: string | null;
  personId: string | null;
  method: string;
  confidence: number;
  status: ClaimStatus;
  decidedBy: string | null;
  decisionReason: string | null;
  note: string | null;
  createdAt: string;
  evidence: { id: string; outlet: string; excerpt: string; url: string | null; retrievedAt: string; extractorVersion: string }[];
  /** md5 of the claim, its evidence and its target's current value */
  fingerprint: string;
}

/**
 * A book's claims with their evidence, its accepted values (links to governed
 * items and value rows) and its applies, newest first.
 */
export async function workEnrichment(workId: string, conn: Db = appDb) {
  const claims = await rows<Omit<WorkEnrichmentClaim, "fingerprint"> & { updatedAt: string }>(
    conn,
    sql`select c.id, d.key as dimension, d.label as "dimensionLabel", c.edition_id as "editionId", t.key as term, t.label as "termLabel",
        c.number_value::float8 as "numberValue", c.text_value as "textValue", c.place_id as "placeId", c.person_id as "personId",
        c.method, c.confidence::float8 as confidence, c.status, c.decided_by as "decidedBy", c.decision_reason as "decisionReason", c.note,
        c.created_at::text as "createdAt", c.updated_at::text as "updatedAt",
        coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'outlet', e.outlet, 'excerpt', e.excerpt, 'url', s.url,
            'retrievedAt', s.retrieved_at, 'extractorVersion', e.extractor_version) order by e.created_at, e.id)
          from claim_evidence e join source_records s on s.id = e.source_record_id where e.claim_id = c.id), '[]'::jsonb) as evidence
      from enrichment_claims c join enrichment_dimensions d on d.id = c.dimension_id left join enrichment_terms t on t.id = c.term_id
      where c.work_id = ${uuid(workId)} order by c.created_at desc, c.id`,
  );
  const withPrints: WorkEnrichmentClaim[] = [];
  for (const c of claims) {
    const { updatedAt, ...claim } = c;
    const loaded = await loadClaim(conn, c.id);
    const value = loaded && APPLY_TARGETS[loaded.dimension.applyTarget].writer ? await currentValue(conn, loaded) : null;
    withPrints.push({
      ...claim,
      fingerprint: claimFingerprint({ id: c.id, status: c.status, confidence: c.confidence, updatedAt }, c.evidence.map((e) => e.id), value),
    });
  }
  const links = await rows<{ dimension: string; term: string; itemId: string }>(
    conn,
    sql`select d.key as dimension, t.key as term, coalesce(t.system_item_id, t.custom_item_id) as "itemId"
      from enrichment_terms t join enrichment_dimensions d on d.id = t.dimension_id
      where t.retired_in is null and exists (select 1 from enrichment_claims c where c.term_id = t.id and c.work_id = ${uuid(workId)} and c.status = 'accepted')`,
  );
  const values = await rows<{ dimension: string; numberValue: number | null; placeId: string | null; claimId: string }>(
    conn,
    sql`select d.key as dimension, v.number_value::float8 as "numberValue", v.place_id as "placeId", v.claim_id as "claimId"
      from work_enrichment_values v join enrichment_dimensions d on d.id = v.dimension_id where v.work_id = ${uuid(workId)} order by d.key, v.id`,
  );
  const applications = await rows<{ id: string; claimId: string; target: string; appliedBy: string; batchId: string | null; note: string | null; appliedAt: string; undoneAt: string | null }>(
    conn,
    sql`select id, claim_id as "claimId", target, applied_by as "appliedBy", batch_id as "batchId", note, applied_at::text as "appliedAt", undone_at::text as "undoneAt"
      from enrichment_applications where work_id = ${uuid(workId)} order by applied_at desc, id`,
  );
  return { claims: withPrints, accepted: { links, values }, applications };
}
