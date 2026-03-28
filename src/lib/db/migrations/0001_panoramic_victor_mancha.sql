CREATE TABLE "art_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "art_movements_name_unique" UNIQUE("name"),
	CONSTRAINT "art_movements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "art_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"applicable_work_types" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "art_types_name_unique" UNIQUE("name"),
	CONSTRAINT "art_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attributes_name_unique" UNIQUE("name"),
	CONSTRAINT "attributes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "author_contribution_types" (
	"author_id" uuid NOT NULL,
	"contribution_type_id" uuid NOT NULL,
	CONSTRAINT "author_contribution_types_author_id_contribution_type_id_pk" PRIMARY KEY("author_id","contribution_type_id")
);
--> statement-breakpoint
CREATE TABLE "book_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"level" smallint NOT NULL,
	"parent_id" uuid,
	"scope_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "centuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"start_year" smallint NOT NULL,
	"end_year" smallint NOT NULL,
	"sort_order" smallint NOT NULL,
	CONSTRAINT "centuries_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "contribution_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"applicable_work_types" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contribution_types_name_unique" UNIQUE("name"),
	CONSTRAINT "contribution_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"alpha_2" text NOT NULL,
	"alpha_3" text NOT NULL,
	"numeric_code" smallint,
	"continent_name" text,
	"continent_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_name_unique" UNIQUE("name"),
	CONSTRAINT "countries_alpha_2_unique" UNIQUE("alpha_2"),
	CONSTRAINT "countries_alpha_3_unique" UNIQUE("alpha_3")
);
--> statement-breakpoint
CREATE TABLE "keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "keywords_name_unique" UNIQUE("name"),
	CONSTRAINT "keywords_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"iso_639_1" text,
	"iso_639_2" text,
	"iso_639_3" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "languages_name_unique" UNIQUE("name"),
	CONSTRAINT "languages_iso_639_1_unique" UNIQUE("iso_639_1")
);
--> statement-breakpoint
CREATE TABLE "literary_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"level" smallint NOT NULL,
	"parent_id" uuid,
	"scope_notes" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "literary_movements_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "publisher_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publisher_specialties_name_unique" UNIQUE("name"),
	CONSTRAINT "publisher_specialties_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "publishing_house_specialties" (
	"publishing_house_id" uuid NOT NULL,
	"specialty_id" uuid NOT NULL,
	CONSTRAINT "publishing_house_specialties_publishing_house_id_specialty_id_pk" PRIMARY KEY("publishing_house_id","specialty_id")
);
--> statement-breakpoint
CREATE TABLE "publishing_houses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"country" text,
	"country_id" uuid,
	"description" text,
	"website" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publishing_houses_name_unique" UNIQUE("name"),
	CONSTRAINT "publishing_houses_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"slug" text NOT NULL,
	"description" text,
	"total_volumes" smallint,
	"is_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "themes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"level" smallint NOT NULL,
	"parent_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "themes_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "work_art_movements" (
	"work_id" uuid NOT NULL,
	"art_movement_id" uuid NOT NULL,
	CONSTRAINT "work_art_movements_work_id_art_movement_id_pk" PRIMARY KEY("work_id","art_movement_id")
);
--> statement-breakpoint
CREATE TABLE "work_art_types" (
	"work_id" uuid NOT NULL,
	"art_type_id" uuid NOT NULL,
	CONSTRAINT "work_art_types_work_id_art_type_id_pk" PRIMARY KEY("work_id","art_type_id")
);
--> statement-breakpoint
CREATE TABLE "work_attributes" (
	"work_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	CONSTRAINT "work_attributes_work_id_attribute_id_pk" PRIMARY KEY("work_id","attribute_id")
);
--> statement-breakpoint
CREATE TABLE "work_categories" (
	"work_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "work_categories_work_id_category_id_pk" PRIMARY KEY("work_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "work_keywords" (
	"work_id" uuid NOT NULL,
	"keyword_id" uuid NOT NULL,
	CONSTRAINT "work_keywords_work_id_keyword_id_pk" PRIMARY KEY("work_id","keyword_id")
);
--> statement-breakpoint
CREATE TABLE "work_literary_movements" (
	"work_id" uuid NOT NULL,
	"literary_movement_id" uuid NOT NULL,
	CONSTRAINT "work_literary_movements_work_id_literary_movement_id_pk" PRIMARY KEY("work_id","literary_movement_id")
);
--> statement-breakpoint
CREATE TABLE "work_themes" (
	"work_id" uuid NOT NULL,
	"theme_id" uuid NOT NULL,
	CONSTRAINT "work_themes_work_id_theme_id_pk" PRIMARY KEY("work_id","theme_id")
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_types_name_unique" UNIQUE("name"),
	CONSTRAINT "work_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "real_name" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "birth_month" smallint;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "birth_day" smallint;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "birth_year_is_approximate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "birth_year_gregorian" text;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_month" smallint;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_day" smallint;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_year_is_approximate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "authors" ADD COLUMN "death_year_gregorian" text;--> statement-breakpoint
ALTER TABLE "subjects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "work_type_id" uuid;--> statement-breakpoint
ALTER TABLE "author_contribution_types" ADD CONSTRAINT "author_contribution_types_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_contribution_types" ADD CONSTRAINT "author_contribution_types_contribution_type_id_contribution_types_id_fk" FOREIGN KEY ("contribution_type_id") REFERENCES "public"."contribution_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_parent_id_book_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."book_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "literary_movements" ADD CONSTRAINT "literary_movements_parent_id_literary_movements_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."literary_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_house_specialties" ADD CONSTRAINT "publishing_house_specialties_publishing_house_id_publishing_houses_id_fk" FOREIGN KEY ("publishing_house_id") REFERENCES "public"."publishing_houses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_house_specialties" ADD CONSTRAINT "publishing_house_specialties_specialty_id_publisher_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."publisher_specialties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_houses" ADD CONSTRAINT "publishing_houses_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_parent_id_themes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_art_movements" ADD CONSTRAINT "work_art_movements_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_art_movements" ADD CONSTRAINT "work_art_movements_art_movement_id_art_movements_id_fk" FOREIGN KEY ("art_movement_id") REFERENCES "public"."art_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_art_types" ADD CONSTRAINT "work_art_types_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_art_types" ADD CONSTRAINT "work_art_types_art_type_id_art_types_id_fk" FOREIGN KEY ("art_type_id") REFERENCES "public"."art_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_attributes" ADD CONSTRAINT "work_attributes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_attributes" ADD CONSTRAINT "work_attributes_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_categories" ADD CONSTRAINT "work_categories_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_categories" ADD CONSTRAINT "work_categories_category_id_book_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."book_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_keywords" ADD CONSTRAINT "work_keywords_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_keywords" ADD CONSTRAINT "work_keywords_keyword_id_keywords_id_fk" FOREIGN KEY ("keyword_id") REFERENCES "public"."keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_literary_movements" ADD CONSTRAINT "work_literary_movements_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_literary_movements" ADD CONSTRAINT "work_literary_movements_literary_movement_id_literary_movements_id_fk" FOREIGN KEY ("literary_movement_id") REFERENCES "public"."literary_movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_themes" ADD CONSTRAINT "work_themes_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_themes" ADD CONSTRAINT "work_themes_theme_id_themes_id_fk" FOREIGN KEY ("theme_id") REFERENCES "public"."themes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "works" ADD CONSTRAINT "works_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE set null ON UPDATE no action;