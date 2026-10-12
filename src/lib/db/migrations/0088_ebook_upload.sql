CREATE TABLE "ebook_upload_capacity" (
	"volume_id" uuid PRIMARY KEY NOT NULL,
	"binding_sha256" text NOT NULL,
	"quota_bytes" bigint DEFAULT 34359738368 NOT NULL,
	"free_reserve_bytes" bigint DEFAULT 8589934592 NOT NULL,
	"global_allowance_bytes" bigint DEFAULT 83886080 NOT NULL,
	"reserved_bytes" bigint DEFAULT 83886080 NOT NULL,
	"unaccounted_bytes" bigint DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'recovering' NOT NULL,
	"owner_token" uuid,
	"owner_fence" bigint DEFAULT 0 NOT NULL,
	"owner_identity" jsonb,
	"owner_lease_expires_at" timestamp with time zone,
	"active_part_writers" integer DEFAULT 0 NOT NULL,
	"worker_operation_id" uuid,
	"worker_token" uuid,
	"worker_state" text DEFAULT 'idle' NOT NULL,
	"worker_lease_expires_at" timestamp with time zone,
	"allocated_bytes" bigint,
	"available_bytes" bigint,
	"measured_at" timestamp with time zone,
	"measurement_generation" bigint DEFAULT 0 NOT NULL,
	"cleanup_proof" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_upload_capacity_binding_check" CHECK ("ebook_upload_capacity"."binding_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ebook_upload_capacity_limits_check" CHECK ("ebook_upload_capacity"."quota_bytes" = 34359738368 and "ebook_upload_capacity"."free_reserve_bytes" = 8589934592 and "ebook_upload_capacity"."global_allowance_bytes" = 83886080),
	CONSTRAINT "ebook_upload_capacity_accounting_check" CHECK ("ebook_upload_capacity"."reserved_bytes" >= "ebook_upload_capacity"."global_allowance_bytes" and "ebook_upload_capacity"."unaccounted_bytes" >= 0 and "ebook_upload_capacity"."reserved_bytes" + "ebook_upload_capacity"."unaccounted_bytes" <= "ebook_upload_capacity"."quota_bytes"),
	CONSTRAINT "ebook_upload_capacity_revision_check" CHECK ("ebook_upload_capacity"."revision" >= 0 and "ebook_upload_capacity"."owner_fence" >= 0 and "ebook_upload_capacity"."measurement_generation" >= 0),
	CONSTRAINT "ebook_upload_capacity_state_check" CHECK ("ebook_upload_capacity"."state" in ('recovering', 'ready', 'quiescing', 'blocked')),
	CONSTRAINT "ebook_upload_capacity_writers_check" CHECK ("ebook_upload_capacity"."active_part_writers" between 0 and 8),
	CONSTRAINT "ebook_upload_capacity_owner_check" CHECK (("ebook_upload_capacity"."owner_token" is null and "ebook_upload_capacity"."owner_identity" is null and "ebook_upload_capacity"."owner_lease_expires_at" is null) or ("ebook_upload_capacity"."owner_token" is not null and "ebook_upload_capacity"."owner_identity" is not null and "ebook_upload_capacity"."owner_lease_expires_at" is not null)),
	CONSTRAINT "ebook_upload_capacity_worker_check" CHECK (("ebook_upload_capacity"."worker_state" = 'idle' and "ebook_upload_capacity"."worker_operation_id" is null and "ebook_upload_capacity"."worker_token" is null and "ebook_upload_capacity"."worker_lease_expires_at" is null) or ("ebook_upload_capacity"."worker_state" in ('running', 'quiescing') and "ebook_upload_capacity"."worker_operation_id" is not null and "ebook_upload_capacity"."worker_token" is not null and "ebook_upload_capacity"."worker_lease_expires_at" is not null)),
	CONSTRAINT "ebook_upload_capacity_measurement_check" CHECK (("ebook_upload_capacity"."allocated_bytes" is null or "ebook_upload_capacity"."allocated_bytes" >= 0) and ("ebook_upload_capacity"."available_bytes" is null or "ebook_upload_capacity"."available_bytes" >= 0))
);
--> statement-breakpoint
CREATE TABLE "ebook_upload_operations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_sha256" text NOT NULL,
	"target_fingerprint" text NOT NULL,
	"binding_sha256" text NOT NULL,
	"protocol_version" integer NOT NULL,
	"parent_operation_id" uuid,
	"volume_id" uuid NOT NULL,
	"run_id" uuid,
	"ingest_item_id" uuid,
	"input" jsonb NOT NULL,
	"progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"receipt" jsonb,
	"receipt_status" integer,
	"state" text DEFAULT 'queued' NOT NULL,
	"source_size_bytes" bigint,
	"reserved_bytes" bigint DEFAULT 0 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"retention_expires_at" timestamp with time zone,
	"effect_committed_at" timestamp with time zone,
	"cleanup_verified_at" timestamp with time zone,
	"reservation_released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebook_upload_operations_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ebook_upload_operations_ingest_item_id_unique" UNIQUE("ingest_item_id"),
	CONSTRAINT "ebook_upload_operations_kind_check" CHECK ("ebook_upload_operations"."kind" in ('batch', 'upload', 'admit', 'complete', 'cancel', 'retry', 'restore', 'undo')),
	CONSTRAINT "ebook_upload_operations_state_check" CHECK ("ebook_upload_operations"."state" in ('queued', 'admitted', 'receiving', 'ready', 'processing', 'quiescing', 'completed', 'failed', 'canceled', 'expired')),
	CONSTRAINT "ebook_upload_operations_hashes_check" CHECK ("ebook_upload_operations"."request_sha256" ~ '^[a-f0-9]{64}$' and "ebook_upload_operations"."target_fingerprint" ~ '^[a-f0-9]{64}$' and "ebook_upload_operations"."binding_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "ebook_upload_operations_protocol_check" CHECK ("ebook_upload_operations"."protocol_version" = 1),
	CONSTRAINT "ebook_upload_operations_json_check" CHECK (jsonb_typeof("ebook_upload_operations"."input") = 'object' and jsonb_typeof("ebook_upload_operations"."progress") = 'object' and ("ebook_upload_operations"."receipt" is null or jsonb_typeof("ebook_upload_operations"."receipt") = 'object')),
	CONSTRAINT "ebook_upload_operations_json_size_check" CHECK (octet_length("ebook_upload_operations"."input"::text) <= 65536 and octet_length("ebook_upload_operations"."progress"::text) <= 131072 and ("ebook_upload_operations"."receipt" is null or octet_length("ebook_upload_operations"."receipt"::text) <= 131072)),
	CONSTRAINT "ebook_upload_operations_revision_check" CHECK ("ebook_upload_operations"."revision" >= 0 and "ebook_upload_operations"."generation" >= 0),
	CONSTRAINT "ebook_upload_operations_reservation_check" CHECK ("ebook_upload_operations"."reserved_bytes" between 0 and 9143582720),
	CONSTRAINT "ebook_upload_operations_size_check" CHECK ("ebook_upload_operations"."source_size_bytes" is null or "ebook_upload_operations"."source_size_bytes" between 1 and 4294967296),
	CONSTRAINT "ebook_upload_operations_item_check" CHECK (("ebook_upload_operations"."kind" = 'upload' and "ebook_upload_operations"."run_id" is not null and "ebook_upload_operations"."ingest_item_id" is not null and "ebook_upload_operations"."source_size_bytes" is not null) or ("ebook_upload_operations"."kind" <> 'upload' and "ebook_upload_operations"."ingest_item_id" is null and "ebook_upload_operations"."source_size_bytes" is null and "ebook_upload_operations"."reserved_bytes" = 0)),
	CONSTRAINT "ebook_upload_operations_receipt_check" CHECK (("ebook_upload_operations"."receipt" is null and "ebook_upload_operations"."receipt_status" is null) or ("ebook_upload_operations"."receipt" is not null and "ebook_upload_operations"."receipt_status" is not null and "ebook_upload_operations"."receipt_status" between 200 and 599)),
	CONSTRAINT "ebook_upload_operations_effect_check" CHECK ("ebook_upload_operations"."effect_committed_at" is null or "ebook_upload_operations"."receipt" is not null),
	CONSTRAINT "ebook_upload_operations_lease_check" CHECK (("ebook_upload_operations"."lease_token" is null and "ebook_upload_operations"."lease_expires_at" is null) or ("ebook_upload_operations"."lease_token" is not null and "ebook_upload_operations"."lease_expires_at" is not null)),
	CONSTRAINT "ebook_upload_operations_release_check" CHECK ("ebook_upload_operations"."reservation_released_at" is null or ("ebook_upload_operations"."reserved_bytes" = 0 and "ebook_upload_operations"."cleanup_verified_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ebook_upload_capacity" ADD CONSTRAINT "ebook_upload_capacity_worker_operation_id_ebook_upload_operations_id_fk" FOREIGN KEY ("worker_operation_id") REFERENCES "public"."ebook_upload_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_upload_operations" ADD CONSTRAINT "ebook_upload_operations_parent_operation_id_ebook_upload_operations_id_fk" FOREIGN KEY ("parent_operation_id") REFERENCES "public"."ebook_upload_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_upload_operations" ADD CONSTRAINT "ebook_upload_operations_volume_id_ebook_upload_capacity_volume_id_fk" FOREIGN KEY ("volume_id") REFERENCES "public"."ebook_upload_capacity"("volume_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_upload_operations" ADD CONSTRAINT "ebook_upload_operations_run_id_ebook_ingest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ebook_ingest_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebook_upload_operations" ADD CONSTRAINT "ebook_upload_operations_ingest_item_id_ebook_ingest_items_id_fk" FOREIGN KEY ("ingest_item_id") REFERENCES "public"."ebook_ingest_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ebook_upload_operations_dispatch_idx" ON "ebook_upload_operations" USING btree ("volume_id","state","created_at","id") WHERE "ebook_upload_operations"."kind" = 'upload' and "ebook_upload_operations"."state" in ('queued', 'ready', 'failed', 'quiescing');--> statement-breakpoint
CREATE INDEX "ebook_upload_operations_retention_idx" ON "ebook_upload_operations" USING btree ("retention_expires_at","id") WHERE "ebook_upload_operations"."kind" = 'upload' and "ebook_upload_operations"."reserved_bytes" > 0;--> statement-breakpoint
CREATE INDEX "ebook_upload_operations_run_idx" ON "ebook_upload_operations" USING btree ("run_id","created_at","id");--> statement-breakpoint
CREATE INDEX "ebook_upload_operations_parent_idx" ON "ebook_upload_operations" USING btree ("parent_operation_id");
--> statement-breakpoint

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
--> statement-breakpoint


CREATE TRIGGER ebook_upload_operation_immutable_guard
BEFORE UPDATE ON ebook_upload_operations
FOR EACH ROW EXECUTE FUNCTION ebook_upload_operation_immutable();
--> statement-breakpoint


-- Operation keys are permanent, including pending/cancelled/released rows.
-- Spool retention cleanup changes progress; it never deletes replay identity.
CREATE FUNCTION ebook_upload_history_no_removal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Upload history in % is permanent; % is forbidden',
    TG_TABLE_NAME, TG_OP USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint


CREATE TRIGGER ebook_upload_operation_no_removal_guard
BEFORE DELETE OR TRUNCATE ON ebook_upload_operations
FOR EACH STATEMENT EXECUTE FUNCTION ebook_upload_history_no_removal();
--> statement-breakpoint


-- ALWAYS also covers session_replication_role = replica. Administrative DDL
-- can still disable/drop triggers; application roles must not own the tables.
ALTER TABLE ebook_upload_operations
  ENABLE ALWAYS TRIGGER ebook_upload_operation_immutable_guard;
--> statement-breakpoint

ALTER TABLE ebook_upload_operations
  ENABLE ALWAYS TRIGGER ebook_upload_operation_no_removal_guard;
--> statement-breakpoint


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
--> statement-breakpoint


CREATE TRIGGER ebook_upload_capacity_immutable_guard
BEFORE UPDATE ON ebook_upload_capacity
FOR EACH ROW EXECUTE FUNCTION ebook_upload_capacity_immutable();
--> statement-breakpoint


-- Preserve volume binding history too; TRUNCATE CASCADE cannot clear either
-- table. All operation parent/volume/run/item FKs additionally use RESTRICT.
CREATE TRIGGER ebook_upload_capacity_no_removal_guard
BEFORE DELETE OR TRUNCATE ON ebook_upload_capacity
FOR EACH STATEMENT EXECUTE FUNCTION ebook_upload_history_no_removal();
--> statement-breakpoint


ALTER TABLE ebook_upload_capacity
  ENABLE ALWAYS TRIGGER ebook_upload_capacity_immutable_guard;
--> statement-breakpoint

ALTER TABLE ebook_upload_capacity
  ENABLE ALWAYS TRIGGER ebook_upload_capacity_no_removal_guard;