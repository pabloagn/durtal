CREATE TABLE "app_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"new_book_status" "catalogue_status_enum" DEFAULT 'tracked' NOT NULL,
	"new_book_language" text DEFAULT 'en' NOT NULL,
	"new_copy_location_id" uuid,
	"new_copy_format" text DEFAULT 'paperback',
	"new_copy_condition" text DEFAULT 'mint',
	"home_currency" text DEFAULT 'EUR' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_single_row_check" CHECK ("app_settings"."id"),
	CONSTRAINT "app_settings_new_book_status_check" CHECK ("app_settings"."new_book_status" <> 'deaccessioned'),
	CONSTRAINT "app_settings_new_book_language_check" CHECK ("app_settings"."new_book_language" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "app_settings_home_currency_check" CHECK ("app_settings"."home_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_new_copy_location_id_locations_id_fk" FOREIGN KEY ("new_copy_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The one settings row keeps today's behaviour: new books start as tracked,
-- in English; new copies start as mint paperbacks in the location the
-- add-book wizard picked by name (Amsterdam, else Mexico City); new orders
-- start in EUR.
INSERT INTO "app_settings" ("id", "new_copy_location_id")
SELECT true,
  (SELECT "id" FROM "locations"
    WHERE lower("name") LIKE '%amsterdam%' OR lower("name") LIKE '%mexico city%'
    ORDER BY lower("name") LIKE '%amsterdam%' DESC, "sort_order", "name"
    LIMIT 1)
ON CONFLICT ("id") DO NOTHING;
