import { LibraryFiltersBar } from "../library-filters-bar";
import { LibraryHeader, LibraryPending } from "../library-header";

/**
 * The books list while it loads: its header and filters, then the same wait
 * the page shows until its books arrive, so nothing moves in between (SLN-697).
 */
export default function LibraryLoading() {
  return (
    <>
      <LibraryHeader searchParams={{}} />
      <LibraryFiltersBar />
      <LibraryPending />
    </>
  );
}
