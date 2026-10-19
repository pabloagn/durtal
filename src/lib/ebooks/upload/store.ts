import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db";
import { checkedInteger, checkedSourceSize, checkedSum, UPLOAD_LIMITS } from "./limits";
import { reservationBytes } from "./admission";
import { releaseEligibility, validateFence, type CleanupEvidence, type OperationFence } from "./lifecycle";
import { expectedPartBytes, partCount, type PartReceipt } from "./parts";
import { requireSha256, requireUuid } from "./runtime-contract";
import type { SpoolInventory } from "./private-spool";
import type { SupervisorHostLock } from "./host-lock";
import type { SupervisorOwner, SupervisorRecovery, UploadSupervisorPersistence } from "./supervisor";
import type { UploadState } from "../ingest/store";
import { boundedJsonBytes } from "./bounded-json";
import { uploadJobFailureSchema, type UploadJobFailure } from "./job-failure";

export interface UploadSqlExecutor {
  execute(query: SQL, signal?: AbortSignal): Promise<unknown>;
}

/** The actual Neon client, lazily obtained; parameterized Drizzle SQL, no new connection/env. */
export const uploadSqlExecutor: UploadSqlExecutor = {
  async execute(query, signal) {
    signal?.throwIfAborted();
    const compiled = new PgDialect().sqlToQuery(query);
    const deadline = AbortSignal.timeout(10_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    const result = await getDb().$client.query(compiled.sql, compiled.params, { fetchOptions: { signal: combined } });
    combined.throwIfAborted();
    // An aborted/lost response does not prove rollback. Callers keep charges held.
    return result;
  },
};

type Row = Record<string, unknown>;
function rows(result: unknown): Row[] {
  const values = Array.isArray(result) ? result : (result as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(values) || values.some((row) => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("Upload SQL result malformed");
  return values as Row[];
}
function one(result: unknown): Row {
  const values = rows(result);
  if (values.length !== 1) throw new Error("Upload compare-and-swap refused; resources remain held");
  return values[0];
}
function integer(value: unknown, name: string): number {
  if (typeof value === "string" && !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`Invalid ${name}`);
  if (typeof value !== "number" && typeof value !== "string") throw new Error(`Invalid ${name}`);
  return checkedInteger(Number(value), name);
}
function jsonObject(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Upload progress malformed");
  return value as Row;
}
function ownerFrom(row: Row): SupervisorOwner {
  const owner = { volumeId: String(row.volume_id), bindingSha256: String(row.binding_sha256), ownerToken: String(row.owner_token),
    ownerFence: integer(row.owner_fence, "owner fence"), leaseExpiresAt: integer(row.lease_ms, "owner lease") };
  requireUuid(owner.volumeId); requireUuid(owner.ownerToken); requireSha256(owner.bindingSha256);
  return owner;
}
const lease = sql`statement_timestamp() + interval '60 seconds'`;
const ownerColumns = sql`c.volume_id, c.binding_sha256, c.owner_token, c.owner_fence,
  floor(extract(epoch from c.owner_lease_expires_at) * 1000)::bigint::text as lease_ms`;

/** Alias c is always the actual capacity table, not a second admission ledger. */
export function uploadOwnerPredicate(owner: SupervisorOwner): SQL {
  requireUuid(owner.volumeId); requireUuid(owner.ownerToken); requireSha256(owner.bindingSha256);
  checkedInteger(owner.ownerFence, "owner fence");
  return sql`c.volume_id = ${owner.volumeId}::uuid and c.binding_sha256 = ${owner.bindingSha256}
    and c.owner_token = ${owner.ownerToken}::uuid and c.owner_fence = ${owner.ownerFence}
    and c.owner_lease_expires_at > statement_timestamp()`;
}
function operationPredicate(owner: SupervisorOwner, fence: OperationFence): SQL {
  validateFence(fence); requireUuid(fence.operationId); requireUuid(fence.ownerToken);
  if (fence.ownerToken !== owner.ownerToken || fence.ownerFence !== owner.ownerFence) throw new Error("Upload operation owner differs");
  return sql`o.id = ${fence.operationId}::uuid and o.volume_id = c.volume_id and o.binding_sha256 = c.binding_sha256
    and o.kind = 'upload' and o.generation = ${fence.generation} and o.reservation_released_at is null`;
}

/** Compact transport state lives in the reviewed operation's bounded progress JSON. */
export interface UploadTransportProgress {
  parts: Record<string, { bytes: number; sha256: string }>;
  assembled: { bytes: number; sha256: string } | null;
  grants: Record<string, number>;
  writers: Record<string, string>;
  corrupt: boolean;
}
export const emptyUploadTransport = (): UploadTransportProgress => ({ parts: {}, assembled: null, grants: {}, writers: {}, corrupt: false });
const emptyTransportJson = JSON.stringify(emptyUploadTransport());

export function readMultipartState(value: unknown, key: string): UploadState {
  const state = jsonObject(value);
  boundedJsonBytes(state, 4096);
  if (Object.keys(state).sort().join(',') !== 'bucket,credentialIdentity,key,partSize,region,uploadId'
    || state.key !== key || typeof key !== 'string' || key.length > 1024
    || !Number.isSafeInteger(state.partSize) || Number(state.partSize) < 5 * 1024 * 1024 || Number(state.partSize) > 16 * 1024 * 1024)
    throw new Error("Multipart state binding differs");
  for (const field of ['uploadId', 'bucket', 'region', 'credentialIdentity']) {
    const item = state[field];
    if (typeof item !== 'string' || !item.length || item.length > 1024 || /[\x00-\x1f]/.test(item)) throw new Error("Multipart state field differs");
  }
  return state as unknown as UploadState;
}

export function uploadPartKey(number: number): string { checkedInteger(number, "part number", 1, 512); return String(number).padStart(4, "0"); }
export function uploadPartPath(operationId: string, number: number): string { requireUuid(operationId); return `${operationId}/parts/${uploadPartKey(number)}`; }

export function readUploadTransport(progress: unknown, sourceBytes: number): UploadTransportProgress {
  checkedSourceSize(sourceBytes);
  const root = jsonObject(progress);
  if (root.uploadV1 === undefined) return emptyUploadTransport();
  const value = jsonObject(root.uploadV1);
  const parts = jsonObject(value.parts); const grants = jsonObject(value.grants); const writers = jsonObject(value.writers);
  if (typeof value.corrupt !== "boolean" || Object.keys(parts).length > partCount(sourceBytes) || Object.keys(grants).length > 1024
    || Object.keys(writers).length > UPLOAD_LIMITS.serverPartConcurrency) throw new Error("Upload transport state exceeds bounds");
  const decoded = emptyUploadTransport(); decoded.corrupt = value.corrupt;
  for (const [key, raw] of Object.entries(parts)) {
    const part = jsonObject(raw); const number = Number(key);
    if (key !== uploadPartKey(number) || part.bytes !== expectedPartBytes(sourceBytes, number) || typeof part.sha256 !== "string") throw new Error("Upload part receipt malformed");
    requireSha256(part.sha256); decoded.parts[key] = { bytes: part.bytes as number, sha256: part.sha256 };
  }
  for (const [key, raw] of Object.entries(grants)) {
    const category = allocationCategory(key, sourceBytes);
    const grant = integer(raw, "allocation grant");
    checkedInteger(grant, "file allocation grant", 1, Math.ceil(category.fileBytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes);
    decoded.grants[key] = grant;
  }
  const categoryTotals = new Map<string, number>();
  for (const [key, grant] of Object.entries(decoded.grants)) {
    const category = allocationCategory(key, sourceBytes);
    const total = checkedSum([categoryTotals.get(category.category) ?? 0, grant], "category allocation");
    if (total > category.ceiling) throw new Error("Persisted allocation category exceeds its envelope");
    categoryTotals.set(category.category, total);
  }
  for (const [key, token] of Object.entries(writers)) {
    if (!Object.hasOwn(decoded.grants, key) || typeof token !== "string") throw new Error("Upload writer lacks its durable grant");
    requireUuid(token); decoded.writers[key] = token;
  }
  if (value.assembled !== null) {
    const assembled = jsonObject(value.assembled);
    if (assembled.bytes !== sourceBytes || typeof assembled.sha256 !== "string") throw new Error("Assembled source receipt malformed");
    requireSha256(assembled.sha256); decoded.assembled = { bytes: sourceBytes, sha256: assembled.sha256 };
  }
  return decoded;
}

export function allocationCategory(key: string, sourceBytes: number): { category: string; ceiling: number; fileBytes: number } {
  checkedSourceSize(sourceBytes);
  if (/^parts\/[0-9]{4}$/.test(key)) {
    const number = Number(key.slice(6));
    if (key !== `parts/${uploadPartKey(number)}`) throw new Error("Invalid part allocation path");
    return { category: "parts", ceiling: Math.ceil(sourceBytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes,
      fileBytes: expectedPartBytes(sourceBytes, number) };
  }
  if (key === "assembled/source") return { category: "assembled", ceiling: Math.ceil(sourceBytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes, fileBytes: sourceBytes };
  if (/^(metadata|derived|scratch)\/[a-z0-9][a-z0-9_.-]{0,63}$/.test(key)) {
    const category = key.split("/", 1)[0];
    const ceiling = category === "metadata" ? UPLOAD_LIMITS.itemMetadataBytes : category === "derived" ? UPLOAD_LIMITS.derivedBytes : UPLOAD_LIMITS.scratchBytes;
    return { category, ceiling, fileBytes: Math.min(ceiling, UPLOAD_LIMITS.partBytes) };
  }
  throw new Error("Allocation path is outside the upload protocol");
}

/** Owns only upload transport/capacity rows. Catalogue effects stay in the actual ingest services. */
export class PostgresUploadStore implements UploadSupervisorPersistence {
  constructor(private readonly input: { hostId: string; processId: number; processStartedAt: string; hostLock: SupervisorHostLock; executor?: UploadSqlExecutor }) {
    requireUuid(input.hostId); requireUuid(input.processStartedAt); checkedInteger(input.processId, "supervisor process id", 1);
  }
  private get executor(): UploadSqlExecutor { return this.input.executor ?? uploadSqlExecutor; }
  private async execute(query: SQL, signal?: AbortSignal): Promise<unknown> {
    this.input.hostLock.assertHeld(); signal?.throwIfAborted();
    const result = await this.executor.execute(query, signal);
    signal?.throwIfAborted(); this.input.hostLock.assertHeld();
    return result;
  }

  async beginRecovery(input: { volumeId: string; bindingSha256: string; ownerToken: string; now: number }): Promise<SupervisorRecovery> {
    requireUuid(input.volumeId); requireUuid(input.ownerToken); requireSha256(input.bindingSha256); checkedInteger(input.now, "recovery clock");
    const identity = JSON.stringify({ hostId: this.input.hostId, processId: this.input.processId, processStartedAt: this.input.processStartedAt, ownershipPort: this.input.hostLock.port });
    const result = one(await this.execute(sql`with acquired as (
      insert into ebook_upload_capacity as c (volume_id, binding_sha256, owner_token, owner_fence, owner_identity, owner_lease_expires_at)
      values (${input.volumeId}::uuid, ${input.bindingSha256}, ${input.ownerToken}::uuid, 1, ${identity}::jsonb, ${lease})
      on conflict (volume_id) do update set owner_token = excluded.owner_token, owner_fence = c.owner_fence + 1,
        owner_identity = excluded.owner_identity, owner_lease_expires_at = excluded.owner_lease_expires_at,
        state = 'recovering', revision = c.revision + 1, updated_at = statement_timestamp(),
        worker_state = case when c.worker_state = 'idle' then 'idle' else 'quiescing' end
      where c.binding_sha256 = excluded.binding_sha256 and (c.owner_token is null
        or c.owner_lease_expires_at <= statement_timestamp() or c.owner_identity ->> 'hostId' = ${this.input.hostId})
      returning c.*
    ), fenced as (
      update ebook_upload_operations o set generation = o.generation + 1, lease_token = null, lease_expires_at = null,
        revision = o.revision + 1, updated_at = statement_timestamp(),
        state = case when o.state = 'processing' then 'quiescing' else o.state end
      from acquired c where o.volume_id = c.volume_id and o.kind = 'upload' and o.reservation_released_at is null
      returning o.id, o.generation, o.reserved_bytes
    ) select ${ownerColumns}, coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'generation', f.generation::text,
      'retained', f.reserved_bytes > 0)) from fenced f), '[]'::jsonb) as operations from acquired c`));
    const owner = ownerFrom(result);
    if (!Array.isArray(result.operations) || result.operations.length > 1024) throw new Error("Recovery operation inventory exceeds bounds");
    return { owner, operations: result.operations.map((raw) => {
      const item = jsonObject(raw); const operationId = String(item.id); requireUuid(operationId);
      if (typeof item.retained !== "boolean") throw new Error("Recovery retention malformed");
      return { fence: { operationId, ownerToken: owner.ownerToken, ownerFence: owner.ownerFence, generation: integer(item.generation, "operation generation") }, retained: item.retained };
    }) };
  }

  async assertOwner(owner: SupervisorOwner, now: number): Promise<void> {
    checkedInteger(now, "owner clock");
    one(await this.execute(sql`select ${ownerColumns} from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state in ('ready', 'recovering', 'quiescing')`));
  }
  async assertOperation(owner: SupervisorOwner, fence: OperationFence, now: number): Promise<void> {
    checkedInteger(now, "operation clock");
    one(await this.execute(sql`select o.id from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id = c.volume_id
      where ${uploadOwnerPredicate(owner)} and ${operationPredicate(owner, fence)} and c.worker_operation_id = o.id
      and c.worker_token = o.lease_token and c.worker_lease_expires_at > statement_timestamp()
      and o.lease_expires_at > statement_timestamp() and c.worker_state in ('running', 'quiescing')`));
  }
  async recordJobFailure(owner: SupervisorOwner, fence: OperationFence, failure: UploadJobFailure): Promise<void> {
    const { reason, what } = uploadJobFailureSchema.parse(failure);
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state in ('ready','quiescing')
        and c.worker_operation_id = ${fence.operationId}::uuid and c.worker_state in ('running','quiescing')
        and c.worker_lease_expires_at > statement_timestamp() for update
    ), operation as materialized (
      select o.* from ebook_upload_operations o join locked c on o.volume_id = c.volume_id
      where ${operationPredicate(owner, fence)} and o.lease_token = c.worker_token
        and o.lease_expires_at > statement_timestamp() for update of o
    ), failed as (
      update ebook_upload_operations o set state = 'failed',
        progress = jsonb_set(o.progress, '{jobFailureV1}', jsonb_build_object('generation', ${fence.generation}, 'code', 'upload_job_failed',
          'reason', ${reason}::text, 'what', ${what}::text), true),
        revision = o.revision + 1, updated_at = statement_timestamp()
      from operation observed where o.id = observed.id and observed.receipt is null
        and observed.state in ('processing','quiescing') returning o.id
    ) select o.id from operation o`));
  }
  async heartbeat(owner: SupervisorOwner, fence: OperationFence | null, now: number, signal?: AbortSignal): Promise<SupervisorOwner> {
    checkedInteger(now, "heartbeat clock");
    const active = fence ? operationPredicate(owner, fence) : sql`false`;
    return ownerFrom(one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state in ('ready', 'recovering') for update
    ), renewed_operation as (
      update ebook_upload_operations o set lease_expires_at = ${lease}, revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where ${active} and c.worker_operation_id = o.id and c.worker_token = o.lease_token
        and o.state in ('processing', 'ready', 'completed')
        and c.worker_state = 'running' and c.worker_lease_expires_at > statement_timestamp() and o.lease_expires_at > statement_timestamp()
      returning o.id
    ) update ebook_upload_capacity c set owner_lease_expires_at = ${lease},
      worker_lease_expires_at = case when c.worker_state = 'running' then ${lease} else c.worker_lease_expires_at end,
      revision = c.revision + 1, updated_at = statement_timestamp()
    from locked l where c.volume_id = l.volume_id and (${fence !== null}
      and (exists (select 1 from renewed_operation) or l.worker_state = 'idle' and exists (
        select 1 from ebook_upload_operations o where ${active} and o.lease_token is null and o.cleanup_verified_at is not null
          and l.cleanup_proof #>> '{fence,operationId}' = o.id::text
          and (l.cleanup_proof #>> '{fence,generation}')::bigint = o.generation
          and l.cleanup_proof #>> '{fence,ownerToken}' = ${owner.ownerToken}
          and (l.cleanup_proof #>> '{fence,ownerFence}')::bigint = ${owner.ownerFence}
      )) or ${fence === null} and (l.state = 'recovering' or l.worker_state = 'idle'))
    returning ${ownerColumns}`, signal)));
  }

  async reconcile(owner: SupervisorOwner, inventory: SpoolInventory): Promise<void> {
    this.validateInventory(inventory);
    const operations = rows(await this.execute(sql`select o.id, o.source_size_bytes::text, o.reserved_bytes::text, o.progress
      from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id = c.volume_id
      where ${uploadOwnerPredicate(owner)} and c.state = 'recovering' and o.kind = 'upload' and o.reservation_released_at is null
      order by o.id limit 1025`));
    if (operations.length > 1024) throw new Error("Reconciliation operation inventory exceeds bounds");
    const files = new Map(inventory.files.map((file) => [file.relativePath, file]));
    let knownAllocated = 0;
    const updates: SQL[] = [];
    for (const row of operations) {
      const id = String(row.id); requireUuid(id);
      const sourceBytes = checkedSourceSize(integer(row.source_size_bytes, "source bytes"));
      const transport = readUploadTransport(row.progress, sourceBytes);
      let corrupt = transport.corrupt;
      for (const [key, receipt] of Object.entries(transport.parts)) {
        const file = files.get(uploadPartPath(id, Number(key)));
        if (!file || file.bytes !== receipt.bytes || file.sha256 !== receipt.sha256) corrupt = true;
      }
      if (transport.assembled) {
        const file = files.get(`${id}/assembled/source`);
        if (!file || file.bytes !== transport.assembled.bytes || file.sha256 !== transport.assembled.sha256) corrupt = true;
      }
      for (const [key, grant] of Object.entries(transport.grants)) {
        const file = files.get(`${id}/${key}`);
        if (file) {
          if (file.allocatedBytes > grant) throw new Error("Actual file allocation exceeds its persisted grant");
          knownAllocated = checkedSum([knownAllocated, file.allocatedBytes], "known allocation");
          if (key.startsWith("parts/") && !Object.hasOwn(transport.parts, key.slice(6))) corrupt = true;
          if (key === "assembled/source" && !transport.assembled) corrupt = true;
        }
      }
      // Root ownership + inspector exit + I/O barrier precede this method. Stale
      // writer tokens are cleared only here, after actual allocations were hashed.
      const reconciled = { ...transport, writers: {}, corrupt };
      // A lost pre-create grant response can leave no file at all. With all
      // trees/streams settled and the complete inventory proved, that unused
      // path grant can be removed without releasing the item's reservation.
      for (const key of Object.keys(reconciled.grants)) {
        if (!files.has(`${id}/${key}`) && !(key.startsWith("parts/") && Object.hasOwn(reconciled.parts, key.slice(6)))
          && !(key === "assembled/source" && reconciled.assembled)) delete reconciled.grants[key];
      }
      updates.push(sql`(${id}::uuid, ${JSON.stringify(reconciled)}::jsonb)`);
    }
    const unaccounted = inventory.allocatedBytes - knownAllocated;
    checkedInteger(unaccounted, "unaccounted allocation");
    const changed = updates.length ? sql`, reconciled as (
      update ebook_upload_operations o set progress = jsonb_set(o.progress, '{uploadV1}', v.transport, true),
        revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c, (values ${sql.join(updates, sql`, `)}) as v(id, transport)
      where o.id = v.id and o.volume_id = c.volume_id returning o.id
    )` : sql``;
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'recovering'
        and c.reserved_bytes + ${unaccounted} <= c.quota_bytes
        and c.reserved_bytes = c.global_allowance_bytes + coalesce((select sum(o.reserved_bytes) from ebook_upload_operations o where o.volume_id = c.volume_id), 0) for update
    ) ${changed}
    update ebook_upload_capacity c set active_part_writers = 0, allocated_bytes = ${inventory.allocatedBytes}, available_bytes = ${inventory.availableBytes},
      unaccounted_bytes = ${unaccounted}, measured_at = statement_timestamp(), measurement_generation = c.measurement_generation + 1,
      cleanup_proof = ${JSON.stringify({ inventorySha256: inventory.sha256, stage: "reconciled", grantAvailableBytes: inventory.availableBytes })}::jsonb,
      revision = c.revision + 1, updated_at = statement_timestamp()
    from locked l where c.volume_id = l.volume_id returning c.volume_id`));
  }

  async persistCleanupAndReleaseWorker(owner: SupervisorOwner, evidence: Omit<CleanupEvidence, "proofPersisted">, inventorySha256: string): Promise<void> {
    requireSha256(inventorySha256);
    if (!releaseEligibility(evidence.fence, { ...evidence, proofPersisted: true }).worker) throw new Error("Cleanup evidence is incomplete");
    const proof = JSON.stringify({ ...evidence, proofPersisted: true, inventorySha256 });
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.active_part_writers = 0 for update
    ), proved as (
      update ebook_upload_operations o set cleanup_verified_at = statement_timestamp(), lease_token = null, lease_expires_at = null,
        state = case when o.state not in ('completed', 'canceled', 'expired') and coalesce((o.progress #>> '{uploadV1,corrupt}')::boolean, false) then 'failed'
          when o.state in ('processing', 'quiescing') then
          case when o.progress #> '{uploadV1,assembled}' is not null and o.progress #> '{uploadV1,assembled}' <> 'null'::jsonb then 'ready' else 'receiving' end
          else o.state end,
        revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where ${operationPredicate(owner, evidence.fence)} and
        (c.worker_operation_id is null or c.worker_operation_id = o.id or c.state = 'recovering') returning o.id
    ) update ebook_upload_capacity c set cleanup_proof = coalesce(c.cleanup_proof, '{}'::jsonb) || ${proof}::jsonb,
      worker_state = case when c.worker_operation_id = ${evidence.fence.operationId}::uuid then 'idle' else c.worker_state end,
      worker_operation_id = case when c.worker_operation_id = ${evidence.fence.operationId}::uuid then null else c.worker_operation_id end,
      worker_token = case when c.worker_operation_id = ${evidence.fence.operationId}::uuid then null else c.worker_token end,
      worker_lease_expires_at = case when c.worker_operation_id = ${evidence.fence.operationId}::uuid then null else c.worker_lease_expires_at end,
      revision = c.revision + 1, updated_at = statement_timestamp()
    from locked l where c.volume_id = l.volume_id and exists (select 1 from proved) returning c.volume_id`));
  }

  async markReady(owner: SupervisorOwner, inventory: SpoolInventory, now: number): Promise<void> {
    checkedInteger(now, "readiness clock"); this.validateInventory(inventory);
    one(await this.execute(sql`update ebook_upload_capacity c set state = 'ready', revision = c.revision + 1, updated_at = statement_timestamp()
      where ${uploadOwnerPredicate(owner)} and c.state = 'recovering' and c.active_part_writers = 0 and c.worker_state = 'idle'
        and c.allocated_bytes = ${inventory.allocatedBytes} and c.available_bytes = ${inventory.availableBytes}
        and c.cleanup_proof ->> 'inventorySha256' = ${inventory.sha256}
        and c.reserved_bytes + c.unaccounted_bytes <= c.quota_bytes and c.available_bytes >= c.free_reserve_bytes
      returning c.volume_id`));
  }
  async markQuiescing(owner: SupervisorOwner, reason: string, now: number): Promise<void> {
    checkedInteger(now, "quiescence clock");
    one(await this.execute(sql`with quiesced as (
      update ebook_upload_capacity c set state = 'quiescing', worker_state = case when c.worker_state = 'idle' then 'idle' else 'quiescing' end,
        revision = c.revision + 1, updated_at = statement_timestamp()
      where ${uploadOwnerPredicate(owner)} returning c.volume_id
    ), fenced as (
      update ebook_upload_operations o set state = case when o.state = 'processing' then 'quiescing' else o.state end,
        progress = jsonb_set(o.progress, '{quiescenceReason}', to_jsonb(${reason.slice(0, 256)}::text), true),
        revision = o.revision + 1, updated_at = statement_timestamp()
      from quiesced c where o.volume_id = c.volume_id and o.kind = 'upload' and o.reservation_released_at is null returning o.id
    ) select volume_id from quiesced`));
  }

  /** Caller holds the own-writer barrier and supplies its newly measured revision. */
  async admit(owner: SupervisorOwner, fence: OperationFence, input: { sourceBytes: number; revision: number; measuredAt: number; inventory: SpoolInventory }): Promise<void> {
    const bytes = reservationBytes(input.sourceBytes); checkedInteger(input.revision, "admission revision"); this.validateInventory(input.inventory);
    checkedInteger(input.measuredAt, "admission measurement time");
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready'
        and c.revision = ${input.revision} and c.active_part_writers = 0 and c.worker_state = 'idle'
        and to_timestamp(${input.measuredAt}::double precision / 1000) between statement_timestamp() - interval '1 second' and statement_timestamp()
        and (select count(*) from ebook_upload_operations q where q.volume_id = c.volume_id and q.kind = 'upload' and q.reservation_released_at is null) <= 1024
        and c.reserved_bytes + c.unaccounted_bytes + ${bytes} <= c.quota_bytes
        and ${input.inventory.availableBytes} >= c.free_reserve_bytes
        and greatest(0, c.reserved_bytes + c.unaccounted_bytes + ${bytes} - ${input.inventory.allocatedBytes})
          <= ${input.inventory.availableBytes} - c.free_reserve_bytes for update
    ), admitted as (
      update ebook_upload_operations o set reserved_bytes = ${bytes}, state = 'admitted', retention_expires_at = statement_timestamp() + interval '48 hours',
        revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where ${operationPredicate(owner, fence)} and o.state = 'queued' and o.reserved_bytes = 0 and o.source_size_bytes = ${input.sourceBytes}
      returning o.id
    ) update ebook_upload_capacity c set reserved_bytes = c.reserved_bytes + ${bytes}, allocated_bytes = ${input.inventory.allocatedBytes},
      available_bytes = ${input.inventory.availableBytes}, measured_at = statement_timestamp(), measurement_generation = c.measurement_generation + 1,
      cleanup_proof = jsonb_set(coalesce(c.cleanup_proof, '{}'::jsonb), '{grantAvailableBytes}', to_jsonb(${input.inventory.availableBytes}::bigint), true),
      revision = c.revision + 1, updated_at = statement_timestamp()
    from locked l where c.volume_id = l.volume_id and exists (select 1 from admitted) returning c.volume_id`));
  }

  async claimNext(owner: SupervisorOwner, workerToken: string, targetFingerprint: string): Promise<OperationFence | null> {
    requireUuid(workerToken); requireSha256(targetFingerprint);
    const result = rows(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready'
        and c.worker_state = 'idle' and c.active_part_writers = 0 for update
    ), claimed as (
      update ebook_upload_operations o set state = 'processing', generation = o.generation + 1, lease_token = ${workerToken}::uuid, lease_expires_at = ${lease},
        revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where o.id = (select q.id from ebook_upload_operations q where q.volume_id = c.volume_id and q.kind = 'upload'
        and q.state = 'ready' and q.reserved_bytes > 0 and q.receipt is null and q.reservation_released_at is null
        and q.progress #> '{uploadV1,assembled}' is not null and q.progress #> '{uploadV1,assembled}' <> 'null'::jsonb
        and q.progress #>> '{uploadV1,assembled,sha256}' = q.input ->> 'sha256'
        and (q.progress #>> '{uploadV1,assembled,bytes}')::bigint = q.source_size_bytes
        and coalesce(q.progress #> '{uploadV1,writers}', '{}'::jsonb) = '{}'::jsonb
        and q.target_fingerprint = ${targetFingerprint}
        and q.binding_sha256 = c.binding_sha256
        and coalesce((q.progress #>> '{uploadV1,corrupt}')::boolean, true) = false
        and exists (select 1 from ebook_upload_operations complete where complete.parent_operation_id = q.id
          and complete.kind = 'complete' and complete.volume_id = q.volume_id
          and complete.binding_sha256 = q.binding_sha256 and complete.target_fingerprint = q.target_fingerprint
          and complete.protocol_version = q.protocol_version and complete.state = 'completed'
          and complete.receipt is not null and complete.receipt_status = 200
          and complete.input ->> 'action' = 'complete' and complete.input ->> 'sha256' = q.input ->> 'sha256')
        order by q.created_at, q.id limit 1)
      returning o.id, o.generation
    ), occupied as (
      update ebook_upload_capacity c set worker_operation_id = o.id, worker_token = ${workerToken}::uuid, worker_state = 'running', worker_lease_expires_at = ${lease},
        revision = c.revision + 1, updated_at = statement_timestamp()
      from locked l, claimed o where c.volume_id = l.volume_id returning c.volume_id
    ) select o.id, o.generation::text from claimed o where exists (select 1 from occupied)`));
    if (!result.length) return null;
    const row = one(result); const operationId = String(row.id); requireUuid(operationId);
    return { operationId, generation: integer(row.generation, "claimed generation"), ownerToken: owner.ownerToken, ownerFence: owner.ownerFence };
  }

  /** Multipart state is transport custody, not a catalogue plan or receipt.
   * Writes use the same worker lease; losing a response retains resumable state.
   */
  async multipartState(owner: SupervisorOwner, fence: OperationFence, key: string): Promise<UploadState | null> {
    await this.assertOperation(owner, fence, Date.now());
    const digest = createHash("sha256").update(key).digest("hex");
    const row = one(await this.execute(sql`select o.progress #> array['multipartV1', ${digest}] as state
      from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id = c.volume_id
      where ${uploadOwnerPredicate(owner)} and ${operationPredicate(owner, fence)}`));
    if (row.state === null || row.state === undefined) return null;
    return readMultipartState(row.state, key);
  }
  async setMultipartState(owner: SupervisorOwner, fence: OperationFence, key: string, state: UploadState | null): Promise<void> {
    if (state) readMultipartState(state, key);
    const digest = createHash("sha256").update(key).digest("hex");
    const value = JSON.stringify(state);
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready'
        and c.worker_state = 'running' and c.worker_operation_id = ${fence.operationId}::uuid
        and c.worker_lease_expires_at > statement_timestamp() for update
    ) update ebook_upload_operations o set progress = case when ${state === null}
      then o.progress #- array['multipartV1', ${digest}]
      else jsonb_set(jsonb_set(o.progress, '{multipartV1}', coalesce(o.progress -> 'multipartV1', '{}'::jsonb), true),
        array['multipartV1', ${digest}], ${value}::jsonb, true) end,
      revision = o.revision + 1, updated_at = statement_timestamp()
    from locked c where ${operationPredicate(owner, fence)} and o.state = 'processing'
      and o.lease_token = c.worker_token and o.lease_expires_at > statement_timestamp()
      and (o.progress #> array['multipartV1', ${digest}] is not null
        or (select count(*) from jsonb_each(coalesce(o.progress -> 'multipartV1', '{}'::jsonb))) < 8)
    returning o.id`));
  }

  async acknowledgePart(owner: SupervisorOwner, fence: OperationFence, receipt: PartReceipt): Promise<void> {
    requireSha256(receipt.sha256); checkedInteger(receipt.bytes, "part receipt bytes", 1, UPLOAD_LIMITS.partBytes);
    const key = uploadPartKey(receipt.number); const value = JSON.stringify({ bytes: receipt.bytes, sha256: receipt.sha256 });
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready' for update
    ) update ebook_upload_operations o set progress = jsonb_set(o.progress, array['uploadV1', 'parts', ${key}], ${value}::jsonb, true),
      revision = o.revision + 1, updated_at = statement_timestamp()
    from locked c where ${operationPredicate(owner, fence)} and o.state in ('admitted', 'receiving') and o.reserved_bytes > 0
      and ${receipt.number} between 1 and ceil(o.source_size_bytes::numeric / ${UPLOAD_LIMITS.partBytes})
      and ${receipt.bytes} = least(${UPLOAD_LIMITS.partBytes}, o.source_size_bytes - (${receipt.number} - 1)::bigint * ${UPLOAD_LIMITS.partBytes})
      and o.progress #> array['uploadV1', 'grants', ${`parts/${key}`}] is not null
      and o.progress #> array['uploadV1', 'writers', ${`parts/${key}`}] is null
      and (o.progress #> array['uploadV1', 'parts', ${key}] is null or o.progress #> array['uploadV1', 'parts', ${key}] = ${value}::jsonb)
    returning o.id`));
  }

  async transport(owner: SupervisorOwner, fence: OperationFence): Promise<{ sourceBytes: number; transport: UploadTransportProgress; input: Record<string, unknown>; progress: Record<string, unknown> }> {
    const row = one(await this.execute(sql`select o.source_size_bytes::text, o.progress, o.input from ebook_upload_capacity c
      join ebook_upload_operations o on o.volume_id = c.volume_id where ${uploadOwnerPredicate(owner)} and ${operationPredicate(owner, fence)}`));
    const sourceBytes = checkedSourceSize(integer(row.source_size_bytes, "transport source bytes"));
    return { sourceBytes, transport: readUploadTransport(row.progress, sourceBytes), input: jsonObject(row.input), progress: jsonObject(row.progress) };
  }

  /** Transport-only projection; durable catalogue receipts remain core-owned. */
  async uploadView(owner: SupervisorOwner, operationId: string): Promise<{ sourceBytes: number; generation: number; state: string }> {
    requireUuid(operationId);
    const row = one(await this.execute(sql`select o.source_size_bytes::text, o.generation::text, o.state
      from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id = c.volume_id
      where ${uploadOwnerPredicate(owner)} and o.id = ${operationId}::uuid and o.kind = 'upload'
        and o.binding_sha256 = c.binding_sha256 and o.reservation_released_at is null`));
    return { sourceBytes: checkedSourceSize(integer(row.source_size_bytes, "upload source bytes")),
      generation: integer(row.generation, "upload generation"), state: String(row.state) };
  }
  async capacityRevision(owner: SupervisorOwner): Promise<number> {
    const row = one(await this.execute(sql`select c.revision::text from ebook_upload_capacity c
      where ${uploadOwnerPredicate(owner)} and c.state = 'ready' and c.worker_state = 'idle' and c.active_part_writers = 0`));
    return integer(row.revision, "capacity revision");
  }

  /** Grants the complete exclusive file allocation once; local chunks spend that grant. */
  async beginWriter(owner: SupervisorOwner, fence: OperationFence, input: {
    key: string; sourceBytes: number; bytes: number; writerToken: string; availableBytes: number;
  }): Promise<number> {
    requireUuid(input.writerToken); checkedInteger(input.availableBytes, "writer free bytes");
    const category = allocationCategory(input.key, input.sourceBytes);
    checkedInteger(input.bytes, "writer bytes", 1, category.fileBytes);
    if ((category.category === "parts" || category.category === "assembled") && input.bytes !== category.fileBytes) throw new Error("Transport file length differs");
    const grant = Math.ceil(input.bytes / UPLOAD_LIMITS.allocationUnitBytes) * UPLOAD_LIMITS.allocationUnitBytes;
    const key = input.key;
    const metadata = category.category === "metadata";
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready'
        and (c.worker_state = 'idle' or ${metadata} and c.worker_state = 'running' and c.worker_operation_id = ${fence.operationId}::uuid
          and c.worker_lease_expires_at > statement_timestamp())
        and c.active_part_writers < ${UPLOAD_LIMITS.serverPartConcurrency} and c.reserved_bytes + c.unaccounted_bytes <= c.quota_bytes
        and least(${input.availableBytes}, coalesce((c.cleanup_proof ->> 'grantAvailableBytes')::bigint, c.available_bytes))
          >= c.free_reserve_bytes + ${grant} for update
    ), granted as (
      update ebook_upload_operations o set progress = jsonb_set(jsonb_set(
          jsonb_set(o.progress, '{uploadV1}', coalesce(o.progress -> 'uploadV1', ${emptyTransportJson}::jsonb), true),
          array['uploadV1', 'grants', ${key}], to_jsonb(${grant}::bigint), true),
          array['uploadV1', 'writers', ${key}], to_jsonb(${input.writerToken}::text), true),
        state = case when ${metadata} then o.state else 'receiving' end, revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where ${operationPredicate(owner, fence)} and o.source_size_bytes = ${input.sourceBytes}
        and o.reserved_bytes = ${reservationBytes(input.sourceBytes)}
        and (o.state in ('admitted', 'receiving') or ${metadata} and (o.state = 'ready' and c.worker_state = 'idle'
          or o.state = 'processing' and c.worker_operation_id = o.id and c.worker_token = o.lease_token and o.lease_expires_at > statement_timestamp()))
        and coalesce((o.progress #>> '{uploadV1,corrupt}')::boolean, false) = false
        and o.progress #> array['uploadV1', 'grants', ${key}] is null
        and coalesce((select sum(g.value::bigint) from jsonb_each_text(coalesce(o.progress #> '{uploadV1,grants}', '{}'::jsonb)) g
          where split_part(g.key, '/', 1) = ${category.category}), 0) + ${grant} <= ${category.ceiling}
      returning o.id
    ) update ebook_upload_capacity c set active_part_writers = c.active_part_writers + 1,
      cleanup_proof = jsonb_set(coalesce(c.cleanup_proof, '{}'::jsonb), '{grantAvailableBytes}',
        to_jsonb(least(${input.availableBytes}, coalesce((c.cleanup_proof ->> 'grantAvailableBytes')::bigint, c.available_bytes)) - ${grant}), true),
      revision = c.revision + 1, updated_at = statement_timestamp()
    from locked l where c.volume_id = l.volume_id and exists (select 1 from granted) returning c.volume_id`));
    return grant;
  }

  async assertTransport(owner: SupervisorOwner, fence: OperationFence): Promise<void> {
    return this.assertAllocation(owner, fence, "parts/0001");
  }
  async assertAllocation(owner: SupervisorOwner, fence: OperationFence, key: string): Promise<void> {
    const metadata = /^metadata\/[a-z0-9][a-z0-9_.-]{0,63}$/.test(key);
    one(await this.execute(sql`select o.id from ebook_upload_capacity c join ebook_upload_operations o on o.volume_id = c.volume_id
      where ${uploadOwnerPredicate(owner)} and ${operationPredicate(owner, fence)} and c.state = 'ready' and o.reserved_bytes > 0
        and (c.worker_state = 'idle' and (o.state in ('admitted', 'receiving') or ${metadata} and o.state = 'ready')
          or ${metadata} and c.worker_state = 'running' and c.worker_operation_id = o.id and c.worker_token = o.lease_token
            and c.worker_lease_expires_at > statement_timestamp() and o.lease_expires_at > statement_timestamp() and o.state = 'processing')`));
  }

  /** Called only after stream cancellation and file-handle close have settled. */
  async endWriter(owner: SupervisorOwner, fence: OperationFence, key: string, writerToken: string): Promise<void> {
    requireUuid(writerToken);
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state in ('ready', 'quiescing') for update
    ), settled as (
      update ebook_upload_operations o set progress = o.progress #- array['uploadV1', 'writers', ${key}],
        revision = o.revision + 1, updated_at = statement_timestamp()
      from locked c where ${operationPredicate(owner, fence)} and c.active_part_writers > 0
        and o.progress #>> array['uploadV1', 'writers', ${key}] = ${writerToken} returning o.id
    ), counted as (
      update ebook_upload_capacity c set active_part_writers = c.active_part_writers - 1, revision = c.revision + 1, updated_at = statement_timestamp()
      from locked l where c.volume_id = l.volume_id and exists (select 1 from settled) returning c.volume_id
    ) select volume_id from counted union all select c.volume_id from locked c
      join ebook_upload_operations o on o.volume_id = c.volume_id where ${operationPredicate(owner, fence)}
        and o.progress #> array['uploadV1', 'grants', ${key}] is not null
        and o.progress #> array['uploadV1', 'writers', ${key}] is null and not exists (select 1 from settled)`));
  }

  /** Publish only transport readiness; no catalogue/publication receipt is written. */
  async acknowledgeAssembly(owner: SupervisorOwner, fence: OperationFence, input: { bytes: number; sha256: string }): Promise<void> {
    checkedSourceSize(input.bytes); requireSha256(input.sha256);
    const assembled = JSON.stringify(input);
    one(await this.execute(sql`with locked as (
      select c.* from ebook_upload_capacity c where ${uploadOwnerPredicate(owner)} and c.state = 'ready'
        and c.worker_state = 'idle' and c.active_part_writers = 0 for update
    ) update ebook_upload_operations o set progress = jsonb_set(o.progress, '{uploadV1,assembled}', ${assembled}::jsonb, true),
      state = 'ready', revision = o.revision + 1, updated_at = statement_timestamp()
    from locked c where ${operationPredicate(owner, fence)} and o.state in ('receiving', 'ready') and o.source_size_bytes = ${input.bytes}
      and o.reserved_bytes > 0 and coalesce((o.progress #>> '{uploadV1,corrupt}')::boolean, true) = false
      and (select count(*) from jsonb_each(o.progress #> '{uploadV1,parts}')) = ceil(o.source_size_bytes::numeric / ${UPLOAD_LIMITS.partBytes})
      and o.progress #> '{uploadV1,grants,assembled/source}' is not null
      and (o.progress #> '{uploadV1,assembled}' = 'null'::jsonb or o.progress #> '{uploadV1,assembled}' = ${assembled}::jsonb)
    returning o.id`));
  }

  private validateInventory(inventory: SpoolInventory): void {
    requireSha256(inventory.sha256);
    checkedInteger(inventory.allocatedBytes, "inventory allocation", 0, UPLOAD_LIMITS.spoolQuotaBytes);
    checkedInteger(inventory.availableBytes, "inventory free bytes"); checkedInteger(inventory.allocationUnitBytes, "allocation unit", 1, UPLOAD_LIMITS.allocationUnitBytes);
    if (inventory.files.length > 32_768 || new Set(inventory.files.map((file) => file.relativePath)).size !== inventory.files.length) throw new Error("Inventory file list exceeds bounds");
  }
}
