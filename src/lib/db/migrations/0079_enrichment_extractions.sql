CREATE TABLE "enrichment_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"vocabulary_version" smallint NOT NULL,
	"dimension_keys" text[] NOT NULL,
	"extractor_version" text NOT NULL,
	"request_sha256" text NOT NULL,
	"status" text NOT NULL,
	"passages" jsonb NOT NULL,
	"values_returned" integer DEFAULT 0 NOT NULL,
	"values_verified" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "enrichment_extraction_value_check" CHECK (status in ('not_about_work', 'answered', 'invalid_answer') and request_sha256 ~ '^[a-f0-9]{64}$' and length(trim(extractor_version)) between 1 and 300 and cardinality(dimension_keys) >= 1 and jsonb_typeof(passages) = 'array' and jsonb_typeof(failures) = 'array' and values_returned >= 0 and values_verified between 0 and values_returned and (status = 'answered' or values_verified = 0))
);
--> statement-breakpoint
ALTER TABLE "enrichment_extractions" ADD CONSTRAINT "enrichment_extractions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_extractions" ADD CONSTRAINT "enrichment_extractions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_extractions" ADD CONSTRAINT "enrichment_extractions_vocabulary_version_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("vocabulary_version") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_extractions" ADD CONSTRAINT "enrichment_extractions_job_id_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enrichment_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_extraction_request_unique" ON "enrichment_extractions" USING btree ("source_record_id","request_sha256") WHERE "enrichment_extractions"."undone_at" is null;--> statement-breakpoint
CREATE INDEX "enrichment_extraction_work_idx" ON "enrichment_extractions" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "enrichment_extraction_run_idx" ON "enrichment_extractions" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "enrichment_extraction_job_idx" ON "enrichment_extractions" USING btree ("job_id");--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON enrichment_extractions
FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint
-- An extraction records a paid call (SLN-469): it never changes, except its
-- undo time, set once; its job's SET NULL; and an audited Harmonize move of its
-- book. It is deleted only through the cascades from works and source_records.
CREATE FUNCTION guard_enrichment_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- A cascade runs this trigger from the parent's foreign key trigger, one level deeper
    IF pg_trigger_depth() < 2 THEN
      PERFORM enrichment_rule_error('An extraction is deleted only with its book or its document', 'enrichment_extraction_ledger');
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.id, NEW.source_record_id, NEW.vocabulary_version, NEW.dimension_keys, NEW.extractor_version, NEW.request_sha256, NEW.status,
      NEW.passages, NEW.values_returned, NEW.values_verified, NEW.failures, NEW.run_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.source_record_id, OLD.vocabulary_version, OLD.dimension_keys, OLD.extractor_version, OLD.request_sha256, OLD.status,
      OLD.passages, OLD.values_returned, OLD.values_verified, OLD.failures, OLD.run_id, OLD.created_at)
    OR (NEW.work_id IS DISTINCT FROM OLD.work_id AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id))
    OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL)
    OR (NEW.undone_at IS DISTINCT FROM OLD.undone_at AND (OLD.undone_at IS NOT NULL OR NEW.undone_at IS NULL)) THEN
    PERFORM enrichment_rule_error('An extraction never changes, except its undo time, once', 'enrichment_extraction_ledger');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_extraction_guard BEFORE UPDATE OR DELETE ON enrichment_extractions
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_extraction();
