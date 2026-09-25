CREATE TABLE "acquisition_target_copies" (
	"target_id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "acquisition_target_copies" ADD CONSTRAINT "acquisition_target_copies_target_id_acquisition_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."acquisition_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acquisition_target_copies" ADD CONSTRAINT "acquisition_target_copies_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acquisition_target_copies_instance_idx" ON "acquisition_target_copies" USING btree ("instance_id");--> statement-breakpoint
CREATE FUNCTION validate_target_copy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM acquisition_targets WHERE id = NEW.target_id AND NOT is_cancelled FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM instances i WHERE i.id = NEW.instance_id AND i.status <> 'deaccessioned' AND target_accepts_edition(NEW.target_id,i.edition_id)) THEN
   RAISE EXCEPTION 'Choose an owned copy that matches this acquisition target';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER target_copy_guard BEFORE INSERT OR UPDATE ON acquisition_target_copies FOR EACH ROW EXECUTE FUNCTION validate_target_copy();
--> statement-breakpoint
CREATE FUNCTION protect_target_copy_edition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.edition_id <> NEW.edition_id AND EXISTS(SELECT 1 FROM acquisition_target_copies c WHERE c.instance_id = OLD.id AND NOT target_accepts_edition(c.target_id,NEW.edition_id)) THEN
   RAISE EXCEPTION 'This copy fulfils an acquisition target for a different edition';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER target_copy_edition_guard BEFORE UPDATE OF edition_id ON instances FOR EACH ROW EXECUTE FUNCTION protect_target_copy_edition();
