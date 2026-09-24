CREATE INDEX "authors_birth_year_idx" ON "authors" USING btree ("birth_year");--> statement-breakpoint
CREATE INDEX "editions_work_id_idx" ON "editions" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "editions_language_idx" ON "editions" USING btree ("language");--> statement-breakpoint
CREATE INDEX "editions_publication_year_idx" ON "editions" USING btree ("publication_year");--> statement-breakpoint
CREATE INDEX "instances_edition_id_idx" ON "instances" USING btree ("edition_id");--> statement-breakpoint
CREATE INDEX "instances_location_id_idx" ON "instances" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "instances_status_idx" ON "instances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "media_work_id_type_active_idx" ON "media" USING btree ("work_id","type","is_active");--> statement-breakpoint
CREATE INDEX "media_author_id_active_idx" ON "media" USING btree ("author_id","is_active");--> statement-breakpoint
CREATE INDEX "orders_work_id_idx" ON "orders" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "works_catalogue_status_idx" ON "works" USING btree ("catalogue_status");--> statement-breakpoint
CREATE INDEX "works_series_id_idx" ON "works" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "works_created_at_idx" ON "works" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "works_rating_idx" ON "works" USING btree ("rating");