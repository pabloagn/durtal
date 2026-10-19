"use client";

import { ExportMenu } from "@/components/shared/export-menu";
import { FavouriteBulkMenu } from "@/components/shared/favourite-bulk-menu";
import {
  SelectionToolbar,
  type SelectionToolbarProps,
} from "@/components/shared/selection-toolbar";
import { deleteAuthor } from "@/lib/actions/catalogue-client";

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
      cascade="Their books, films, perfumes and paintings stay in your library; only their credits go."
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
