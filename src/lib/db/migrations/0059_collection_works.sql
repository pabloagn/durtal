CREATE TABLE "collection_works" (
	"collection_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_works_collection_id_work_id_pk" PRIMARY KEY("collection_id","work_id")
);
--> statement-breakpoint
ALTER TABLE "collection_works" ADD CONSTRAINT "collection_works_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_works" ADD CONSTRAINT "collection_works_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_work_work_idx" ON "collection_works" USING btree ("work_id");