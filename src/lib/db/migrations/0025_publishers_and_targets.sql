CREATE TABLE "acquisition_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"publisher_id" uuid,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acquisition_target_kind_check" CHECK ("acquisition_targets"."edition_id" IS NULL OR "acquisition_targets"."publisher_id" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "edition_publishers" (
	"edition_id" uuid NOT NULL,
	"publisher_id" uuid NOT NULL,
	CONSTRAINT "edition_publishers_edition_id_publisher_id_pk" PRIMARY KEY("edition_id","publisher_id")
);
--> statement-breakpoint
CREATE TABLE "publisher_aliases" (
	"publisher_id" uuid NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "publisher_aliases_publisher_id_name_pk" PRIMARY KEY("publisher_id","name")
);
--> statement-breakpoint
ALTER TABLE "publishing_houses" DROP CONSTRAINT "publishing_houses_name_unique";--> statement-breakpoint
ALTER TABLE "editions" ADD COLUMN "publisher_links_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "acquisition_target_id" uuid;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD COLUMN "kind" text DEFAULT 'publisher' NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD COLUMN "is_favourite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_targets" ADD CONSTRAINT "acquisition_targets_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_publishers" ADD CONSTRAINT "edition_publishers_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_publishers" ADD CONSTRAINT "edition_publishers_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_aliases" ADD CONSTRAINT "publisher_aliases_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisition_targets_work_idx" ON "acquisition_targets" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "acquisition_targets_publisher_idx" ON "acquisition_targets" USING btree ("publisher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "acquisition_targets_active_unique" ON "acquisition_targets" USING btree ("work_id",coalesce("edition_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("publisher_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE NOT "acquisition_targets"."is_cancelled";--> statement-breakpoint
CREATE INDEX "edition_publishers_publisher_idx" ON "edition_publishers" USING btree ("publisher_id");--> statement-breakpoint
CREATE INDEX "publisher_aliases_name_idx" ON "publisher_aliases" USING btree ("name");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_acquisition_target_id_acquisition_targets_id_fk" FOREIGN KEY ("acquisition_target_id") REFERENCES "public"."acquisition_targets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD CONSTRAINT "publishing_houses_parent_id_publishing_houses_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."publishing_houses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_acquisition_target_idx" ON "orders" USING btree ("acquisition_target_id");--> statement-breakpoint
CREATE INDEX "publishing_houses_name_idx" ON "publishing_houses" USING btree ("name");--> statement-breakpoint
CREATE INDEX "publishing_houses_parent_idx" ON "publishing_houses" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD CONSTRAINT "publisher_kind_parent_check" CHECK (("publishing_houses"."kind" = 'publisher' AND "publishing_houses"."parent_id" IS NULL) OR ("publishing_houses"."kind" = 'imprint' AND "publishing_houses"."parent_id" IS NOT NULL AND "publishing_houses"."parent_id" <> "publishing_houses"."id"));--> statement-breakpoint
-- Conservative identity resolution shared by the web app, API, and Python imports.
CREATE FUNCTION publisher_name_key(value text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT lower(regexp_replace(trim(value), '\s+', ' ', 'g'))
$$;
--> statement-breakpoint
CREATE FUNCTION publisher_candidates(value text) RETURNS SETOF uuid LANGUAGE sql STABLE AS $$
 SELECT id FROM publishing_houses WHERE publisher_name_key(name) = publisher_name_key(value)
 UNION SELECT publisher_id FROM publisher_aliases WHERE publisher_name_key(name) = publisher_name_key(value)
$$;
--> statement-breakpoint
CREATE FUNCTION refresh_edition_publishers(edition_id_arg uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e editions; candidate uuid; total integer; source_name text;
BEGIN
 SELECT * INTO e FROM editions WHERE id = edition_id_arg FOR UPDATE;
 IF NOT FOUND OR e.publisher_links_confirmed THEN RETURN; END IF;
 DELETE FROM edition_publishers WHERE edition_id = e.id;
 FOREACH source_name IN ARRAY ARRAY[e.publisher, e.imprint] LOOP
   IF nullif(trim(source_name), '') IS NULL THEN CONTINUE; END IF;
   SELECT count(*), (array_agg(id))[1] INTO total, candidate FROM publisher_candidates(source_name) id;
   IF total = 1 THEN
     INSERT INTO edition_publishers VALUES(e.id, candidate) ON CONFLICT DO NOTHING;
   END IF;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION sync_edition_publishers() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM refresh_edition_publishers(NEW.id); RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER edition_publisher_identity AFTER INSERT OR UPDATE OF publisher, imprint, publisher_links_confirmed ON editions
 FOR EACH ROW EXECUTE FUNCTION sync_edition_publishers();
--> statement-breakpoint
CREATE FUNCTION refresh_publisher_matches() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edition_id_arg uuid;
BEGIN
 FOR edition_id_arg IN SELECT id FROM editions WHERE NOT publisher_links_confirmed ORDER BY id LOOP
   PERFORM refresh_edition_publishers(edition_id_arg);
 END LOOP;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER publisher_names_changed AFTER INSERT OR UPDATE OF name OR DELETE ON publishing_houses FOR EACH STATEMENT EXECUTE FUNCTION refresh_publisher_matches();
--> statement-breakpoint
CREATE TRIGGER publisher_aliases_changed AFTER INSERT OR UPDATE OR DELETE ON publisher_aliases FOR EACH STATEMENT EXECUTE FUNCTION refresh_publisher_matches();
--> statement-breakpoint
CREATE FUNCTION validate_publisher_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM publishing_houses WHERE id = NEW.parent_id AND kind = 'publisher') THEN
   RAISE EXCEPTION 'Choose a publishing house as the imprint parent';
 END IF;
 IF TG_OP = 'UPDATE' AND (OLD.kind IS DISTINCT FROM NEW.kind OR OLD.parent_id IS DISTINCT FROM NEW.parent_id) AND
   (EXISTS(SELECT 1 FROM edition_publishers WHERE publisher_id = OLD.id) OR
    EXISTS(SELECT 1 FROM acquisition_targets WHERE publisher_id = OLD.id) OR
    EXISTS(SELECT 1 FROM publishing_houses WHERE parent_id = OLD.id)) THEN
   RAISE EXCEPTION 'This publisher identity is in use; its type and parent cannot be changed';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER publisher_parent_guard BEFORE INSERT OR UPDATE ON publishing_houses FOR EACH ROW EXECUTE FUNCTION validate_publisher_parent();
--> statement-breakpoint
CREATE FUNCTION set_edition_publishers(edition_id_arg uuid, publisher_ids uuid[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF cardinality(publisher_ids) > 20 THEN RAISE EXCEPTION 'Too many publishers'; END IF;
 PERFORM 1 FROM editions WHERE id = edition_id_arg FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Edition not found'; END IF;
 UPDATE editions SET publisher_links_confirmed = true, updated_at = now() WHERE id = edition_id_arg;
 DELETE FROM edition_publishers WHERE edition_id = edition_id_arg;
 INSERT INTO edition_publishers SELECT edition_id_arg, id FROM (SELECT DISTINCT unnest(publisher_ids) id) ids;
END $$;
--> statement-breakpoint
CREATE FUNCTION target_accepts_edition(target_id uuid, edition_id_arg uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM acquisition_targets t JOIN editions e ON e.work_id = t.work_id
  WHERE t.id = target_id AND e.id = edition_id_arg AND
  (t.edition_id IS NULL OR t.edition_id = e.id) AND
  (t.publisher_id IS NULL OR EXISTS (
    SELECT 1 FROM edition_publishers ep JOIN publishing_houses p ON p.id = ep.publisher_id
    WHERE ep.edition_id = e.id AND (p.id = t.publisher_id OR p.parent_id = t.publisher_id)
  ))
 )
$$;
--> statement-breakpoint
CREATE FUNCTION validate_acquisition_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.edition_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id) THEN
   RAISE EXCEPTION 'The target edition belongs to another book';
 END IF;
 IF TG_OP = 'UPDATE' AND (NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id) THEN
   RAISE EXCEPTION 'Create a new target instead of changing its identity';
 END IF;
 IF NEW.is_cancelled AND EXISTS (SELECT 1 FROM orders WHERE acquisition_target_id = NEW.id AND status NOT IN ('cancelled', 'returned')) THEN
   RAISE EXCEPTION 'Cancel or return the linked order before removing this target';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER acquisition_target_guard BEFORE INSERT OR UPDATE ON acquisition_targets FOR EACH ROW EXECUTE FUNCTION validate_acquisition_target();
--> statement-breakpoint
CREATE FUNCTION validate_target_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t acquisition_targets;
BEGIN
 IF NEW.acquisition_target_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO t FROM acquisition_targets WHERE id = NEW.acquisition_target_id FOR UPDATE;
 IF NOT FOUND OR t.work_id <> NEW.work_id THEN RAISE EXCEPTION 'Choose a target for this book'; END IF;
 IF t.is_cancelled THEN RAISE EXCEPTION 'This acquisition target was removed'; END IF;
 IF NEW.edition_id IS NOT NULL AND NOT target_accepts_edition(t.id, NEW.edition_id) THEN
   RAISE EXCEPTION 'This edition does not match the acquisition target';
 END IF;
 IF NEW.status IN ('delivered', 'received', 'purchased') AND NEW.edition_id IS NULL THEN
   RAISE EXCEPTION 'Select the received edition before completing this target';
 END IF;
 IF NEW.instance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM instances WHERE id = NEW.instance_id AND edition_id = NEW.edition_id) THEN
   RAISE EXCEPTION 'The received copy does not match the ordered edition';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER target_order_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION validate_target_order();
--> statement-breakpoint
CREATE FUNCTION protect_target_edition_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.work_id <> NEW.work_id AND (EXISTS(SELECT 1 FROM acquisition_targets WHERE edition_id = OLD.id) OR EXISTS(SELECT 1 FROM orders WHERE edition_id = OLD.id AND acquisition_target_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'An edition with acquisition targets cannot move to another book';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER target_edition_work_guard BEFORE UPDATE OF work_id ON editions FOR EACH ROW EXECUTE FUNCTION protect_target_edition_work();
--> statement-breakpoint
-- Existing source values are untouched. Only globally unambiguous exact names link.
SELECT refresh_edition_publishers(id) FROM editions ORDER BY id;
