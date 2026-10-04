import { redirect } from "next/navigation";
import { PaintingGrid } from "@/components/paintings/painting-grid";
import { getPaintingCount, getPaintings } from "@/lib/actions/paintings";
import {
  hasPaintingFilters,
  paintingQueryFromParams,
} from "@/lib/catalogue/painting-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  type ListSearchParams,
} from "@/lib/utils/pagination";

/** One page of the paintings the URL asks for: its search, filters, sort and page. */
export async function PaintingResults({ params }: { params: ListSearchParams }) {
  const query = paintingQueryFromParams(params);
  const { page, perPage, offset } = parsePagination(params);
  // Count first: a page past the end goes to the last page before any read
  // with an offset beyond what the list accepts
  const total = await getPaintingCount(query);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/paintings", params, lastPage(total, perPage)));
  const paintings =
    offset < total ? await getPaintings({ ...query, limit: perPage, offset }) : [];
  return (
    <PaintingGrid
      paintings={paintings}
      pagination={{ page, perPage, total }}
      hasFilters={hasPaintingFilters(params)}
    />
  );
}
