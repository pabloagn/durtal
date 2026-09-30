CREATE TABLE "harmonization_decisions" (
	"finding_key" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harmonization_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"source_id" uuid NOT NULL,
	"target_id" uuid,
	"label" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "harmonization_redirects" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"source_slug" text,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "harmonization_operations_created_idx" ON "harmonization_operations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "harmonization_redirects_slug_idx" ON "harmonization_redirects" USING btree ("entity","source_slug");--> statement-breakpoint
CREATE FUNCTION harmonization_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%', message; END IF;
END $$;
--> statement-breakpoint
-- A move is allowed only inside the transaction that recorded this exact merge.
CREATE FUNCTION harmonization_allows_move(entity_arg text, old_id uuid, new_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (SELECT 1 FROM harmonization_operations
   WHERE id::text = current_setting('durtal.harmonization_operation', true)
   AND action = 'merge' AND entity = entity_arg AND source_id = old_id AND target_id = new_id
   AND created_at = transaction_timestamp() AND after IS NULL)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_acquisition_target() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
 IF TG_OP = 'UPDATE' THEN
  allowed := (NEW.edition_id IS NOT DISTINCT FROM OLD.edition_id) AND (
    (NEW.publisher_id IS NOT DISTINCT FROM OLD.publisher_id AND harmonization_allows_move('works', OLD.work_id, NEW.work_id)) OR
    (NEW.work_id IS NOT DISTINCT FROM OLD.work_id AND harmonization_allows_move('publishers', OLD.publisher_id, NEW.publisher_id))
  );
 END IF;
 IF NEW.edition_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM editions WHERE id = NEW.edition_id AND work_id = NEW.work_id) THEN
   RAISE EXCEPTION 'The target edition belongs to another book';
 END IF;
 IF TG_OP = 'UPDATE' AND (NEW.work_id IS DISTINCT FROM OLD.work_id OR NEW.edition_id IS DISTINCT FROM OLD.edition_id OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id) AND NOT allowed THEN
   RAISE EXCEPTION 'Create a new target instead of changing its identity';
 END IF;
 IF NEW.is_cancelled AND EXISTS (SELECT 1 FROM orders WHERE acquisition_target_id = NEW.id AND status NOT IN ('cancelled', 'returned')) THEN
   RAISE EXCEPTION 'Cancel or return the linked order before removing this target';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_target_edition_work() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.work_id <> NEW.work_id AND NOT harmonization_allows_move('works', OLD.work_id, NEW.work_id)
 AND (EXISTS(SELECT 1 FROM acquisition_targets WHERE edition_id = OLD.id) OR EXISTS(SELECT 1 FROM orders WHERE edition_id = OLD.id AND acquisition_target_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'An edition with acquisition targets cannot move to another book';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_publisher_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM publishing_houses WHERE id = NEW.parent_id AND kind = 'publisher') THEN
   RAISE EXCEPTION 'Choose a publishing house as the imprint parent';
 END IF;
 IF TG_OP = 'UPDATE' AND (NEW.kind IS DISTINCT FROM OLD.kind OR NEW.parent_id IS DISTINCT FROM OLD.parent_id)
 AND NOT (NEW.kind = OLD.kind AND harmonization_allows_move('publishers', OLD.parent_id, NEW.parent_id))
 AND (EXISTS(SELECT 1 FROM edition_publishers WHERE publisher_id = OLD.id) OR EXISTS(SELECT 1 FROM acquisition_targets WHERE publisher_id = OLD.id) OR EXISTS(SELECT 1 FROM publishing_houses WHERE parent_id = OLD.id)) THEN
   RAISE EXCEPTION 'This publisher identity is in use; its type and parent cannot be changed';
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION harmonization_validate_merge(operation_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE op harmonization_operations;
BEGIN
 SELECT * INTO STRICT op FROM harmonization_operations WHERE id = operation_id;
 IF op.entity IN ('works', 'publishers') THEN
  PERFORM harmonization_assert(NOT EXISTS (
   SELECT 1 FROM acquisition_targets t LEFT JOIN editions e ON e.id = t.edition_id
   WHERE (t.work_id = op.target_id OR t.publisher_id = op.target_id)
   AND t.edition_id IS NOT NULL AND e.work_id IS DISTINCT FROM t.work_id
  ), 'An acquisition target would point to the wrong book');
  PERFORM harmonization_assert(NOT EXISTS (
   SELECT 1 FROM orders o JOIN acquisition_targets t ON t.id = o.acquisition_target_id
   WHERE (o.work_id = op.target_id OR t.publisher_id = op.target_id)
   AND (o.work_id <> t.work_id OR (o.edition_id IS NOT NULL AND NOT target_accepts_edition(t.id, o.edition_id)))
  ), 'An acquisition would no longer match its collecting target');
  PERFORM harmonization_assert(NOT EXISTS (
   SELECT 1 FROM acquisition_target_copies c JOIN acquisition_targets t ON t.id = c.target_id JOIN instances i ON i.id = c.instance_id
   WHERE (t.work_id = op.target_id OR t.publisher_id = op.target_id) AND NOT target_accepts_edition(t.id, i.edition_id)
  ), 'An accessioned copy would no longer match its collecting target');
 END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_target_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t acquisition_targets; audited_move boolean := false;
BEGIN
 IF NEW.acquisition_target_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO t FROM acquisition_targets WHERE id = NEW.acquisition_target_id FOR UPDATE;
 IF NOT FOUND OR t.work_id <> NEW.work_id THEN RAISE EXCEPTION 'Choose a target for this book'; END IF;
 IF TG_OP = 'UPDATE' AND NEW.acquisition_target_id = OLD.acquisition_target_id AND NEW.status = OLD.status AND NEW.status IN ('cancelled', 'returned') THEN
  audited_move := harmonization_allows_move('works', OLD.work_id, NEW.work_id)
    OR harmonization_allows_move('venues', OLD.venue_id, NEW.venue_id)
    OR harmonization_allows_move('places', OLD.origin_place_id, NEW.origin_place_id)
    OR harmonization_allows_move('locations', OLD.destination_location_id, NEW.destination_location_id)
    OR harmonization_allows_move('sub-locations', OLD.destination_sub_location_id, NEW.destination_sub_location_id);
 END IF;
 IF t.is_cancelled AND NOT audited_move THEN RAISE EXCEPTION 'This acquisition target was removed'; END IF;
 IF NEW.edition_id IS NOT NULL AND NOT target_accepts_edition(t.id, NEW.edition_id) THEN
   RAISE EXCEPTION 'This edition does not match the acquisition target';
 END IF;
 IF NEW.status IN ('delivered', 'received', 'purchased') AND NEW.edition_id IS NULL THEN
   RAISE EXCEPTION 'Select the received edition before completing this target';
 END IF;
 IF NEW.instance_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM instances WHERE id = NEW.instance_id AND edition_id = NEW.edition_id) THEN
   RAISE EXCEPTION 'The received copy does not match the ordered edition';
 END IF;
 RETURN NEW;
END $$;
