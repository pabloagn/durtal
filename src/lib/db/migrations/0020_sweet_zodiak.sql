CREATE TABLE "custom_taxonomy_item_editions" (
	"item_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	CONSTRAINT "custom_taxonomy_item_editions_item_id_edition_id_pk" PRIMARY KEY("item_id","edition_id")
);
--> statement-breakpoint
CREATE TABLE "custom_taxonomy_item_works" (
	"item_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	CONSTRAINT "custom_taxonomy_item_works_item_id_work_id_pk" PRIMARY KEY("item_id","work_id")
);
--> statement-breakpoint
CREATE TABLE "custom_taxonomy_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taxonomy_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"icon" text,
	"color" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_table" text,
	"entity_level" text DEFAULT 'work' NOT NULL,
	"hierarchical" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "taxonomy_families_name_unique" UNIQUE("name"),
	CONSTRAINT "taxonomy_families_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "art_movements" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "art_types" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "attributes" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "book_categories" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "genres" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "keywords" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "literary_movements" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "tags" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "themes" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_item_editions" ADD CONSTRAINT "custom_taxonomy_item_editions_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_item_editions" ADD CONSTRAINT "custom_taxonomy_item_editions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_item_works" ADD CONSTRAINT "custom_taxonomy_item_works_item_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_item_works" ADD CONSTRAINT "custom_taxonomy_item_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_items" ADD CONSTRAINT "custom_taxonomy_items_family_id_taxonomy_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."taxonomy_families"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_taxonomy_items" ADD CONSTRAINT "custom_taxonomy_items_parent_id_custom_taxonomy_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."custom_taxonomy_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_taxonomy_items_family_slug_idx" ON "custom_taxonomy_items" USING btree ("family_id","slug");--> statement-breakpoint
-- Backfill tag slugs from names
UPDATE "tags" SET "slug" = lower(regexp_replace(regexp_replace(trim("name"), '[^a-zA-Z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_slug_unique" UNIQUE("slug");--> statement-breakpoint
-- Seed system taxonomy families
INSERT INTO "taxonomy_families" ("name", "slug", "description", "icon", "is_system", "system_table", "entity_level", "hierarchical", "sort_order") VALUES
  ('Subjects', 'subjects', 'Work-level thematic classifications', 'Bookmark', true, 'subjects', 'work', false, 0),
  ('Genres', 'genres', 'Edition-level publishing categories', 'BookOpen', true, 'genres', 'edition', true, 1),
  ('Tags', 'tags', 'User-defined edition labels', 'Tag', true, 'tags', 'edition', false, 2),
  ('Categories', 'categories', 'Hierarchical book categories', 'FolderTree', true, 'book_categories', 'work', true, 3),
  ('Themes', 'themes', 'Thematic groupings', 'Palette', true, 'themes', 'work', true, 4),
  ('Literary Movements', 'literary-movements', 'Historical literary movements and schools', 'Landmark', true, 'literary_movements', 'work', true, 5),
  ('Art Types', 'art-types', 'Visual art and illustration types', 'Paintbrush', true, 'art_types', 'work', false, 6),
  ('Art Movements', 'art-movements', 'Art historical movements', 'Frame', true, 'art_movements', 'work', false, 7),
  ('Keywords', 'keywords', 'Free-form descriptive keywords', 'Hash', true, 'keywords', 'work', false, 8),
  ('Attributes', 'attributes', 'Structured metadata attributes', 'ListChecks', true, 'attributes', 'work', false, 9);