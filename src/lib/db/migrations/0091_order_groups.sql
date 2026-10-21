CREATE TABLE "order_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid,
	"acquisition_method" "acquisition_method_enum" NOT NULL,
	"order_date" date NOT NULL,
	"order_confirmation" text,
	"order_url" text,
	"currency" text,
	"shipping_cost" numeric(10, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_groups_shipping_check" CHECK ("order_groups"."shipping_cost" is null or "order_groups"."shipping_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "order_groups" ADD CONSTRAINT "order_groups_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_group_id_order_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."order_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_group_idx" ON "orders" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_group_cost_check" CHECK ("orders"."group_id" is null or ("orders"."shipping_cost" is null and "orders"."total_cost" is not distinct from "orders"."price"));
--> statement-breakpoint
CREATE FUNCTION validate_order_group_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g order_groups;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.group_id IS DISTINCT FROM NEW.group_id THEN
    RAISE EXCEPTION 'A book cannot be moved between orders';
  END IF;
  IF NEW.group_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT g FROM order_groups WHERE id = NEW.group_id FOR KEY SHARE;
  IF NOT EXISTS (SELECT 1 FROM works WHERE id = NEW.work_id AND kind = 'book') THEN
    RAISE EXCEPTION 'A multi-book order can contain only books';
  END IF;
  IF ROW(NEW.venue_id, NEW.acquisition_method, NEW.order_date, NEW.order_confirmation, NEW.order_url, NEW.currency)
     IS DISTINCT FROM ROW(g.venue_id, g.acquisition_method, g.order_date, g.order_confirmation, g.order_url, g.currency) THEN
    RAISE EXCEPTION 'Change the shared seller, currency and date on the order';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_group_member_guard BEFORE INSERT OR UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION validate_order_group_member();
--> statement-breakpoint
CREATE FUNCTION sync_order_group_members() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE orders SET venue_id = NEW.venue_id, acquisition_method = NEW.acquisition_method,
    order_date = NEW.order_date, order_confirmation = NEW.order_confirmation,
    order_url = NEW.order_url, currency = NEW.currency, updated_at = now()
  WHERE group_id = NEW.id;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_group_shared_fields AFTER UPDATE ON order_groups FOR EACH ROW EXECUTE FUNCTION sync_order_group_members();
--> statement-breakpoint
CREATE FUNCTION delete_empty_order_group() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.group_id IS NOT NULL THEN
    DELETE FROM order_groups WHERE id = OLD.group_id AND NOT EXISTS (SELECT 1 FROM orders WHERE group_id = OLD.group_id);
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER order_group_empty AFTER DELETE ON orders FOR EACH ROW EXECUTE FUNCTION delete_empty_order_group();
