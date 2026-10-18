import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  customTaxonomyItemWorks,
  editionContributors,
  editionTags,
  workArtMovements,
  workAuthors,
  workSubjects,
} from "@/lib/db/schema";

// These lookups enter the junction from the opposite side to its primary key.
// At catalogue scale, an unindexed lookup repeats a full scan per parent row.
describe("hot reverse junction lookups", () => {
  it.each([
    { table: workAuthors, column: "author_id", name: "work_authors" },
    { table: editionContributors, column: "author_id", name: "edition_contributors" },
    { table: editionTags, column: "tag_id", name: "edition_tags" },
    { table: workSubjects, column: "subject_id", name: "work_subjects" },
    { table: customTaxonomyItemWorks, column: "work_id", name: "custom_taxonomy_item_works" },
    { table: workArtMovements, column: "art_movement_id", name: "work_art_movements" },
  ] as const)("supports $name lookups by $column with a leading B-tree column", ({ table, column }) => {
    const { name, indexes } = getTableConfig(table);
    const lookup = indexes.find(({ config }) => {
      const leading = config.columns[0];
      return "name" in leading && leading.name === column && !config.where
        && config.method === "btree";
    });

    expect(lookup, `${name}.${column} needs a full-table lookup index`).toBeDefined();
    // Many records may share a person or term; indexing must not restrict that.
    expect(lookup?.config.unique).toBe(false);
  });
});
