CREATE TABLE "enrichment_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"estimated_units" jsonb NOT NULL,
	"units" jsonb,
	"estimated_cost_usd" numeric NOT NULL,
	"cost_usd" numeric,
	"price_version" text NOT NULL,
	"work_id" uuid,
	"job_id" uuid,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "enrichment_cost_value_check" CHECK (provider ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(provider) <= 100 and length(trim(operation)) between 1 and 100 and status in ('reserved', 'settled', 'released') and jsonb_typeof(estimated_units) = 'object' and (units is null or jsonb_typeof(units) = 'object') and estimated_cost_usd >= 0 and (cost_usd is null or cost_usd >= 0) and length(trim(price_version)) between 1 and 100),
	CONSTRAINT "enrichment_cost_state_check" CHECK ((status = 'reserved' and settled_at is null and cost_usd is null and units is null) or (status = 'settled' and settled_at is not null and cost_usd is not null and units is not null) or (status = 'released' and settled_at is not null and cost_usd is null))
);
--> statement-breakpoint
CREATE TABLE "evidence_outlets" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domains" text[] NOT NULL,
	"kind" text NOT NULL,
	"language" text,
	"weight" numeric(4, 3) NOT NULL,
	"syndication_group" text,
	"fetch_policy" text NOT NULL,
	"terms_url" text,
	"terms_checked_on" date,
	"terms_note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"seed_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_outlet_value_check" CHECK (key ~ '^[a-z0-9]+([_-][a-z0-9]+)*$' and length(key) <= 100 and key not in ('wikidata', 'open_library', 'isbndb', 'google_books', 'wikipedia', 'library_of_congress', 'wikimedia_pageviews', 'durtal_research', 'storygraph_export', 'manual') and length(trim(name)) between 1 and 200 and cardinality(domains) between 1 and 20 and kind in ('review', 'essay', 'publisher', 'translator', 'academic', 'press') and (language is null or language ~ '^[a-z]{2}$') and weight between 0 and 1 and (syndication_group is null or syndication_group ~ '^[a-z0-9]+([_-][a-z0-9]+)*$') and status in ('active', 'retired') and seed_version >= 1 and (terms_url is null or (terms_url ~ '^https?://' and length(terms_url) <= 4000)) and (terms_note is null or length(terms_note) <= 500)),
	CONSTRAINT "evidence_outlet_policy_check" CHECK (fetch_policy in ('fetch', 'snippet_only', 'excluded') and (fetch_policy <> 'fetch' or terms_checked_on is not null))
);
--> statement-breakpoint
ALTER TABLE "enrichment_costs" ADD CONSTRAINT "enrichment_costs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_costs" ADD CONSTRAINT "enrichment_costs_job_id_enrichment_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."enrichment_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_cost_created_idx" ON "enrichment_costs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "enrichment_cost_run_idx" ON "enrichment_costs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "enrichment_cost_job_idx" ON "enrichment_costs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "enrichment_cost_work_idx" ON "enrichment_costs" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "enrichment_job_work_idx" ON "enrichment_jobs" USING btree ("work_id");--> statement-breakpoint
CREATE TRIGGER book_parent_required BEFORE INSERT OR UPDATE OF work_id ON enrichment_costs
FOR EACH ROW EXECUTE FUNCTION require_book_parent();
--> statement-breakpoint
-- Each domain is a lowercase host name that no other outlet lists, so a URL
-- has at most one outlet of each length; updated_at follows every change
CREATE FUNCTION guard_evidence_outlet() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE other text;
BEGIN
  IF EXISTS (SELECT 1 FROM unnest(NEW.domains) d WHERE d !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$') THEN
    PERFORM enrichment_rule_error('An outlet domain is a lowercase host name', 'evidence_outlet_domains');
  END IF;
  IF (SELECT count(*) FROM unnest(NEW.domains)) <> (SELECT count(DISTINCT d) FROM unnest(NEW.domains) d) THEN
    PERFORM enrichment_rule_error('An outlet lists each domain once', 'evidence_outlet_domains');
  END IF;
  SELECT key INTO other FROM evidence_outlets WHERE key <> NEW.key AND domains && NEW.domains LIMIT 1;
  IF FOUND THEN
    PERFORM enrichment_rule_error(format('A domain of this outlet is already the outlet %s''s', other), 'evidence_outlet_domains');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.key <> OLD.key THEN
      PERFORM enrichment_rule_error('An outlet''s key never changes: stored documents name it', 'evidence_outlet_identity');
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_outlet_guard BEFORE INSERT OR UPDATE ON evidence_outlets
FOR EACH ROW EXECUTE FUNCTION guard_evidence_outlet();
--> statement-breakpoint
-- An outlet is retired, never deleted: stored documents cite it
CREATE FUNCTION guard_evidence_outlet_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM enrichment_rule_error('An outlet is retired, never deleted', 'evidence_outlet_identity');
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_outlet_delete_guard BEFORE DELETE ON evidence_outlets
FOR EACH ROW EXECUTE FUNCTION guard_evidence_outlet_delete();
--> statement-breakpoint
-- The ledger is the audit log of spend: never deleted, and a row changes only
-- once, from reserved to settled or released. The foreign keys' SET NULL and
-- an audited Harmonize merge may still move its book.
CREATE FUNCTION guard_enrichment_cost() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM enrichment_rule_error('The cost ledger is never deleted', 'enrichment_cost_ledger');
  END IF;
  IF (NEW.id, NEW.provider, NEW.operation, NEW.estimated_units, NEW.estimated_cost_usd, NEW.price_version, NEW.run_id, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.provider, OLD.operation, OLD.estimated_units, OLD.estimated_cost_usd, OLD.price_version, OLD.run_id, OLD.created_at)
    OR (NEW.work_id IS DISTINCT FROM OLD.work_id AND NEW.work_id IS NOT NULL AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id))
    OR (NEW.job_id IS DISTINCT FROM OLD.job_id AND NEW.job_id IS NOT NULL) THEN
    PERFORM enrichment_rule_error('A ledger row never changes, except once from reserved to settled or released', 'enrichment_cost_ledger');
  END IF;
  IF (NEW.status, NEW.units, NEW.cost_usd, NEW.settled_at) IS DISTINCT FROM (OLD.status, OLD.units, OLD.cost_usd, OLD.settled_at)
    AND NOT (OLD.status = 'reserved' AND NEW.status IN ('settled', 'released')) THEN
    PERFORM enrichment_rule_error('A ledger row never changes, except once from reserved to settled or released', 'enrichment_cost_ledger');
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER enrichment_cost_guard BEFORE UPDATE OR DELETE ON enrichment_costs
FOR EACH ROW EXECUTE FUNCTION guard_enrichment_cost();
--> statement-breakpoint
-- Evidence documents: reuse finds a stored URL, and the S3 cleanup's in-use
-- check finds the keys a payload names
CREATE INDEX source_record_evidence_url_idx ON source_records (url) WHERE payload ->> 'kind' IN ('evidence_page', 'evidence_text');
--> statement-breakpoint
CREATE INDEX source_record_raw_key_idx ON source_records ((payload ->> 'rawKey')) WHERE payload ? 'rawKey';
--> statement-breakpoint
CREATE INDEX source_record_text_key_idx ON source_records ((payload ->> 'textKey')) WHERE payload ? 'textKey';
