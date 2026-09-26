CREATE TABLE "image_adjustments" (
	"asset_key" text PRIMARY KEY NOT NULL,
	"sources" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"monochrome" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
