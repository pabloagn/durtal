"use client";

import { ExportMenu } from "@/components/shared/export-menu";
import { FavouriteBulkMenu } from "@/components/shared/favourite-bulk-menu";
import {
  SelectionToolbar,
  type SelectionToolbarProps,
} from "@/components/shared/selection-toolbar";
import { deleteAuthor } from "@/lib/actions/authors";

/** The people list's selection bar: favourites and export */
export function AuthorBulkActionToolbar({
  selectedNames,
  ...selection
}: SelectionToolbarProps & { selectedNames: Map<string, string> }) {
  return (
    <SelectionToolbar
      {...selection}
      names={selectedNames}
      noun={["person", "people"]}
      deleteOne={deleteAuthor}
      cascade="This will NOT delete their books, films, perfumes or paintings, but will remove their credits."
    >
      {() => (
        <>
          <FavouriteBulkMenu
            entity="author"
            ids={selection.selectedIds}
            noun={["person", "people"]}
          />

          {/* Export */}
          <ExportMenu entity="authors" ids={selection.selectedIds} />
        </>
      )}
    </SelectionToolbar>
  );
}
