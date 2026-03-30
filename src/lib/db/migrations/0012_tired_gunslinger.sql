CREATE TYPE "public"."venue_type_enum" AS ENUM('bookshop', 'online_store', 'cafe', 'library', 'museum', 'gallery', 'auction_house', 'market', 'fair', 'publisher', 'individual', 'other');--> statement-breakpoint
CREATE TABLE "gallery_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"layout_data" jsonb NOT NULL,
	"seed" integer DEFAULT 0 NOT NULL,
	"image_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gallery_layouts_entity_unique" UNIQUE("entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"type" "venue_type_enum" NOT NULL,
	"subtype" text,
	"description" text,
	"website" text,
	"instagram_handle" text,
	"social_links" jsonb,
	"place_id" uuid,
	"formatted_address" text,
	"google_place_id" text,
	"phone" text,
	"email" text,
	"opening_hours" jsonb,
	"timezone" text,
	"poster_s3_key" text,
	"thumbnail_s3_key" text,
	"color" text,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"personal_rating" smallint,
	"notes" text,
	"specialties" text,
	"tags" text[],
	"first_visit_date" date,
	"last_visit_date" date,
	"total_orders" integer DEFAULT 0 NOT NULL,
	"total_spent" numeric(12, 2) DEFAULT '0' NOT NULL,
	"last_order_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;