CREATE TYPE "public"."attribution_enum" AS ENUM('unspecified', 'confirmed', 'attributed', 'uncertain', 'anonymous', 'unknown');--> statement-breakpoint
CREATE TABLE "credit_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "work_kind_enum" NOT NULL,
	"level" text NOT NULL,
	"label" text NOT NULL,
	"legacy_role" text,
	CONSTRAINT "credit_role_legacy_unique" UNIQUE("kind","level","legacy_role"),
	CONSTRAINT "credit_role_level_check" CHECK ("credit_roles"."level" in ('work', 'edition'))
);
--> statement-breakpoint
CREATE TABLE "person_aliases" (
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"search_text" text GENERATED ALWAYS AS (search_normalize(name)) STORED,
	CONSTRAINT "person_aliases_person_id_name_pk" PRIMARY KEY("person_id","name"),
	CONSTRAINT "person_alias_name_check" CHECK (length(trim("person_aliases"."name")) between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "person_domains" (
	"person_id" uuid NOT NULL,
	"kind" "work_kind_enum" NOT NULL,
	CONSTRAINT "person_domains_person_id_kind_pk" PRIMARY KEY("person_id","kind")
);
--> statement-breakpoint
CREATE TABLE "work_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"person_id" uuid,
	"role_id" text NOT NULL,
	"credited_as" text,
	"attribution" "attribution_enum" DEFAULT 'unspecified' NOT NULL,
	"characters" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_credit_order_check" CHECK ("work_credits"."sort_order" >= 0),
	CONSTRAINT "work_credit_identity_check" CHECK ("work_credits"."person_id" is not null or coalesce(length(trim("work_credits"."credited_as")), 0) > 0 or "work_credits"."attribution" in ('anonymous', 'unknown')),
	CONSTRAINT "work_credit_characters_check" CHECK (cardinality("work_credits"."characters") <= 50 and array_position("work_credits"."characters", null) is null)
);
--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD COLUMN "credited_as" text;--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD COLUMN "attribution" "attribution_enum" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_authors" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "work_authors" ADD COLUMN "credited_as" text;--> statement-breakpoint
ALTER TABLE "work_authors" ADD COLUMN "attribution" "attribution_enum" DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "person_aliases" ADD CONSTRAINT "person_aliases_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_domains" ADD CONSTRAINT "person_domains_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_credits" ADD CONSTRAINT "work_credits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_credits" ADD CONSTRAINT "work_credits_person_id_authors_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."authors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_credits" ADD CONSTRAINT "work_credits_role_id_credit_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."credit_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_alias_search_idx" ON "person_aliases" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "work_credit_work_order_idx" ON "work_credits" USING btree ("work_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "work_credit_person_idx" ON "work_credits" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD CONSTRAINT "edition_contributors_id_unique" UNIQUE("id");--> statement-breakpoint
ALTER TABLE "work_authors" ADD CONSTRAINT "work_authors_id_unique" UNIQUE("id");
--> statement-breakpoint
INSERT INTO credit_roles(id,kind,level,label,legacy_role) VALUES
('book.author', 'book', 'work', 'Author', 'author'),
('book.co_author', 'book', 'work', 'Co-author', 'co_author'),
('book.edition.translator', 'book', 'edition', 'Translator', 'translator'),
('book.edition.editor', 'book', 'edition', 'Editor', 'editor'),
('book.edition.illustrator', 'book', 'edition', 'Illustrator', 'illustrator'),
('book.edition.foreword', 'book', 'edition', 'Foreword', 'foreword'),
('book.edition.introduction', 'book', 'edition', 'Introduction', 'introduction'),
('book.edition.afterword', 'book', 'edition', 'Afterword', 'afterword'),
('book.edition.photographer', 'book', 'edition', 'Photographer', 'photographer'),
('book.edition.compiler', 'book', 'edition', 'Compiler', 'compiler'),
('book.edition.narrator', 'book', 'edition', 'Narrator', 'narrator'),
('book.edition.other', 'book', 'edition', 'Other', 'other'),
('film.director', 'film', 'work', 'Director', NULL),
('film.screenwriter', 'film', 'work', 'Screenwriter', NULL),
('film.story', 'film', 'work', 'Story', NULL),
('film.cast', 'film', 'work', 'Cast', NULL),
('film.producer', 'film', 'work', 'Producer', NULL),
('film.cinematographer', 'film', 'work', 'Cinematographer', NULL),
('film.editor', 'film', 'work', 'Editor', NULL),
('film.composer', 'film', 'work', 'Composer', NULL),
('film.production_designer', 'film', 'work', 'Production designer', NULL),
('film.costume_designer', 'film', 'work', 'Costume designer', NULL),
('perfume.perfumer', 'perfume', 'work', 'Perfumer', NULL),
('perfume.creative_director', 'perfume', 'work', 'Creative director', NULL),
('painting.painter', 'painting', 'work', 'Painter', NULL);
--> statement-breakpoint
-- Preserve every historical role, including free-text imported roles. New
-- credits can only use a role registered for the correct domain and level.
INSERT INTO credit_roles(id,kind,level,label,legacy_role)
SELECT 'book.legacy.work.' || encode(convert_to(role,'UTF8'),'hex'), 'book', 'work', role, role FROM work_authors GROUP BY role
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO credit_roles(id,kind,level,label,legacy_role)
SELECT 'book.legacy.edition.' || encode(convert_to(role,'UTF8'),'hex'), 'book', 'edition', role, role FROM edition_contributors GROUP BY role
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO person_domains(person_id,kind) SELECT id,'book' FROM authors;
--> statement-breakpoint
CREATE FUNCTION register_legacy_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO person_domains(person_id,kind) VALUES(NEW.id,'book') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_author_domain AFTER INSERT ON authors FOR EACH ROW EXECUTE FUNCTION register_legacy_author();
--> statement-breakpoint
CREATE FUNCTION validate_legacy_person_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE credit_level text;
BEGIN
  credit_level := CASE WHEN TG_TABLE_NAME = 'work_authors' THEN 'work' ELSE 'edition' END;
  IF NOT EXISTS (SELECT 1 FROM credit_roles WHERE kind = 'book' AND level = credit_level AND legacy_role = NEW.role) THEN
    RAISE EXCEPTION 'Unknown book % contribution role: %', credit_level, NEW.role
      USING ERRCODE='23514', CONSTRAINT='credit_role_scope_check';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION register_legacy_credit_person() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO person_domains(person_id,kind) VALUES(NEW.author_id,'book') ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_work_credit_role BEFORE INSERT OR UPDATE ON work_authors FOR EACH ROW EXECUTE FUNCTION validate_legacy_person_credit();
--> statement-breakpoint
CREATE TRIGGER legacy_edition_credit_role BEFORE INSERT OR UPDATE ON edition_contributors FOR EACH ROW EXECUTE FUNCTION validate_legacy_person_credit();
--> statement-breakpoint
CREATE TRIGGER legacy_work_credit_person AFTER INSERT OR UPDATE ON work_authors FOR EACH ROW EXECUTE FUNCTION register_legacy_credit_person();
--> statement-breakpoint
CREATE TRIGGER legacy_edition_credit_person AFTER INSERT OR UPDATE ON edition_contributors FOR EACH ROW EXECUTE FUNCTION register_legacy_credit_person();
--> statement-breakpoint
CREATE FUNCTION validate_work_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE domain work_kind_enum;
BEGIN
  SELECT kind INTO domain FROM works WHERE id = NEW.work_id;
  IF domain IS NULL OR domain = 'book' OR NOT EXISTS (
    SELECT 1 FROM credit_roles WHERE id = NEW.role_id AND kind = domain AND level = 'work'
  ) THEN
    RAISE EXCEPTION 'Credit role does not apply to this work; books use their existing credit stores'
      USING ERRCODE='23514', CONSTRAINT='credit_role_scope_check';
  END IF;
  IF cardinality(NEW.characters) > 0 AND NEW.role_id <> 'film.cast' THEN
    RAISE EXCEPTION 'Characters belong to film cast credits'
      USING ERRCODE='23514', CONSTRAINT='credit_character_scope_check';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(NEW.characters) c WHERE length(trim(c)) NOT BETWEEN 1 AND 300) THEN
    RAISE EXCEPTION 'Character names must contain 1 to 300 characters'
      USING ERRCODE='23514', CONSTRAINT='credit_character_name_check';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER work_credit_scope BEFORE INSERT OR UPDATE ON work_credits FOR EACH ROW EXECUTE FUNCTION validate_work_credit();
--> statement-breakpoint
CREATE FUNCTION register_work_credit_person() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.person_id IS NOT NULL THEN
    INSERT INTO person_domains(person_id,kind) SELECT NEW.person_id,kind FROM works WHERE id = NEW.work_id
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER work_credit_person AFTER INSERT OR UPDATE ON work_credits FOR EACH ROW EXECUTE FUNCTION register_work_credit_person();
--> statement-breakpoint
CREATE FUNCTION protect_credit_role_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.kind,NEW.level,NEW.legacy_role) IS DISTINCT FROM (OLD.id,OLD.kind,OLD.level,OLD.legacy_role) THEN
    RAISE EXCEPTION 'Contribution role identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_role_identity BEFORE UPDATE ON credit_roles FOR EACH ROW EXECUTE FUNCTION protect_credit_role_identity();
--> statement-breakpoint
INSERT INTO credit_roles(id,kind,level,label,legacy_role) VALUES ('book.edition.contributor','book','edition','Contributor','contributor') ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION protect_legacy_credit_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'book' AND (
    (OLD.level = 'work' AND EXISTS (SELECT 1 FROM work_authors WHERE role = OLD.legacy_role)) OR
    (OLD.level = 'edition' AND EXISTS (SELECT 1 FROM edition_contributors WHERE role = OLD.legacy_role))
  ) THEN
    RAISE EXCEPTION 'Contribution role is in use' USING ERRCODE='23503';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER legacy_credit_role_delete BEFORE DELETE ON credit_roles FOR EACH ROW EXECUTE FUNCTION protect_legacy_credit_role();
