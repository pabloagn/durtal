CREATE TABLE "organization_roles" (
	"organization_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "organization_roles_organization_id_role_pk" PRIMARY KEY("organization_id","role"),
	CONSTRAINT "organization_role_check" CHECK ("organization_roles"."role" in ('perfume_house', 'brand', 'manufacturer', 'retailer', 'production_company', 'distribution_company', 'museum', 'gallery'))
);
--> statement-breakpoint
CREATE TABLE "organization_venues" (
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"role" text DEFAULT 'operator' NOT NULL,
	CONSTRAINT "organization_venues_organization_id_venue_id_role_pk" PRIMARY KEY("organization_id","venue_id","role"),
	CONSTRAINT "organization_venue_role_check" CHECK ("organization_venues"."role" in ('operator', 'owner'))
);
--> statement-breakpoint
ALTER TABLE "publishing_houses" DROP CONSTRAINT "publisher_kind_parent_check";--> statement-breakpoint
ALTER TABLE "publishing_houses" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "publisher_aliases" ADD COLUMN "search_text" text GENERATED ALWAYS AS (search_normalize(name)) STORED;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD COLUMN "search_text" text GENERATED ALWAYS AS (search_normalize(name)) STORED;--> statement-breakpoint
ALTER TABLE "organization_roles" ADD CONSTRAINT "organization_roles_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_venues" ADD CONSTRAINT "organization_venues_organization_id_publishing_houses_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_venues" ADD CONSTRAINT "organization_venues_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_role_idx" ON "organization_roles" USING btree ("role","organization_id");--> statement-breakpoint
CREATE INDEX "organization_venue_idx" ON "organization_venues" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "organization_alias_search_idx" ON "publisher_aliases" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "organization_search_idx" ON "publishing_houses" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD CONSTRAINT "publisher_kind_parent_check" CHECK (case when "publishing_houses"."kind" is null then "publishing_houses"."parent_id" is null else ("publishing_houses"."kind" = 'group' AND "publishing_houses"."parent_id" IS NULL) OR ("publishing_houses"."kind" = 'publisher' AND ("publishing_houses"."parent_id" IS NULL OR "publishing_houses"."parent_id" <> "publishing_houses"."id")) OR ("publishing_houses"."kind" = 'imprint' AND "publishing_houses"."parent_id" IS NOT NULL AND "publishing_houses"."parent_id" <> "publishing_houses"."id") end);--> statement-breakpoint
-- The optional book profile is required by legacy publisher relationships.
CREATE FUNCTION require_publisher_profile() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE identity_id uuid; profile_kind text;
BEGIN
 identity_id := CASE WHEN TG_TABLE_NAME = 'publishing_house_specialties' THEN (to_jsonb(NEW)->>'publishing_house_id')::uuid ELSE (to_jsonb(NEW)->>'publisher_id')::uuid END;
 IF identity_id IS NULL THEN RETURN NEW; END IF;
 SELECT kind INTO profile_kind FROM publishing_houses WHERE id=identity_id FOR SHARE;
 IF profile_kind IS NULL THEN
   RAISE EXCEPTION 'Choose an organization with a publisher or imprint profile' USING ERRCODE='23514', CONSTRAINT='publisher_profile_required';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER publisher_profile_required BEFORE INSERT OR UPDATE OF publisher_id ON edition_publishers FOR EACH ROW EXECUTE FUNCTION require_publisher_profile();
--> statement-breakpoint
CREATE TRIGGER publisher_profile_required BEFORE INSERT OR UPDATE OF publisher_id ON acquisition_targets FOR EACH ROW EXECUTE FUNCTION require_publisher_profile();
--> statement-breakpoint
CREATE TRIGGER publisher_profile_required BEFORE INSERT OR UPDATE OF publishing_house_id ON publishing_house_specialties FOR EACH ROW EXECUTE FUNCTION require_publisher_profile();
--> statement-breakpoint
-- ISBN prefixes and automatic decisions (0034) link book editions to publishers.
CREATE TRIGGER publisher_profile_required BEFORE INSERT OR UPDATE OF publisher_id ON publisher_isbn_prefixes FOR EACH ROW EXECUTE FUNCTION require_publisher_profile();
--> statement-breakpoint
CREATE TRIGGER publisher_profile_required BEFORE INSERT OR UPDATE OF publisher_id ON publisher_auto_decisions FOR EACH ROW EXECUTE FUNCTION require_publisher_profile();
--> statement-breakpoint
-- The live hierarchy rules (0036): an imprint belongs to a publisher, a publisher
-- to a group or nothing, and the houses below must fit a changed type. A shared
-- organization without a book profile (null kind) has no parent or children,
-- and a house that books use keeps its publishing profile.
CREATE OR REPLACE FUNCTION validate_publisher_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
BEGIN
 IF NEW.parent_id IS NOT NULL THEN
   SELECT kind INTO parent_kind FROM publishing_houses WHERE id = NEW.parent_id FOR SHARE;
   IF NEW.kind = 'imprint' AND parent_kind IS DISTINCT FROM 'publisher' THEN
     RAISE EXCEPTION 'An imprint belongs to a publisher';
   END IF;
   IF NEW.kind = 'publisher' AND parent_kind IS DISTINCT FROM 'group' THEN
     RAISE EXCEPTION 'A publisher belongs to a group';
   END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind AND EXISTS (
   SELECT 1 FROM publishing_houses c WHERE c.parent_id = NEW.id AND NOT coalesce(
     (NEW.kind = 'group' AND c.kind = 'publisher') OR (NEW.kind = 'publisher' AND c.kind = 'imprint'), false))
 THEN
   RAISE EXCEPTION 'The houses below it do not fit this type';
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.kind IS NOT NULL AND NEW.kind IS NULL AND (
   EXISTS(SELECT 1 FROM edition_publishers WHERE publisher_id = OLD.id)
   OR EXISTS(SELECT 1 FROM acquisition_targets WHERE publisher_id = OLD.id)
   OR EXISTS(SELECT 1 FROM publishing_house_specialties WHERE publishing_house_id = OLD.id)
   OR EXISTS(SELECT 1 FROM publisher_isbn_prefixes WHERE publisher_id = OLD.id)) THEN
   RAISE EXCEPTION 'Books use this publisher; it keeps its publishing profile';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
-- Organizations without a book profile never match a publisher name. Matching
-- keeps the live statement-level refresh and its triggers (0036).
CREATE OR REPLACE FUNCTION publisher_candidates(value text) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM publishing_houses WHERE kind IS NOT NULL AND publisher_name_key(name) = publisher_name_key(value)
 UNION SELECT a.publisher_id FROM publisher_aliases a JOIN publishing_houses p ON p.id=a.publisher_id
 WHERE p.kind IS NOT NULL AND publisher_name_key(a.name) = publisher_name_key(value)
$$;
