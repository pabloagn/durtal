CREATE TABLE "work_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"from_work_id" uuid NOT NULL,
	"from_kind" "work_kind_enum" NOT NULL,
	"to_work_id" uuid NOT NULL,
	"to_kind" "work_kind_enum" NOT NULL,
	"source_record_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_relation_self_check" CHECK ("work_relations"."from_work_id" <> "work_relations"."to_work_id"),
	CONSTRAINT "work_relation_pair_check" CHECK (("work_relations"."type" = 'adaptation' and (("work_relations"."from_kind" = 'film' and "work_relations"."to_kind" = 'book') or ("work_relations"."from_kind" = 'book' and "work_relations"."to_kind" = 'film')))
        or ("work_relations"."type" = 'remake' and "work_relations"."from_kind" = 'film' and "work_relations"."to_kind" = 'film')
        or ("work_relations"."type" = 'flanker' and "work_relations"."from_kind" = 'perfume' and "work_relations"."to_kind" = 'perfume')
        or "work_relations"."type" = 'inspiration'),
	CONSTRAINT "work_relation_source_check" CHECK ("work_relations"."type" <> 'inspiration' or "work_relations"."source_record_id" is not null),
	CONSTRAINT "work_relation_notes_check" CHECK ("work_relations"."notes" is null or length(trim("work_relations"."notes")) between 1 and 2000)
);
--> statement-breakpoint
ALTER TABLE "work_relations" ADD CONSTRAINT "work_relations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relations" ADD CONSTRAINT "work_relation_from_fk" FOREIGN KEY ("from_work_id","from_kind") REFERENCES "public"."works"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_relations" ADD CONSTRAINT "work_relation_to_fk" FOREIGN KEY ("to_work_id","to_kind") REFERENCES "public"."works"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_relation_pair_unique" ON "work_relations" USING btree (least("from_work_id", "to_work_id"),greatest("from_work_id", "to_work_id"),"type");--> statement-breakpoint
CREATE INDEX "work_relation_from_idx" ON "work_relations" USING btree ("from_work_id");--> statement-breakpoint
CREATE INDEX "work_relation_to_idx" ON "work_relations" USING btree ("to_work_id");--> statement-breakpoint
CREATE INDEX "work_relation_source_idx" ON "work_relations" USING btree ("source_record_id");