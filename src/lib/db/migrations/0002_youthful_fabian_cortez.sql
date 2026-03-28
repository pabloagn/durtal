CREATE TYPE "public"."acquisition_priority_enum" AS ENUM('none', 'low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."catalogue_status_enum" AS ENUM('tracked', 'shortlisted', 'wanted', 'on_order', 'accessioned', 'deaccessioned');--> statement-breakpoint
CREATE TYPE "public"."disposition_type_enum" AS ENUM('sold', 'donated', 'gifted', 'traded', 'lost', 'stolen', 'destroyed', 'returned', 'expired');--> statement-breakpoint
CREATE TYPE "public"."instance_status_enum" AS ENUM('available', 'lent_out', 'in_transit', 'in_storage', 'missing', 'damaged', 'deaccessioned');--> statement-breakpoint
CREATE TABLE "instance_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"from_status" "instance_status_enum",
	"to_status" "instance_status_enum" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "work_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"from_status" "catalogue_status_enum",
	"to_status" "catalogue_status_enum" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
UPDATE "works" SET "catalogue_status" = 'accessioned' WHERE "catalogue_status" = 'catalogued';--> statement-breakpoint
UPDATE "works" SET "catalogue_status" = 'wanted' WHERE "catalogue_status" = 'wishlist';--> statement-breakpoint
UPDATE "works" SET "catalogue_status" = 'tracked' WHERE "catalogue_status" NOT IN ('tracked', 'shortlisted', 'wanted', 'on_order', 'accessioned', 'deaccessioned');--> statement-breakpoint
ALTER TABLE "works" ALTER COLUMN "catalogue_status" SET DEFAULT 'tracked'::"public"."catalogue_status_enum";--> statement-breakpoint
ALTER TABLE "works" ALTER COLUMN "catalogue_status" SET DATA TYPE "public"."catalogue_status_enum" USING "catalogue_status"::"public"."catalogue_status_enum";--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "status" "instance_status_enum" DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_type" "disposition_type_enum";--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_date" date;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_to" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_currency" text;--> statement-breakpoint
ALTER TABLE "instances" ADD COLUMN "disposition_notes" text;--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "acquisition_priority" "acquisition_priority_enum" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_status_history" ADD CONSTRAINT "instance_status_history_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_status_history" ADD CONSTRAINT "work_status_history_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instances" DROP COLUMN "is_lent_out";