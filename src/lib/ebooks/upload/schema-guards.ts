/**
 * Exact manual additions proposed for migration 0088 source review.
 * Not executed by app imports; migration generation/application stays gated.
 */
export const EBOOK_UPLOAD_IMMUTABILITY_SQL = String.raw`
CREATE FUNCTION ebook_upload_operation_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW.idempotency_key, NEW.kind, NEW.request_sha256,
         NEW.target_fingerprint, NEW.binding_sha256, NEW.protocol_version,
         NEW.parent_operation_id, NEW.volume_id, NEW.run_id,
         NEW.ingest_item_id, NEW.input, NEW.source_size_bytes, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.idempotency_key, OLD.kind, OLD.request_sha256,
         OLD.target_fingerprint, OLD.binding_sha256, OLD.protocol_version,
         OLD.parent_operation_id, OLD.volume_id, OLD.run_id,
         OLD.ingest_item_id, OLD.input, OLD.source_size_bytes, OLD.created_at)
  THEN
    RAISE EXCEPTION 'An upload operation identity and input are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.receipt IS NOT NULL AND
     ROW(NEW.receipt, NEW.receipt_status) IS DISTINCT FROM
     ROW(OLD.receipt, OLD.receipt_status)
  THEN
    RAISE EXCEPTION 'An upload operation receipt is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.effect_committed_at IS NOT NULL AND
     NEW.effect_committed_at IS DISTINCT FROM OLD.effect_committed_at
  THEN
    RAISE EXCEPTION 'An upload effect commitment is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision < OLD.revision OR NEW.generation < OLD.generation THEN
    RAISE EXCEPTION 'Upload operation fences cannot move backwards'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ebook_upload_operation_immutable_guard
BEFORE UPDATE ON ebook_upload_operations
FOR EACH ROW EXECUTE FUNCTION ebook_upload_operation_immutable();

-- Operation keys are permanent, including pending/cancelled/released rows.
-- Spool retention cleanup changes progress; it never deletes replay identity.
CREATE FUNCTION ebook_upload_history_no_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Upload history in % is permanent; % is forbidden',
    TG_TABLE_NAME, TG_OP USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER ebook_upload_operation_no_removal_guard
BEFORE DELETE OR TRUNCATE ON ebook_upload_operations
FOR EACH STATEMENT EXECUTE FUNCTION ebook_upload_history_no_removal();

-- ALWAYS also covers session_replication_role = replica. Administrative DDL
-- can still disable/drop triggers; application roles must not own the tables.
ALTER TABLE ebook_upload_operations
  ENABLE ALWAYS TRIGGER ebook_upload_operation_immutable_guard;
ALTER TABLE ebook_upload_operations
  ENABLE ALWAYS TRIGGER ebook_upload_operation_no_removal_guard;

CREATE FUNCTION ebook_upload_capacity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.volume_id, NEW.quota_bytes, NEW.free_reserve_bytes,
         NEW.global_allowance_bytes, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.volume_id, OLD.quota_bytes, OLD.free_reserve_bytes,
         OLD.global_allowance_bytes, OLD.created_at)
  THEN
    RAISE EXCEPTION 'Upload capacity identity and configured limits are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.binding_sha256 IS DISTINCT FROM OLD.binding_sha256 AND
     (OLD.state NOT IN ('recovering', 'blocked') OR OLD.owner_token IS NOT NULL
      OR OLD.worker_state <> 'idle' OR OLD.active_part_writers <> 0
      OR OLD.reserved_bytes <> OLD.global_allowance_bytes
      OR OLD.unaccounted_bytes <> 0
      OR EXISTS (SELECT 1 FROM ebook_upload_operations o
                 WHERE o.volume_id = OLD.volume_id))
  THEN
    RAISE EXCEPTION 'An owned or previously used upload volume binding is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.revision < OLD.revision OR NEW.owner_fence < OLD.owner_fence
     OR NEW.measurement_generation < OLD.measurement_generation
  THEN
    RAISE EXCEPTION 'Upload capacity fences cannot move backwards'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ebook_upload_capacity_immutable_guard
BEFORE UPDATE ON ebook_upload_capacity
FOR EACH ROW EXECUTE FUNCTION ebook_upload_capacity_immutable();

-- Preserve volume binding history too; TRUNCATE CASCADE cannot clear either
-- table. All operation parent/volume/run/item FKs additionally use RESTRICT.
CREATE TRIGGER ebook_upload_capacity_no_removal_guard
BEFORE DELETE OR TRUNCATE ON ebook_upload_capacity
FOR EACH STATEMENT EXECUTE FUNCTION ebook_upload_history_no_removal();

ALTER TABLE ebook_upload_capacity
  ENABLE ALWAYS TRIGGER ebook_upload_capacity_immutable_guard;
ALTER TABLE ebook_upload_capacity
  ENABLE ALWAYS TRIGGER ebook_upload_capacity_no_removal_guard;
`;
