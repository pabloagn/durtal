CREATE INDEX "custom_taxonomy_item_works_work_id_idx" ON "custom_taxonomy_item_works" USING btree ("work_id");--> statement-breakpoint
CREATE INDEX "edition_contributors_author_id_idx" ON "edition_contributors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "edition_tags_tag_id_idx" ON "edition_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "work_art_movements_art_movement_id_idx" ON "work_art_movements" USING btree ("art_movement_id");--> statement-breakpoint
CREATE INDEX "work_authors_author_id_idx" ON "work_authors" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "work_subjects_subject_id_idx" ON "work_subjects" USING btree ("subject_id");