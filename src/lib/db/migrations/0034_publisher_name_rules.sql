CREATE TABLE "ignored_publisher_names" (
	"name_key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ignored_publisher_name_key" CHECK ("ignored_publisher_names"."name_key" = publisher_name_key("ignored_publisher_names"."name"))
);
--> statement-breakpoint
CREATE TABLE "publisher_auto_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name_key" text NOT NULL,
	"name" text NOT NULL,
	"action" text NOT NULL,
	"publisher_id" uuid,
	"reason" text NOT NULL,
	"edition_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "publisher_auto_decision_action" CHECK ("publisher_auto_decisions"."action" in ('alias', 'create'))
);
--> statement-breakpoint
CREATE TABLE "publisher_isbn_prefixes" (
	"prefix" text PRIMARY KEY NOT NULL,
	"publisher_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_isbn_prefix_format" CHECK ("publisher_isbn_prefixes"."prefix" ~ '^97[89][0-9]{2,10}$')
);
--> statement-breakpoint
ALTER TABLE "publisher_auto_decisions" ADD CONSTRAINT "publisher_auto_decisions_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publisher_isbn_prefixes" ADD CONSTRAINT "publisher_isbn_prefixes_publisher_id_publishing_houses_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publisher_auto_decisions_publisher_idx" ON "publisher_auto_decisions" USING btree ("publisher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "publisher_auto_decisions_name_key" ON "publisher_auto_decisions" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "publisher_isbn_prefixes_publisher_idx" ON "publisher_isbn_prefixes" USING btree ("publisher_id");
--> statement-breakpoint
-- The 13-digit ISBN of an edition (an ISBN-10 becomes 978 + its first nine
-- digits, enough for prefix rules), or NULL.
CREATE FUNCTION edition_isbn_digits(isbn13 text, isbn10 text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT CASE
   WHEN regexp_replace(coalesce(isbn13, ''), '[^0-9]', '', 'g') ~ '^97[89][0-9]{10}$'
     THEN regexp_replace(isbn13, '[^0-9]', '', 'g')
   WHEN regexp_replace(coalesce(isbn10, ''), '[^0-9Xx]', '', 'g') ~ '^[0-9]{9}[0-9Xx]$'
     THEN '978' || left(regexp_replace(isbn10, '[^0-9Xx]', '', 'g'), 9)
 END
$$;
--> statement-breakpoint
-- Names first, as before, except names marked as not publishers. When no name
-- identifies exactly one house, the longest ISBN prefix rule links the edition.
CREATE OR REPLACE FUNCTION refresh_edition_publishers(edition_id_arg uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e editions; candidate uuid; total integer; source_name text; isbn text; linked boolean := false;
BEGIN
 SELECT * INTO e FROM editions WHERE id = edition_id_arg FOR UPDATE;
 IF NOT FOUND OR e.publisher_links_confirmed THEN RETURN; END IF;
 DELETE FROM edition_publishers WHERE edition_id = e.id;
 FOREACH source_name IN ARRAY ARRAY[e.publisher, e.imprint] LOOP
   IF nullif(trim(source_name), '') IS NULL THEN CONTINUE; END IF;
   IF EXISTS (SELECT 1 FROM ignored_publisher_names WHERE name_key = publisher_name_key(source_name)) THEN CONTINUE; END IF;
   SELECT count(*), (array_agg(id))[1] INTO total, candidate FROM publisher_candidates(source_name) id;
   IF total = 1 THEN
     INSERT INTO edition_publishers VALUES(e.id, candidate) ON CONFLICT DO NOTHING;
     linked := true;
   END IF;
 END LOOP;
 IF NOT linked THEN
   isbn := edition_isbn_digits(e.isbn_13, e.isbn_10);
   IF isbn IS NOT NULL THEN
     SELECT publisher_id INTO candidate FROM publisher_isbn_prefixes
      WHERE isbn LIKE prefix || '%' ORDER BY length(prefix) DESC LIMIT 1;
     IF FOUND THEN
       INSERT INTO edition_publishers VALUES(e.id, candidate) ON CONFLICT DO NOTHING;
     END IF;
   END IF;
 END IF;
END $$;
--> statement-breakpoint
DROP TRIGGER edition_publisher_identity ON editions;
--> statement-breakpoint
CREATE TRIGGER edition_publisher_identity AFTER INSERT OR UPDATE OF publisher, imprint, isbn_13, isbn_10, publisher_links_confirmed ON editions
 FOR EACH ROW EXECUTE FUNCTION sync_edition_publishers();
--> statement-breakpoint
CREATE TRIGGER publisher_prefixes_changed AFTER INSERT OR UPDATE OR DELETE ON publisher_isbn_prefixes FOR EACH STATEMENT EXECUTE FUNCTION refresh_publisher_matches();
--> statement-breakpoint
CREATE TRIGGER ignored_publisher_names_changed AFTER INSERT OR UPDATE OR DELETE ON ignored_publisher_names FOR EACH STATEMENT EXECUTE FUNCTION refresh_publisher_matches();
