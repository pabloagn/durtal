CREATE TYPE "public"."acquisition_method_enum" AS ENUM('online_order', 'in_store_purchase', 'gift', 'digital_purchase', 'auction', 'event_purchase');--> statement-breakpoint
CREATE TYPE "public"."order_status_enum" AS ENUM('placed', 'confirmed', 'processing', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'purchased', 'received', 'bid', 'won', 'cancelled', 'returned');--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status_enum",
	"to_status" "order_status_enum" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"edition_id" uuid,
	"instance_id" uuid,
	"venue_id" uuid,
	"acquisition_method" "acquisition_method_enum" NOT NULL,
	"status" "order_status_enum" DEFAULT 'placed' NOT NULL,
	"order_date" date NOT NULL,
	"order_confirmation" text,
	"order_url" text,
	"price" numeric(10, 2),
	"shipping_cost" numeric(10, 2),
	"total_cost" numeric(10, 2),
	"currency" text,
	"carrier" text,
	"tracking_number" text,
	"tracking_url" text,
	"shipped_date" date,
	"estimated_delivery_date" date,
	"actual_delivery_date" date,
	"origin_description" text,
	"origin_place_id" uuid,
	"destination_location_id" uuid,
	"destination_sub_location_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_edition_id_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."editions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_origin_place_id_places_id_fk" FOREIGN KEY ("origin_place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_destination_location_id_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_destination_sub_location_id_sub_locations_id_fk" FOREIGN KEY ("destination_sub_location_id") REFERENCES "public"."sub_locations"("id") ON DELETE set null ON UPDATE no action;