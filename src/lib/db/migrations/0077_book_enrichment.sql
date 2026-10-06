CREATE TABLE "claim_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"outlet" text NOT NULL,
	"extractor_version" text NOT NULL,
	"run_id" uuid,
	"locator" text NOT NULL,
	"excerpt" text NOT NULL,
	"excerpt_sha256" text NOT NULL,
	"start_offset" integer,
	"end_offset" integer,
	"text_sha256" text,
	"payload_path" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_evidence_excerpt_unique" UNIQUE("claim_id","source_record_id","excerpt_sha256"),
	CONSTRAINT "claim_evidence_value_check" CHECK (outlet ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(outlet) <= 100 and length(trim(extractor_version)) between 1 and 200 and length(excerpt) between 1 and 1000 and excerpt_sha256 = encode(sha256(convert_to(excerpt, 'UTF8')), 'hex')),
	CONSTRAINT "claim_evidence_locator_check" CHECK ((locator = 'text' and start_offset >= 0 and end_offset - start_offset = length(excerpt) and text_sha256 ~ '^[a-f0-9]{64}$' and payload_path is null) or (locator = 'payload' and cardinality(payload_path) >= 1 and start_offset is null and end_offset is null and text_sha256 is null))
);
--> statement-breakpoint
CREATE TABLE "enrichment_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"dimension_id" uuid NOT NULL,
	"target" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"applied_by" text NOT NULL,
	"rule_id" uuid,
	"batch_id" uuid,
	"note" text,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "enrichment_application_value_check" CHECK ("enrichment_applications"."target" in ('taxonomy', 'values', 'work.work_type_id', 'work.original_title', 'work.original_language', 'work.original_year', 'identifier', 'none', 'edition.open_library_key', 'edition.lccn', 'edition.oclc', 'edition.translator') and "enrichment_applications"."applied_by" in ('pablo', 'rule') and ("enrichment_applications"."applied_by" = 'rule') = ("enrichment_applications"."rule_id" is not null) and jsonb_typeof("enrichment_applications"."before") = 'object' and jsonb_typeof("enrichment_applications"."after") = 'object' and ("enrichment_applications"."undone_at" is null or "enrichment_applications"."undone_at" >= "enrichment_applications"."applied_at") and ("enrichment_applications"."note" is null or length("enrichment_applications"."note") <= 2000))
);
--> statement-breakpoint
CREATE TABLE "enrichment_auto_accept_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension_id" uuid NOT NULL,
	"basis" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"minimum_confidence" numeric(4, 3) DEFAULT 1 NOT NULL,
	"gold_set_version" integer,
	"measured_precision" numeric(5, 4),
	"sample_size" integer,
	"minimum_sample" integer,
	"gate_passed_at" timestamp with time zone,
	"approval_url" text,
	"enabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_auto_accept_rules_dimension_id_unique" UNIQUE("dimension_id"),
	CONSTRAINT "enrichment_rule_value_check" CHECK ("enrichment_auto_accept_rules"."basis" in ('exact_identifier_match', 'evaluation_gate') and "enrichment_auto_accept_rules"."minimum_confidence" between 0 and 1 and ("enrichment_auto_accept_rules"."measured_precision" is null or "enrichment_auto_accept_rules"."measured_precision" between 0 and 1) and ("enrichment_auto_accept_rules"."sample_size" is null or "enrichment_auto_accept_rules"."sample_size" >= 0) and ("enrichment_auto_accept_rules"."minimum_sample" is null or "enrichment_auto_accept_rules"."minimum_sample" >= 1) and ("enrichment_auto_accept_rules"."approval_url" is null or "enrichment_auto_accept_rules"."approval_url" ~ '^https://[^[:space:]]+$')),
	CONSTRAINT "enrichment_rule_gate_check" CHECK (not enabled or (approval_url is not null and enabled_at is not null and (basis = 'exact_identifier_match' or (measured_precision >= 0.95 and sample_size >= minimum_sample and gold_set_version is not null and gate_passed_at is not null))))
);
--> statement-breakpoint
CREATE TABLE "enrichment_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"dimension_id" uuid NOT NULL,
	"term_id" uuid,
	"number_value" numeric,
	"text_value" text,
	"place_id" uuid,
	"person_id" uuid,
	"method" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"vocabulary_version" smallint NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by" text,
	"rule_id" uuid,
	"decided_at" timestamp with time zone,
	"superseded_by_claim_id" uuid,
	"decision_reason" text,
	"run_id" uuid,
	"job_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_claim_value_check" CHECK (num_nonnulls("enrichment_claims"."term_id", "enrichment_claims"."number_value", "enrichment_claims"."text_value", "enrichment_claims"."place_id", "enrichment_claims"."person_id") between 1 and 2 and ("enrichment_claims"."text_value" is null or ("enrichment_claims"."text_value" = btrim("enrichment_claims"."text_value") and length("enrichment_claims"."text_value") between 1 and 500)) and ("enrichment_claims"."note" is null or length("enrichment_claims"."note") <= 2000)),
	CONSTRAINT "enrichment_claim_method_check" CHECK ("enrichment_claims"."method" in ('api', 'agent', 'human') and "enrichment_claims"."confidence" between 0 and 1 and ("enrichment_claims"."method" <> 'human' or "enrichment_claims"."confidence" = 1) and ("enrichment_claims"."method" = 'human' or "enrichment_claims"."run_id" is not null)),
	CONSTRAINT "enrichment_claim_decision_check" CHECK ("enrichment_claims"."status" in ('proposed', 'accepted', 'rejected', 'superseded') and ("enrichment_claims"."status" = 'proposed') = ("enrichment_claims"."decided_at" is null) and ("enrichment_claims"."status" = 'proposed') = ("enrichment_claims"."decided_by" is null) and ("enrichment_claims"."decided_by" is null or "enrichment_claims"."decided_by" in ('pablo', 'rule', 'check')) and ("enrichment_claims"."decided_by" is not distinct from 'rule') = ("enrichment_claims"."rule_id" is not null) and ("enrichment_claims"."status" = 'rejected') = ("enrichment_claims"."decision_reason" is not null) and ("enrichment_claims"."decision_reason" is null or "enrichment_claims"."decision_reason" in ('wrong_value', 'weak_evidence', 'wrong_book', 'not_independent', 'other', 'evidence_deleted', 'run_undone', 'mapping_changed', 'vocabulary_changed', 'undone')) and ("enrichment_claims"."status" = 'superseded' or "enrichment_claims"."superseded_by_claim_id" is null) and "enrichment_claims"."superseded_by_claim_id" is distinct from "enrichment_claims"."id")
);
--> statement-breakpoint
CREATE TABLE "enrichment_dimensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"layer" text NOT NULL,
	"value_kind" text NOT NULL,
	"entity_level" text DEFAULT 'work' NOT NULL,
	"provider" text,
	"apply_target" text NOT NULL,
	"taxonomy_family_id" uuid,
	"attribute_category" text,
	"requires_independent_sources" boolean DEFAULT false NOT NULL,
	"auto_accept_eligible" boolean DEFAULT false NOT NULL,
	"unknown_handling" text DEFAULT 'exclude' NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"introduced_in" smallint NOT NULL,
	"retired_in" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_dimensions_key_unique" UNIQUE("key"),
	CONSTRAINT "enrichment_dimension_value_check" CHECK ("enrichment_dimensions"."key" ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and length("enrichment_dimensions"."key") <= 100 and length(trim("enrichment_dimensions"."label")) between 1 and 200 and length(trim("enrichment_dimensions"."definition")) between 1 and 4000 and jsonb_typeof("enrichment_dimensions"."parameters") = 'object' and ("enrichment_dimensions"."retired_in" is null or "enrichment_dimensions"."retired_in" > "enrichment_dimensions"."introduced_in")),
	CONSTRAINT "enrichment_dimension_kind_check" CHECK ("enrichment_dimensions"."layer" in ('identity', 'facts', 'length', 'experience', 'popularity') and "enrichment_dimensions"."value_kind" in ('term', 'terms', 'scale', 'number', 'text', 'identifier', 'place', 'person') and "enrichment_dimensions"."unknown_handling" in ('exclude', 'include_as_unknown')),
	CONSTRAINT "enrichment_dimension_target_check" CHECK (((apply_target = 'taxonomy' and value_kind in ('term', 'terms', 'scale') and entity_level in ('work')) or (apply_target = 'values' and value_kind in ('number', 'place') and entity_level in ('work')) or (apply_target = 'work.work_type_id' and value_kind in ('term') and entity_level in ('work')) or (apply_target = 'work.original_title' and value_kind in ('text') and entity_level in ('work')) or (apply_target = 'work.original_language' and value_kind in ('text') and entity_level in ('work')) or (apply_target = 'work.original_year' and value_kind in ('number') and entity_level in ('work')) or (apply_target = 'identifier' and value_kind in ('identifier') and entity_level in ('work', 'edition')) or (apply_target = 'none' and value_kind in ('number') and entity_level in ('work', 'edition')) or (apply_target = 'edition.open_library_key' and value_kind in ('identifier') and entity_level in ('edition')) or (apply_target = 'edition.lccn' and value_kind in ('identifier') and entity_level in ('edition')) or (apply_target = 'edition.oclc' and value_kind in ('identifier') and entity_level in ('edition')) or (apply_target = 'edition.translator' and value_kind in ('person') and entity_level in ('edition')))),
	CONSTRAINT "enrichment_dimension_provider_check" CHECK (("enrichment_dimensions"."value_kind" = 'identifier') = ("enrichment_dimensions"."provider" is not null) and ("enrichment_dimensions"."provider" is null or "enrichment_dimensions"."provider" ~ '^[a-z0-9]+([._-][a-z0-9]+)*$')),
	CONSTRAINT "enrichment_dimension_family_check" CHECK (("enrichment_dimensions"."taxonomy_family_id" is not null) = ("enrichment_dimensions"."apply_target" = 'taxonomy') and ("enrichment_dimensions"."attribute_category" is null or ("enrichment_dimensions"."taxonomy_family_id" is not null and length(trim("enrichment_dimensions"."attribute_category")) between 1 and 100)))
);
--> statement-breakpoint
CREATE TABLE "enrichment_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" smallint DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"held_reason" text,
	"last_error" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rerun" boolean DEFAULT false NOT NULL,
	"cost" numeric DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "enrichment_job_value_check" CHECK ("enrichment_jobs"."kind" in ('identity', 'facts', 'length', 'popularity', 'research', 'extract') and "enrichment_jobs"."status" in ('queued', 'running', 'done', 'failed', 'held') and "enrichment_jobs"."attempts" >= 0 and "enrichment_jobs"."cost" >= 0 and jsonb_typeof("enrichment_jobs"."payload") = 'object' and ("enrichment_jobs"."last_error" is null or length("enrichment_jobs"."last_error") <= 500)),
	CONSTRAINT "enrichment_job_state_check" CHECK (("enrichment_jobs"."status" = 'running') = ("enrichment_jobs"."locked_at" is not null) and ("enrichment_jobs"."locked_at" is null) = ("enrichment_jobs"."locked_by" is null) and ("enrichment_jobs"."locked_by" is null or length(trim("enrichment_jobs"."locked_by")) between 1 and 200) and ("enrichment_jobs"."status" = 'held') = ("enrichment_jobs"."held_reason" is not null) and ("enrichment_jobs"."held_reason" is null or "enrichment_jobs"."held_reason" in ('quota', 'rate_limited', 'budget', 'work_cost_ceiling')) and ("enrichment_jobs"."finished_at" is not null) = ("enrichment_jobs"."status" in ('done', 'failed')))
);
--> statement-breakpoint
CREATE TABLE "enrichment_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dimension_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"definition" text NOT NULL,
	"applies_when" text NOT NULL,
	"does_not_apply_when" text NOT NULL,
	"examples" jsonb NOT NULL,
	"scale_value" numeric,
	"introduced_in" smallint NOT NULL,
	"retired_in" smallint,
	"replaced_by_term_id" uuid,
	"custom_item_id" uuid,
	"system_item_id" uuid,
	"work_type_id" uuid,
	"parent_term_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrichment_term_value_check" CHECK ("enrichment_terms"."key" ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and length("enrichment_terms"."key") <= 100 and length(trim("enrichment_terms"."label")) between 1 and 200 and length(trim("enrichment_terms"."definition")) between 1 and 4000 and length(trim("enrichment_terms"."applies_when")) between 1 and 4000 and length(trim("enrichment_terms"."does_not_apply_when")) between 1 and 4000 and jsonb_typeof("enrichment_terms"."examples") = 'array' and ("enrichment_terms"."retired_in" is null or "enrichment_terms"."retired_in" > "enrichment_terms"."introduced_in") and "enrichment_terms"."replaced_by_term_id" is distinct from "enrichment_terms"."id" and "enrichment_terms"."parent_term_id" is distinct from "enrichment_terms"."id" and ("enrichment_terms"."replaced_by_term_id" is null or "enrichment_terms"."retired_in" is not null)),
	CONSTRAINT "enrichment_term_item_check" CHECK (num_nonnulls("enrichment_terms"."custom_item_id", "enrichment_terms"."system_item_id", "enrichment_terms"."work_type_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "enrichment_vocabulary_versions" (
	"version" smallint PRIMARY KEY NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"approval_url" text NOT NULL,
	"document_url" text,
	"seed_sha256" text NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	CONSTRAINT "enrichment_vocabulary_version_check" CHECK ("enrichment_vocabulary_versions"."version" >= 1 and "enrichment_vocabulary_versions"."approval_url" ~ '^https://[^[:space:]]+$' and ("enrichment_vocabulary_versions"."document_url" is null or "enrichment_vocabulary_versions"."document_url" ~ '^https://[^[:space:]]+$') and "enrichment_vocabulary_versions"."seed_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "work_enrichment_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"dimension_id" uuid NOT NULL,
	"number_value" numeric,
	"place_id" uuid,
	"claim_id" uuid NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_enrichment_values_claim_id_unique" UNIQUE("claim_id"),
	CONSTRAINT "work_enrichment_value_check" CHECK (num_nonnulls("work_enrichment_values"."number_value", "work_enrichment_values"."place_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "work_popularity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"month" date NOT NULL,
	"value" numeric NOT NULL,
	"source_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_popularity_snapshot_unique" UNIQUE("work_id","metric","month"),
	CONSTRAINT "work_popularity_snapshot_value_check" CHECK ("work_popularity_snapshots"."metric" ~ '^[a-z][a-z0-9_]*$' and length("work_popularity_snapshots"."metric") <= 100 and "work_popularity_snapshots"."month" = date_trunc('month', "work_popularity_snapshots"."month")::date and "work_popularity_snapshots"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "original_title" text;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_claim_id_enrichment_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."enrichment_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_evidence" ADD CONSTRAINT "claim_evidence_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_applications" ADD CONSTRAINT "enrichment_applications_claim_id_enrichment_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."enrichment_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_applications" ADD CONSTRAINT "enrichment_applications_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_applications" ADD CONSTRAINT "enrichment_applications_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_applications" ADD CONSTRAINT "enrichment_applications_dimension_id_enrichment_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."enrichment_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_applications" ADD CONSTRAINT "enrichment_applications_rule_id_enrichment_auto_accept_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."enrichment_auto_accept_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_auto_accept_rules" ADD CONSTRAINT "enrichment_auto_accept_rules_dimension_id_enrichment_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."enrichment_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_dimension_id_enrichment_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."enrichment_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_term_id_enrichment_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."enrichment_terms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_vocabulary_version_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("vocabulary_version") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_rule_id_enrichment_auto_accept_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."enrichment_auto_accept_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_superseded_by_claim_id_enrichment_claims_id_fk" FOREIGN KEY ("superseded_by_claim_id") REFERENCES "public"."enrichment_claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_claims" ADD CONSTRAINT "enrichment_claims_job_id_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enrichment_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_dimensions" ADD CONSTRAINT "enrichment_dimensions_taxonomy_family_id_taxonomy_families_id_fk" FOREIGN KEY ("taxonomy_family_id") REFERENCES "public"."taxonomy_families"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_dimensions" ADD CONSTRAINT "enrichment_dimensions_introduced_in_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("introduced_in") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_dimensions" ADD CONSTRAINT "enrichment_dimensions_retired_in_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("retired_in") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_jobs" ADD CONSTRAINT "enrichment_jobs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_dimension_id_enrichment_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."enrichment_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_introduced_in_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("introduced_in") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_retired_in_enrichment_vocabulary_versions_version_fk" FOREIGN KEY ("retired_in") REFERENCES "public"."enrichment_vocabulary_versions"("version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_replaced_by_term_id_enrichment_terms_id_fk" FOREIGN KEY ("replaced_by_term_id") REFERENCES "public"."enrichment_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_custom_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("custom_item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_terms" ADD CONSTRAINT "enrichment_terms_parent_term_id_enrichment_terms_id_fk" FOREIGN KEY ("parent_term_id") REFERENCES "public"."enrichment_terms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_enrichment_values" ADD CONSTRAINT "work_enrichment_values_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_enrichment_values" ADD CONSTRAINT "work_enrichment_values_dimension_id_enrichment_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."enrichment_dimensions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_enrichment_values" ADD CONSTRAINT "work_enrichment_values_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_enrichment_values" ADD CONSTRAINT "work_enrichment_values_claim_id_enrichment_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."enrichment_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_popularity_snapshots" ADD CONSTRAINT "work_popularity_snapshots_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_popularity_snapshots" ADD CONSTRAINT "work_popularity_snapshots_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claim_evidence_source_idx" ON "claim_evidence" USING btree ("source_record_id");--> statement-breakpoint
CREATE INDEX "claim_evidence_run_idx" ON "claim_evidence" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "enrichment_application_applied_idx" ON "enrichment_applications" USING btree ("applied_at");--> statement-breakpoint
CREATE INDEX "enrichment_application_claim_idx" ON "enrichment_applications" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "enrichment_application_work_idx" ON "enrichment_applications" USING btree ("work_id","applied_at");--> statement-breakpoint
CREATE INDEX "enrichment_application_batch_idx" ON "enrichment_applications" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "enrichment_application_edition_idx" ON "enrichment_applications" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_work_idx" ON "enrichment_claims" USING btree ("work_id","dimension_id","status");--> statement-breakpoint
CREATE INDEX "enrichment_claim_dimension_idx" ON "enrichment_claims" USING btree ("dimension_id","status");--> statement-breakpoint
CREATE INDEX "enrichment_claim_edition_idx" ON "enrichment_claims" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_term_idx" ON "enrichment_claims" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_place_idx" ON "enrichment_claims" USING btree ("place_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_person_idx" ON "enrichment_claims" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_run_idx" ON "enrichment_claims" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_job_idx" ON "enrichment_claims" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "enrichment_claim_rule_idx" ON "enrichment_claims" USING btree ("rule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_job_open_unique" ON "enrichment_jobs" USING btree ("work_id","kind") WHERE status in ('queued', 'running', 'held');--> statement-breakpoint
CREATE INDEX "enrichment_job_queue_idx" ON "enrichment_jobs" USING btree ("status","priority","run_after");--> statement-breakpoint
CREATE INDEX "enrichment_term_dimension_idx" ON "enrichment_terms" USING btree ("dimension_id");--> statement-breakpoint
CREATE INDEX "enrichment_term_system_item_idx" ON "enrichment_terms" USING btree ("system_item_id");--> statement-breakpoint
CREATE INDEX "enrichment_term_custom_item_idx" ON "enrichment_terms" USING btree ("custom_item_id");--> statement-breakpoint
CREATE INDEX "work_enrichment_value_number_idx" ON "work_enrichment_values" USING btree ("dimension_id","number_value","work_id");--> statement-breakpoint
CREATE INDEX "work_enrichment_value_place_idx" ON "work_enrichment_values" USING btree ("dimension_id","place_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_enrichment_value_place_unique" ON "work_enrichment_values" USING btree ("work_id","dimension_id","place_id") WHERE place_id is not null;--> statement-breakpoint
CREATE INDEX "work_popularity_snapshot_metric_idx" ON "work_popularity_snapshots" USING btree ("metric","month");--> statement-breakpoint
CREATE INDEX "work_popularity_snapshot_source_idx" ON "work_popularity_snapshots" USING btree ("source_record_id");--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_original_title_check" CHECK ("works"."original_title" is null or ("works"."kind" = 'book' and "works"."original_title" = btrim("works"."original_title") and length("works"."original_title") between 1 and 500));
--> statement-breakpoint
-- SLN-462: the guards of the book enrichment model. Triggers and the
-- NULLS NOT DISTINCT indexes are custom SQL: Drizzle models neither.
-- A work delete removes source records, claims and evidence in one statement;
-- these keys wait for the commit, so a script that deletes a cited source
-- record fails there instead of orphaning evidence.
ALTER TABLE "claim_evidence" ALTER CONSTRAINT "claim_evidence_source_record_id_source_records_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
ALTER TABLE "work_popularity_snapshots" ALTER CONSTRAINT "work_popularity_snapshots_source_record_id_source_records_id_fk" DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
-- One current dimension per family and attributes category, so an item belongs to one dimension
CREATE UNIQUE INDEX "enrichment_dimension_family_current_unique" ON "enrichment_dimensions" USING btree ("taxonomy_family_id","attribute_category") NULLS NOT DISTINCT WHERE "retired_in" IS NULL AND "taxonomy_family_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_term_key_current_unique" ON "enrichment_terms" USING btree ("dimension_id","key") WHERE "retired_in" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_term_item_current_unique" ON "enrichment_terms" USING btree ("custom_item_id","system_item_id","work_type_id") NULLS NOT DISTINCT WHERE "retired_in" IS NULL;
--> statement-breakpoint
-- One open claim per work, edition, dimension and value; a second source adds evidence to it (R6)
CREATE UNIQUE INDEX "enrichment_claim_open_unique" ON "enrichment_claims" USING btree ("work_id","edition_id","dimension_id","term_id","number_value","text_value","place_id","person_id") NULLS NOT DISTINCT WHERE "status" = 'proposed';
--> statement-breakpoint
DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'enrichment_claims', 'work_enrichment_values', 'enrichment_applications',
    'work_popularity_snapshots', 'enrichment_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON %I FOR EACH ROW EXECUTE FUNCTION require_book_parent()',
      relation_name
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION enrichment_rule_error(message text, rule_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%', message USING ERRCODE = '23514', CONSTRAINT = rule_name;
END $$;
--> statement-breakpoint
-- A dimension's identity never changes; its family is a work-level family that applies to books
CREATE FUNCTION guard_enrichment_dimension() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f taxonomy_families%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW.key, NEW.layer, NEW.value_kind, NEW.entity_level, NEW.provider, NEW.apply_target, NEW.taxonomy_family_id, NEW.attribute_category, NEW.introduced_in, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.key, OLD.layer, OLD.value_kind, OLD.entity_level, OLD.provider, OLD.apply_target, OLD.taxonomy_family_id, OLD.attribute_category, OLD.introduced_in, OLD.created_at) THEN
    PERFORM enrichment_rule_error('A dimension''s key, kind, level, provider, target and family never change; add a dimension in a new vocabulary version', 'enrichment_dimension_identity');
  END IF;
  IF TG_OP = 'INSERT' AND NEW.taxonomy_family_id IS NOT NULL THEN
    SELECT * INTO STRICT f FROM taxonomy_families WHERE id = NEW.taxonomy_family_id;
    IF f.entity_level <> 'work' THEN
      PERFORM enrichment_rule_error('A dimension writes into a work-level taxonomy family', 'enrichment_dimension_family');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM taxonomy_applicability WHERE family_id = f.id AND kind = 'book' AND level = 'work') THEN
      PERFORM enrichment_rule_error('This taxonomy family does not apply to books', 'enrichment_dimension_family');
    END IF;
    IF NEW.attribute_category IS NOT NULL AND f.system_table IS DISTINCT FROM 'attributes' THEN
      PERFORM enrichment_rule_error('Only an attributes dimension names a category', 'enrichment_dimension_family');
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_dimension_guard BEFORE INSERT OR UPDATE ON enrichment_dimensions
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_dimension();
--> statement-breakpoint
-- A taxonomy item is merging away in this transaction's audited Harmonize merge
CREATE FUNCTION enrichment_item_merging(entity_arg text, item_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM harmonization_operations
    WHERE id::text = current_setting('durtal.harmonization_operation', true)
    AND action = 'merge' AND entity = entity_arg AND source_id = item_id
    AND created_at = transaction_timestamp() AND after IS NULL)
$$;
--> statement-breakpoint
-- A term governs exactly one item of its dimension's family (R4). After its
-- insert only its retirement changes; a merge moves a retired term's custom item.
CREATE FUNCTION guard_enrichment_term() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d enrichment_dimensions%ROWTYPE; f taxonomy_families%ROWTYPE; parent enrichment_terms%ROWTYPE; found_item boolean; item_category text; item_family uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.dimension_id, NEW.key, NEW.label, NEW.definition, NEW.applies_when, NEW.does_not_apply_when, NEW.examples, NEW.scale_value, NEW.introduced_in, NEW.system_item_id, NEW.work_type_id, NEW.parent_term_id, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.dimension_id, OLD.key, OLD.label, OLD.definition, OLD.applies_when, OLD.does_not_apply_when, OLD.examples, OLD.scale_value, OLD.introduced_in, OLD.system_item_id, OLD.work_type_id, OLD.parent_term_id, OLD.created_at) THEN
      PERFORM enrichment_rule_error('A term never changes; add a new term in a new vocabulary version', 'enrichment_term_identity');
    END IF;
    IF NEW.custom_item_id IS DISTINCT FROM OLD.custom_item_id
      AND NOT (OLD.retired_in IS NOT NULL AND NEW.retired_in IS NOT NULL AND harmonization_allows_move('custom-taxonomy', OLD.custom_item_id, NEW.custom_item_id)) THEN
      PERFORM enrichment_rule_error('A term never changes; add a new term in a new vocabulary version', 'enrichment_term_identity');
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = NEW.dimension_id;
  IF d.value_kind NOT IN ('term', 'terms', 'scale') THEN
    PERFORM enrichment_rule_error('Only a term, terms or scale dimension has terms', 'enrichment_term_dimension');
  END IF;
  IF (d.value_kind = 'scale') <> (NEW.scale_value IS NOT NULL) THEN
    PERFORM enrichment_rule_error('A scale anchor has a scale value, and only a scale anchor does', 'enrichment_term_dimension');
  END IF;
  IF NEW.introduced_in < d.introduced_in OR (d.retired_in IS NOT NULL AND NEW.introduced_in >= d.retired_in) THEN
    PERFORM enrichment_rule_error('A term is introduced while its dimension is current', 'enrichment_term_dimension');
  END IF;
  IF jsonb_array_length(NEW.examples) < (CASE WHEN d.value_kind = 'scale' THEN 1 ELSE 3 END)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.examples) e WHERE NOT coalesce(
      (jsonb_typeof(e) = 'object' AND jsonb_typeof(e -> 'workId') = 'string' AND (e ->> 'workId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      OR (jsonb_typeof(e) = 'object' AND length(trim(e ->> 'title')) > 0 AND length(trim(e ->> 'author')) > 0), false)) THEN
    PERFORM enrichment_rule_error('A term needs at least three example books, a scale point its anchor book', 'enrichment_term_examples');
  END IF;
  IF NEW.parent_term_id IS NOT NULL THEN
    SELECT * INTO STRICT parent FROM enrichment_terms WHERE id = NEW.parent_term_id;
    IF parent.dimension_id <> NEW.dimension_id THEN
      PERFORM enrichment_rule_error('A parent term belongs to the same dimension', 'enrichment_term_parent');
    END IF;
  END IF;
  IF d.apply_target = 'work.work_type_id' THEN
    IF NEW.work_type_id IS NULL THEN
      PERFORM enrichment_rule_error('A form term governs a work type', 'enrichment_term_item');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.work_type_id IS NOT NULL THEN
    PERFORM enrichment_rule_error('Only a form term governs a work type', 'enrichment_term_item');
  END IF;
  SELECT * INTO STRICT f FROM taxonomy_families WHERE id = d.taxonomy_family_id;
  IF NOT f.is_system OR f.system_table = 'custom_taxonomy_items' THEN
    SELECT family_id INTO item_family FROM custom_taxonomy_items WHERE id = NEW.custom_item_id;
    IF NEW.custom_item_id IS NULL OR item_family IS DISTINCT FROM f.id THEN
      PERFORM enrichment_rule_error('The term''s item must be an item of its dimension''s family', 'enrichment_term_item');
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.system_item_id IS NULL THEN
    PERFORM enrichment_rule_error('The term''s item must be an item of its dimension''s family', 'enrichment_term_item');
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1)', f.system_table) INTO found_item USING NEW.system_item_id;
  IF NOT found_item THEN
    PERFORM enrichment_rule_error('The term''s item must be an item of its dimension''s family', 'enrichment_term_item');
  END IF;
  IF f.system_table = 'attributes' THEN
    SELECT category INTO item_category FROM attributes WHERE id = NEW.system_item_id;
    IF item_category IS DISTINCT FROM d.attribute_category THEN
      PERFORM enrichment_rule_error('The attribute must be in its dimension''s category', 'enrichment_term_item');
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_term_guard BEFORE INSERT OR UPDATE ON enrichment_terms
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_term();
--> statement-breakpoint
-- A governed item of a system family cannot be deleted; an item only a retired
-- term governs may go in its audited merge. TG_ARGV[0] is its Harmonize entity.
CREATE FUNCTION guard_governed_taxonomy_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM enrichment_terms t
    JOIN enrichment_dimensions d ON d.id = t.dimension_id
    JOIN taxonomy_families f ON f.id = d.taxonomy_family_id
    WHERE t.system_item_id = OLD.id AND f.system_table = TG_TABLE_NAME
    AND (t.retired_in IS NULL OR NOT enrichment_item_merging(TG_ARGV[0], OLD.id))) THEN
    RAISE EXCEPTION 'The book enrichment vocabulary governs this item. Retire its term in a new vocabulary version first.'
      USING ERRCODE = '23503', CONSTRAINT = 'enrichment_term_item';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
DO $$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['subjects', 'subjects'], ['genres', 'genres'], ['tags', 'tags'],
    ['book_categories', 'categories'], ['themes', 'themes'],
    ['literary_movements', 'literary-movements'], ['art_types', 'art-types'],
    ['art_movements', 'art-movements'], ['keywords', 'keywords'], ['attributes', 'attributes']
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER enrichment_governed_item BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_governed_taxonomy_item(%L)',
      pair[1], pair[2]
    );
  END LOOP;
END;
$$;
--> statement-breakpoint
-- A governed attribute keeps its dimension's category
CREATE FUNCTION guard_governed_attribute_category() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category IS DISTINCT FROM OLD.category AND EXISTS (SELECT 1 FROM enrichment_terms t
    JOIN enrichment_dimensions d ON d.id = t.dimension_id
    JOIN taxonomy_families f ON f.id = d.taxonomy_family_id
    WHERE t.system_item_id = OLD.id AND f.system_table = 'attributes' AND t.retired_in IS NULL) THEN
    PERFORM enrichment_rule_error('The book enrichment vocabulary governs this attribute; its category stays', 'enrichment_term_item');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_governed_attribute_category BEFORE UPDATE OF category ON attributes
FOR EACH ROW EXECUTE FUNCTION guard_governed_attribute_category();
--> statement-breakpoint
-- A claim's value fits its dimension and uses a current term (R4). Only its
-- decision changes, and a rejection is final; an audited merge moves its work,
-- person or place.
CREATE FUNCTION guard_enrichment_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d enrichment_dimensions%ROWTYPE; t enrichment_terms%ROWTYPE; values_ok boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.edition_id, NEW.dimension_id, NEW.term_id, NEW.number_value, NEW.text_value, NEW.method, NEW.run_id, NEW.vocabulary_version, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.edition_id, OLD.dimension_id, OLD.term_id, OLD.number_value, OLD.text_value, OLD.method, OLD.run_id, OLD.vocabulary_version, OLD.created_at)
      OR (NEW.work_id IS DISTINCT FROM OLD.work_id AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id))
      OR (NEW.person_id IS DISTINCT FROM OLD.person_id AND NOT harmonization_allows_move('authors', OLD.person_id, NEW.person_id))
      OR (NEW.place_id IS DISTINCT FROM OLD.place_id AND NOT harmonization_allows_move('places', OLD.place_id, NEW.place_id)) THEN
      PERFORM enrichment_rule_error('A claim''s value never changes; propose a new claim', 'enrichment_claim_identity');
    END IF;
    IF OLD.status = 'rejected' AND (NEW.status, NEW.decided_by, NEW.decision_reason, NEW.decided_at) IS DISTINCT FROM (OLD.status, OLD.decided_by, OLD.decision_reason, OLD.decided_at) THEN
      PERFORM enrichment_rule_error('A rejected claim stays rejected', 'enrichment_claim_decision');
    END IF;
    IF NEW.confidence IS DISTINCT FROM OLD.confidence AND NOT (OLD.status = 'proposed' AND NEW.status = 'proposed') THEN
      PERFORM enrichment_rule_error('A claim''s confidence changes only while it is proposed', 'enrichment_claim_decision');
    END IF;
    NEW.updated_at := now();
  END IF;
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = NEW.dimension_id;
  IF TG_OP = 'INSERT' THEN
    IF d.apply_target = 'none' THEN
      PERFORM enrichment_rule_error('A measurement is not a claim: nothing is applied for this dimension', 'enrichment_claim_dimension');
    END IF;
    IF NEW.vocabulary_version < d.introduced_in OR (d.retired_in IS NOT NULL AND NEW.vocabulary_version >= d.retired_in) THEN
      PERFORM enrichment_rule_error('The dimension is not current in this vocabulary version', 'enrichment_claim_dimension');
    END IF;
    values_ok := CASE d.value_kind
      WHEN 'term' THEN num_nonnulls(NEW.term_id) = 1 AND num_nonnulls(NEW.number_value, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'terms' THEN num_nonnulls(NEW.term_id) = 1 AND num_nonnulls(NEW.number_value, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'scale' THEN num_nonnulls(NEW.term_id, NEW.number_value) = 2 AND num_nonnulls(NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'number' THEN num_nonnulls(NEW.number_value) = 1 AND num_nonnulls(NEW.term_id, NEW.text_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'text' THEN num_nonnulls(NEW.text_value) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'identifier' THEN num_nonnulls(NEW.text_value) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.place_id, NEW.person_id) = 0
      WHEN 'place' THEN num_nonnulls(NEW.place_id) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.text_value, NEW.person_id) = 0
      WHEN 'person' THEN num_nonnulls(NEW.person_id) = 1 AND num_nonnulls(NEW.term_id, NEW.number_value, NEW.text_value, NEW.place_id) = 0
      ELSE false END;
    IF NOT values_ok THEN
      PERFORM enrichment_rule_error(format('A %s dimension takes a value of its own kind', d.value_kind), 'enrichment_claim_value');
    END IF;
    IF NEW.term_id IS NOT NULL THEN
      SELECT * INTO STRICT t FROM enrichment_terms WHERE id = NEW.term_id;
      IF t.dimension_id <> d.id THEN
        PERFORM enrichment_rule_error('The term belongs to another dimension', 'enrichment_claim_value');
      END IF;
      IF NEW.vocabulary_version < t.introduced_in OR (t.retired_in IS NOT NULL AND NEW.vocabulary_version >= t.retired_in) THEN
        PERFORM enrichment_rule_error('The term is not current in this vocabulary version', 'enrichment_claim_value');
      END IF;
      IF d.value_kind = 'scale' AND NEW.number_value <> t.scale_value THEN
        PERFORM enrichment_rule_error('A scale claim''s number is its anchor''s scale value', 'enrichment_claim_value');
      END IF;
    END IF;
  END IF;
  IF (d.entity_level = 'edition') <> (NEW.edition_id IS NOT NULL) THEN
    PERFORM enrichment_rule_error('An edition is set exactly for an edition-level dimension', 'enrichment_claim_edition');
  END IF;
  IF NEW.edition_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.work_id IS DISTINCT FROM OLD.work_id)
    AND NOT EXISTS (SELECT 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id) THEN
    PERFORM enrichment_rule_error('The edition belongs to another book', 'enrichment_claim_edition');
  END IF;
  IF NEW.rule_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.rule_id IS DISTINCT FROM OLD.rule_id)
    AND NOT EXISTS (SELECT 1 FROM enrichment_auto_accept_rules WHERE id = NEW.rule_id AND dimension_id = NEW.dimension_id) THEN
    PERFORM enrichment_rule_error('The rule belongs to another dimension', 'enrichment_claim_decision');
  END IF;
  IF NEW.superseded_by_claim_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.superseded_by_claim_id IS DISTINCT FROM OLD.superseded_by_claim_id)
    AND NOT EXISTS (SELECT 1 FROM enrichment_claims WHERE id = NEW.superseded_by_claim_id AND dimension_id = NEW.dimension_id) THEN
    PERFORM enrichment_rule_error('A claim is superseded by a claim of its own dimension', 'enrichment_claim_decision');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_claim_guard BEFORE INSERT OR UPDATE ON enrichment_claims
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_claim();
--> statement-breakpoint
-- At commit: an open or accepted api or agent claim has evidence (R1, R2); a
-- human claim is Pablo's accepted edit, or a proposal from his own export; a
-- claim that is no longer accepted has no value row.
CREATE FUNCTION validate_enrichment_claim() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c enrichment_claims%ROWTYPE; checked_claim uuid; inserted_status text; evidence_count integer;
BEGIN
  IF TG_TABLE_NAME = 'claim_evidence' THEN
    checked_claim := OLD.claim_id;
  ELSE
    checked_claim := NEW.id;
    IF TG_OP = 'INSERT' THEN inserted_status := NEW.status; END IF;
  END IF;
  SELECT * INTO c FROM enrichment_claims WHERE id = checked_claim;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT count(*) INTO evidence_count FROM claim_evidence e WHERE e.claim_id = c.id;
  IF c.method IN ('api', 'agent') AND c.status IN ('proposed', 'accepted') AND evidence_count = 0 THEN
    PERFORM enrichment_rule_error('A proposed or accepted claim from an API or an agent needs evidence', 'enrichment_claim_evidence');
  END IF;
  IF inserted_status IS NOT NULL AND c.method = 'human' THEN
    IF evidence_count = 0 AND NOT (c.status = 'accepted' AND c.decided_by = 'pablo') THEN
      PERFORM enrichment_rule_error('A human claim without evidence is only Pablo''s own accepted edit', 'enrichment_claim_evidence');
    END IF;
    IF inserted_status = 'proposed' AND (evidence_count = 0 OR EXISTS (SELECT 1 FROM claim_evidence e JOIN source_records s ON s.id = e.source_record_id
      WHERE e.claim_id = c.id AND s.provider <> 'storygraph_export')) THEN
      PERFORM enrichment_rule_error('A proposed human claim cites only Pablo''s own export', 'enrichment_claim_evidence');
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'enrichment_claims' AND c.status <> 'accepted' AND EXISTS (SELECT 1 FROM work_enrichment_values v WHERE v.claim_id = c.id) THEN
    PERFORM enrichment_rule_error('A value row needs its accepted claim', 'enrichment_value_claim');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enrichment_claim_evidence_required AFTER INSERT OR UPDATE ON enrichment_claims
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_enrichment_claim();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enrichment_evidence_removed AFTER DELETE ON claim_evidence
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_enrichment_claim();
--> statement-breakpoint
-- Evidence never changes (R3). It cites a source record of the claim's work
-- or one of its editions; an API excerpt is exactly the payload at its path,
-- and a text excerpt names the hash of the stored text.
CREATE FUNCTION guard_claim_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c enrichment_claims%ROWTYPE; s source_records%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    PERFORM enrichment_rule_error('Evidence never changes', 'claim_evidence_identity');
  END IF;
  SELECT * INTO STRICT c FROM enrichment_claims WHERE id = NEW.claim_id;
  SELECT * INTO s FROM source_records WHERE id = NEW.source_record_id;
  IF NOT FOUND THEN
    PERFORM enrichment_rule_error('The source record does not exist', 'claim_evidence_source');
  END IF;
  IF NOT (coalesce(s.work_id = c.work_id, false) OR EXISTS (SELECT 1 FROM editions WHERE id = s.edition_id AND work_id = c.work_id)) THEN
    PERFORM enrichment_rule_error('Evidence cites a source record of the claim''s book or one of its editions', 'claim_evidence_source');
  END IF;
  IF NEW.outlet <> s.provider THEN
    PERFORM enrichment_rule_error('The evidence outlet is its source record''s provider', 'claim_evidence_source');
  END IF;
  IF c.method IN ('api', 'agent') AND NEW.run_id IS NULL THEN
    PERFORM enrichment_rule_error('Evidence of an API or agent claim names its run', 'claim_evidence_source');
  END IF;
  IF NEW.locator = 'text' AND NEW.text_sha256 IS DISTINCT FROM s.payload ->> 'textSha256' THEN
    PERFORM enrichment_rule_error('The text hash differs from the stored text of the source', 'claim_evidence_excerpt');
  END IF;
  IF NEW.locator = 'payload' AND NEW.excerpt IS DISTINCT FROM s.payload #>> NEW.payload_path THEN
    PERFORM enrichment_rule_error('The excerpt differs from the source''s answer at its path', 'claim_evidence_excerpt');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER claim_evidence_guard BEFORE INSERT OR UPDATE ON claim_evidence
FOR EACH ROW EXECUTE FUNCTION guard_claim_evidence();
--> statement-breakpoint
-- At commit: a value row holds its accepted claim's value, and a number has one row per book
CREATE FUNCTION validate_work_enrichment_value() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v work_enrichment_values%ROWTYPE; d enrichment_dimensions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM work_enrichment_values WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = v.dimension_id;
  IF d.apply_target <> 'values' OR (d.value_kind = 'number') <> (v.number_value IS NOT NULL) OR (d.value_kind = 'place') <> (v.place_id IS NOT NULL) THEN
    PERFORM enrichment_rule_error('This dimension keeps no value rows of this kind', 'enrichment_value_claim');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM enrichment_claims c WHERE c.id = v.claim_id AND c.status = 'accepted'
    AND c.work_id = v.work_id AND c.dimension_id = v.dimension_id
    AND c.number_value IS NOT DISTINCT FROM v.number_value AND c.place_id IS NOT DISTINCT FROM v.place_id) THEN
    PERFORM enrichment_rule_error('A value row needs its accepted claim', 'enrichment_value_claim');
  END IF;
  IF d.value_kind = 'number' AND (SELECT count(*) FROM work_enrichment_values WHERE work_id = v.work_id AND dimension_id = v.dimension_id) > 1 THEN
    PERFORM enrichment_rule_error('A number dimension keeps one value per book', 'enrichment_value_claim');
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER enrichment_value_claim_required AFTER INSERT OR UPDATE ON work_enrichment_values
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_work_enrichment_value();
--> statement-breakpoint
-- The apply log: one claim's apply, kept as it was; only its undo is added later
CREATE FUNCTION guard_enrichment_application() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c enrichment_claims%ROWTYPE; d enrichment_dimensions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.claim_id, NEW.edition_id, NEW.dimension_id, NEW.target, NEW.before, NEW.after, NEW.applied_by, NEW.rule_id, NEW.batch_id, NEW.note, NEW.applied_at)
      IS DISTINCT FROM (OLD.id, OLD.claim_id, OLD.edition_id, OLD.dimension_id, OLD.target, OLD.before, OLD.after, OLD.applied_by, OLD.rule_id, OLD.batch_id, OLD.note, OLD.applied_at)
      OR (NEW.work_id IS DISTINCT FROM OLD.work_id AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id))
      OR (OLD.undone_at IS NOT NULL AND NEW.undone_at IS DISTINCT FROM OLD.undone_at) THEN
      PERFORM enrichment_rule_error('An apply is logged once; only its undo is recorded later', 'enrichment_application_identity');
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO STRICT c FROM enrichment_claims WHERE id = NEW.claim_id;
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = c.dimension_id;
  IF (NEW.work_id, NEW.edition_id, NEW.dimension_id, NEW.target) IS DISTINCT FROM (c.work_id, c.edition_id, c.dimension_id, d.apply_target) THEN
    PERFORM enrichment_rule_error('An apply names its claim''s book, edition, dimension and target', 'enrichment_application_claim');
  END IF;
  IF NEW.rule_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM enrichment_auto_accept_rules WHERE id = NEW.rule_id AND dimension_id = c.dimension_id) THEN
    PERFORM enrichment_rule_error('The rule belongs to another dimension', 'enrichment_application_claim');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_application_guard BEFORE INSERT OR UPDATE ON enrichment_applications
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_application();
--> statement-breakpoint
-- A rule exists only for an eligible dimension; an exact-identifier rule only for identity
CREATE FUNCTION guard_enrichment_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d enrichment_dimensions%ROWTYPE;
BEGIN
  SELECT * INTO STRICT d FROM enrichment_dimensions WHERE id = NEW.dimension_id;
  IF NOT d.auto_accept_eligible THEN
    PERFORM enrichment_rule_error('This dimension stays review-only: no rule may exist for it', 'enrichment_rule_dimension');
  END IF;
  IF NEW.basis = 'exact_identifier_match' AND d.layer <> 'identity' THEN
    PERFORM enrichment_rule_error('An exact identifier match rule is for identity dimensions only', 'enrichment_rule_dimension');
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_rule_guard BEFORE INSERT OR UPDATE ON enrichment_auto_accept_rules
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_rule();
