CREATE TABLE "authors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_name" text,
	"birth_year" smallint,
	"death_year" smallint,
	"nationality" text,
	"bio" text,
	"photo_s3_key" text,
	"website" text,
	"open_library_key" text,
	"goodreads_id" text,
	"metadata_source" text,
	"metadata_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_editions" (
	"collection_id" uuid NOT NULL,
	"edition_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_editions_collection_id_edition_id_pk" PRIMARY KEY("collection_id","edition_id")
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_s3_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "edition_contributors" (
	"edition_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"role" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "edition_contributors_edition_id_author_id_role_pk" PRIMARY KEY("edition_id","author_id","role")
);
--> statement-breakpoint
CREATE TABLE "edition_genres" (
	"edition_id" uuid NOT NULL,
	"genre_id" uuid NOT NULL,
	CONSTRAINT "edition_genres_edition_id_genre_id_pk" PRIMARY KEY("edition_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "edition_tags" (
	"edition_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "edition_tags_edition_id_tag_id_pk" PRIMARY KEY("edition_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"isbn_13" text,
	"isbn_10" text,
	"asin" text,
	"lccn" text,
	"oclc" text,
	"open_library_key" text,
	"google_books_id" text,
	"goodreads_id" text,
	"title" text NOT NULL,
	"subtitle" text,
	"publisher" text,
	"imprint" text,
	"publication_date" date,
	"publication_year" smallint,
	"publication_country" text,
	"edition_name" text,
	"edition_number" smallint,
	"printing_number" smallint,
	"is_first_edition" boolean DEFAULT false NOT NULL,
	"is_limited_edition" boolean DEFAULT false NOT NULL,
	"limited_edition_count" integer,
	"language" text DEFAULT 'en' NOT NULL,
	"is_translated" boolean DEFAULT false NOT NULL,
	"page_count" integer,
	"binding" text,
	"height_mm" smallint,
	"width_mm" smallint,
	"depth_mm" smallint,
	"weight_grams" integer,
	"illustration_type" text,
	"description" text,
	"table_of_contents" text,
	"cover_s3_key" text,
	"thumbnail_s3_key" text,
	"cover_source_url" text,
	"metadata_source" text,
	"metadata_last_fetched" timestamp with time zone,
	"metadata_locked" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editions_isbn_13_unique" UNIQUE("isbn_13"),
	CONSTRAINT "editions_isbn_10_unique" UNIQUE("isbn_10")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "genres_name_unique" UNIQUE("name"),
	CONSTRAINT "genres_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"s3_bronze_key" text,
	"s3_silver_key" text,
	"total_records" integer,
	"processed_records" integer DEFAULT 0 NOT NULL,
	"skipped_records" integer DEFAULT 0 NOT NULL,
	"error_records" integer DEFAULT 0 NOT NULL,
	"error_log" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"sub_location_id" uuid,
	"format" text,
	"condition" text,
	"has_dust_jacket" boolean,
	"has_slipcase" boolean,
	"condition_notes" text,
	"is_signed" boolean DEFAULT false NOT NULL,
	"signed_by" text,
	"inscription" text,
	"is_first_printing" boolean DEFAULT false NOT NULL,
	"provenance" text,
	"acquisition_type" text,
	"acquisition_date" date,
	"acquisition_source" text,
	"acquisition_price" numeric(10, 2),
	"acquisition_currency" text,
	"calibre_id" integer,
	"calibre_url" text,
	"file_size_bytes" bigint,
	"notes" text,
	"is_lent_out" boolean DEFAULT false NOT NULL,
	"lent_to" text,
	"lent_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"street" text,
	"city" text,
	"region" text,
	"country" text,
	"country_code" text,
	"postal_code" text,
	"latitude" double precision,
	"longitude" double precision,
	"icon" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid,
	"author_id" uuid,
	"type" text NOT NULL,
	"s3_key" text NOT NULL,
	"thumbnail_s3_key" text,
	"original_filename" text,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"size_bytes" integer,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_owner_check" CHECK ((work_id IS NOT NULL) != (author_id IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sub_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_name_unique" UNIQUE("name"),
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "work_authors" (
	"work_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"role" text DEFAULT 'author' NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "work_authors_work_id_author_id_role_pk" PRIMARY KEY("work_id","author_id","role")
);
--> statement-breakpoint
CREATE TABLE "work_subjects" (
	"work_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "work_subjects_work_id_subject_id_pk" PRIMARY KEY("work_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"original_language" text DEFAULT 'en' NOT NULL,
	"original_year" smallint,
	"description" text,
	"series_name" text,
	"series_position" text,
	"is_anthology" boolean DEFAULT false NOT NULL,
	"notes" text,
	"rating" smallint,
	"catalogue_status" text DEFAULT 'catalogued' NOT NULL,
	"metadata_source" text,
	"metadata_source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_editions" ADD CONSTRAINT "collection_editions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_editions" ADD CONSTRAINT "collection_editions_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD CONSTRAINT "edition_contributors_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_contributors" ADD CONSTRAINT "edition_contributors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_genres" ADD CONSTRAINT "edition_genres_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_genres" ADD CONSTRAINT "edition_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_tags" ADD CONSTRAINT "edition_tags_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edition_tags" ADD CONSTRAINT "edition_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editions" ADD CONSTRAINT "editions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "genres" ADD CONSTRAINT "genres_parent_id_genres_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."genres"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" ADD CONSTRAINT "instances_sub_location_id_sub_locations_id_fk" FOREIGN KEY ("sub_location_id") REFERENCES "public"."sub_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_locations" ADD CONSTRAINT "sub_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_authors" ADD CONSTRAINT "work_authors_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_authors" ADD CONSTRAINT "work_authors_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_subjects" ADD CONSTRAINT "work_subjects_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_subjects" ADD CONSTRAINT "work_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;