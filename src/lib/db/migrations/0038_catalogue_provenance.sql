-- Civil Gregorian components retain the precision supplied by the source.
-- Bounds are ordering keys, not invented calendar dates. There is no civil year 0.
CREATE FUNCTION catalogue_month_days(y integer, m integer) RETURNS integer
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN m=2 THEN
   CASE WHEN mod(CASE WHEN y<0 THEN y+1 ELSE y END,4)=0
    AND (mod(CASE WHEN y<0 THEN y+1 ELSE y END,100)<>0 OR mod(CASE WHEN y<0 THEN y+1 ELSE y END,400)=0)
    THEN 29 ELSE 28 END
   WHEN m IN (4,6,9,11) THEN 30 ELSE 31 END
$$;
--> statement-breakpoint
CREATE FUNCTION catalogue_date_valid(y integer, m integer, d integer) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE WHEN y IS NULL THEN m IS NULL AND d IS NULL
   ELSE y BETWEEN -999999 AND 999999 AND y<>0
     AND (m IS NULL OR m BETWEEN 1 AND 12)
     AND (d IS NULL OR (m IS NOT NULL AND d BETWEEN 1 AND catalogue_month_days(y,m))) END
$$;
--> statement-breakpoint
CREATE FUNCTION catalogue_date_lower(y integer, m integer, d integer) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT y::bigint*10000 + coalesce(m,1)*100 + coalesce(d,1)
$$;
--> statement-breakpoint
CREATE FUNCTION catalogue_date_upper(y integer, m integer, d integer) RETURNS bigint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT y::bigint*10000 + coalesce(m,12)*100 + coalesce(d,catalogue_month_days(y,coalesce(m,12)))
$$;
--> statement-breakpoint
CREATE TABLE "catalogue_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"precision" text NOT NULL,
	"start_year" integer,
	"start_month" smallint,
	"start_day" smallint,
	"end_year" integer,
	"end_month" smallint,
	"end_day" smallint,
	"approximate" boolean DEFAULT false NOT NULL,
	"label" text,
	"lower_bound" bigint GENERATED ALWAYS AS (catalogue_date_lower(start_year,start_month,start_day)) STORED,
	"upper_bound" bigint GENERATED ALWAYS AS (catalogue_date_upper(coalesce(end_year,start_year),case when end_year is null then start_month else end_month end,case when end_year is null then start_day else end_day end)) STORED,
	CONSTRAINT "catalogue_date_components_check" CHECK (catalogue_date_valid("catalogue_dates"."start_year","catalogue_dates"."start_month","catalogue_dates"."start_day") and catalogue_date_valid("catalogue_dates"."end_year","catalogue_dates"."end_month","catalogue_dates"."end_day")),
	CONSTRAINT "catalogue_date_precision_check" CHECK (case "catalogue_dates"."precision" when 'unknown' then "catalogue_dates"."start_year" is null and "catalogue_dates"."end_year" is null when 'range' then "catalogue_dates"."start_year" is not null and "catalogue_dates"."end_year" is not null and "catalogue_dates"."lower_bound"<="catalogue_dates"."upper_bound" when 'year' then "catalogue_dates"."start_year" is not null and "catalogue_dates"."start_month" is null and "catalogue_dates"."end_year" is null when 'month' then "catalogue_dates"."start_year" is not null and "catalogue_dates"."start_month" is not null and "catalogue_dates"."start_day" is null and "catalogue_dates"."end_year" is null when 'day' then "catalogue_dates"."start_year" is not null and "catalogue_dates"."start_month" is not null and "catalogue_dates"."start_day" is not null and "catalogue_dates"."end_year" is null else false end),
	CONSTRAINT "catalogue_date_label_check" CHECK ("catalogue_dates"."label" is null or length(trim("catalogue_dates"."label")) between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "catalogue_identifiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text NOT NULL,
	"work_id" uuid,
	"edition_id" uuid,
	"person_id" uuid,
	"organization_id" uuid,
	"venue_id" uuid,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalogue_identifier_namespace_unique" UNIQUE("provider","entity_kind","external_id"),
	CONSTRAINT "catalogue_identifier_owner_check" CHECK (num_nonnulls(work_id,edition_id,person_id,organization_id,venue_id)=1 and case entity_kind when 'book' then work_id is not null when 'film' then work_id is not null when 'perfume' then work_id is not null when 'painting' then work_id is not null when 'edition' then edition_id is not null when 'person' then person_id is not null when 'organization' then organization_id is not null when 'venue' then venue_id is not null else false end),
	CONSTRAINT "catalogue_identifier_value_check" CHECK (length("catalogue_identifiers"."provider") between 1 and 100 and "catalogue_identifiers"."provider" ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and length(trim("catalogue_identifiers"."external_id")) between 1 and 500 and "catalogue_identifiers"."external_id"=trim("catalogue_identifiers"."external_id"))
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text NOT NULL,
	"work_id" uuid,
	"edition_id" uuid,
	"person_id" uuid,
	"organization_id" uuid,
	"venue_id" uuid,
	"identifier_id" uuid,
	"provider" text NOT NULL,
	"url" text,
	"attribution" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"review_status" text DEFAULT 'pending' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"supersedes_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_record_successor_unique" UNIQUE("supersedes_id"),
	CONSTRAINT "source_record_owner_check" CHECK (num_nonnulls(work_id,edition_id,person_id,organization_id,venue_id)=1 and case entity_kind when 'book' then work_id is not null when 'film' then work_id is not null when 'perfume' then work_id is not null when 'painting' then work_id is not null when 'edition' then edition_id is not null when 'person' then person_id is not null when 'organization' then organization_id is not null when 'venue' then venue_id is not null else false end),
	CONSTRAINT "source_record_review_check" CHECK ("source_records"."review_status" in ('pending','accepted','rejected')),
	CONSTRAINT "source_record_value_check" CHECK (length("source_records"."provider") between 1 and 100 and "source_records"."provider" ~ '^[a-z0-9]+([._-][a-z0-9]+)*$' and ("source_records"."url" is null or ("source_records"."url" ~ '^https?://' and length("source_records"."url") <= 4000)) and jsonb_typeof("source_records"."payload")='object' and "source_records"."payload_hash" ~ '^[a-f0-9]{64}$' and "source_records"."supersedes_id" is distinct from "source_records"."id")
);
--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogue_identifiers" ADD CONSTRAINT "catalogue_identifiers_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_identifier_id_catalogue_identifiers_id_fk" FOREIGN KEY ("identifier_id") REFERENCES "public"."catalogue_identifiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_supersedes_id_source_records_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_date_bounds_idx" ON "catalogue_dates" USING btree ("lower_bound","upper_bound");--> statement-breakpoint
CREATE INDEX "catalogue_identifier_work_idx" ON "catalogue_identifiers" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "catalogue_identifier_edition_idx" ON "catalogue_identifiers" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "catalogue_identifier_person_idx" ON "catalogue_identifiers" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "catalogue_identifier_organization_idx" ON "catalogue_identifiers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "catalogue_identifier_venue_idx" ON "catalogue_identifiers" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "source_record_work_idx" ON "source_records" USING btree ("work_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "source_record_edition_idx" ON "source_records" USING btree ("edition_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "source_record_person_idx" ON "source_records" USING btree ("person_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "source_record_organization_idx" ON "source_records" USING btree ("organization_id","retrieved_at");--> statement-breakpoint
CREATE INDEX "source_record_venue_idx" ON "source_records" USING btree ("venue_id","retrieved_at");
--> statement-breakpoint
CREATE INDEX "source_record_identifier_idx" ON "source_records" USING btree ("identifier_id");

--> statement-breakpoint
CREATE FUNCTION guard_catalogue_source_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_owner uuid; new_owner uuid; merge_entity text; actual_kind text;
BEGIN
 new_owner:=coalesce(NEW.work_id,NEW.edition_id,NEW.person_id,NEW.organization_id,NEW.venue_id);
 IF NEW.work_id IS NOT NULL THEN
   SELECT kind::text INTO actual_kind FROM works WHERE id=NEW.work_id FOR KEY SHARE;
   IF actual_kind IS DISTINCT FROM NEW.entity_kind THEN RAISE EXCEPTION 'Source entity kind must match its work'; END IF;
 END IF;
 IF TG_OP='UPDATE' THEN
   old_owner:=coalesce(OLD.work_id,OLD.edition_id,OLD.person_id,OLD.organization_id,OLD.venue_id);
   IF NEW.entity_kind IS DISTINCT FROM OLD.entity_kind THEN RAISE EXCEPTION 'Source entity kind is immutable'; END IF;
   IF old_owner IS DISTINCT FROM new_owner THEN
     merge_entity:=CASE OLD.entity_kind WHEN 'book' THEN 'works' WHEN 'person' THEN 'authors' WHEN 'organization' THEN 'publishers' WHEN 'venue' THEN 'venues' ELSE NULL END;
     IF merge_entity IS NULL OR NOT harmonization_allows_move(merge_entity,old_owner,new_owner) THEN
       RAISE EXCEPTION 'Source ownership can only move through an audited merge';
     END IF;
   END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER catalogue_identifier_owner_guard BEFORE INSERT OR UPDATE ON catalogue_identifiers
FOR EACH ROW EXECUTE FUNCTION guard_catalogue_source_owner();
--> statement-breakpoint
CREATE TRIGGER source_record_owner_guard BEFORE INSERT OR UPDATE ON source_records
FOR EACH ROW EXECUTE FUNCTION guard_catalogue_source_owner();
--> statement-breakpoint
CREATE FUNCTION guard_catalogue_identifier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id,NEW.provider,NEW.external_id,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.provider,OLD.external_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Provider identifiers are immutable; register a reviewed replacement';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER catalogue_identifier_identity_guard BEFORE UPDATE ON catalogue_identifiers
FOR EACH ROW EXECUTE FUNCTION guard_catalogue_identifier();
--> statement-breakpoint
CREATE FUNCTION guard_source_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous source_records%ROWTYPE;
BEGIN
 IF NEW.url IS NOT NULL AND (NEW.url !~ '^https?://[^/?#[:space:]]+' OR NEW.url ~ '^https?://[^/?#]*@' OR NEW.url ~ '[[:space:]]') THEN
   RAISE EXCEPTION 'Source links require HTTP(S) and cannot contain credentials or whitespace';
 END IF;
 IF NEW.attribution IS NOT NULL AND length(trim(NEW.attribution)) NOT BETWEEN 1 AND 1000 THEN
   RAISE EXCEPTION 'Source attribution must contain 1 to 1000 characters';
 END IF;
 IF NEW.verified_at IS NOT NULL AND NEW.verified_at < NEW.retrieved_at THEN
   RAISE EXCEPTION 'Verification cannot precede source retrieval';
 END IF;
 IF TG_OP='INSERT' THEN
   NEW.revision:=0;
   IF NEW.supersedes_id IS NOT NULL THEN
     SELECT * INTO previous FROM source_records WHERE id=NEW.supersedes_id FOR UPDATE;
     IF NOT FOUND THEN RAISE EXCEPTION 'Previous source observation not found'; END IF;
     IF previous.locked THEN RAISE EXCEPTION 'This source observation is manually locked'; END IF;
     IF NEW.retrieved_at < previous.retrieved_at THEN RAISE EXCEPTION 'A refresh cannot be older than its previous observation'; END IF;
     IF (NEW.entity_kind,NEW.work_id,NEW.edition_id,NEW.person_id,NEW.organization_id,NEW.venue_id,NEW.provider,NEW.identifier_id,NEW.url)
       IS DISTINCT FROM (previous.entity_kind,previous.work_id,previous.edition_id,previous.person_id,previous.organization_id,previous.venue_id,previous.provider,previous.identifier_id,previous.url)
       THEN RAISE EXCEPTION 'A refresh must retain its source identity and owner'; END IF;
   END IF;
 ELSE
   IF (NEW.id,NEW.provider,NEW.url,NEW.attribution,NEW.retrieved_at,NEW.payload,NEW.payload_hash,NEW.created_at)
     IS DISTINCT FROM (OLD.id,OLD.provider,OLD.url,OLD.attribution,OLD.retrieved_at,OLD.payload,OLD.payload_hash,OLD.created_at) THEN
     RAISE EXCEPTION 'Source observations are immutable; append a refresh';
   END IF;
   IF (NEW.identifier_id IS DISTINCT FROM OLD.identifier_id OR NEW.supersedes_id IS DISTINCT FROM OLD.supersedes_id)
     AND NOT (pg_trigger_depth()>1 AND (NEW.identifier_id IS NULL OR NEW.identifier_id=OLD.identifier_id)
       AND (NEW.supersedes_id IS NULL OR NEW.supersedes_id=OLD.supersedes_id)) THEN
     RAISE EXCEPTION 'Source observation references are immutable';
   END IF;
   NEW.revision:=OLD.revision+1;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER source_record_observation_guard BEFORE INSERT OR UPDATE ON source_records
FOR EACH ROW EXECUTE FUNCTION guard_source_observation();
--> statement-breakpoint
-- Deferred identity checks allow the audited merge to reparent identifiers and
-- observations in separate statements, while requiring consistency at commit.
CREATE FUNCTION validate_source_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s source_records%ROWTYPE; ref_id uuid;
BEGIN
 IF TG_TABLE_NAME='catalogue_identifiers' THEN
   IF EXISTS (SELECT 1 FROM source_records r JOIN catalogue_identifiers i ON i.id=r.identifier_id
     WHERE i.id=NEW.id AND (r.entity_kind,r.work_id,r.edition_id,r.person_id,r.organization_id,r.venue_id,r.provider)
     IS DISTINCT FROM (i.entity_kind,i.work_id,i.edition_id,i.person_id,i.organization_id,i.venue_id,i.provider)) THEN
     RAISE EXCEPTION 'Source identifier must belong to the same owner and provider';
   END IF;
   RETURN NULL;
 END IF;
 SELECT * INTO s FROM source_records WHERE id=NEW.id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF s.identifier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM catalogue_identifiers i WHERE i.id=s.identifier_id
   AND (s.entity_kind,s.work_id,s.edition_id,s.person_id,s.organization_id,s.venue_id,s.provider)
   IS NOT DISTINCT FROM (i.entity_kind,i.work_id,i.edition_id,i.person_id,i.organization_id,i.venue_id,i.provider)) THEN
   RAISE EXCEPTION 'Source identifier must belong to the same owner and provider';
 END IF;
 IF s.supersedes_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM source_records p WHERE p.id=s.supersedes_id
   AND (s.entity_kind,s.work_id,s.edition_id,s.person_id,s.organization_id,s.venue_id,s.provider,s.identifier_id,s.url)
   IS NOT DISTINCT FROM (p.entity_kind,p.work_id,p.edition_id,p.person_id,p.organization_id,p.venue_id,p.provider,p.identifier_id,p.url)) THEN
   RAISE EXCEPTION 'Source history must retain its owner and identity';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER source_record_reference_guard AFTER INSERT OR UPDATE ON source_records
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_source_references();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER catalogue_identifier_reference_guard AFTER UPDATE ON catalogue_identifiers
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_source_references();
