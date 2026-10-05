import { redirect } from "next/navigation";
import { PerfumeGrid } from "@/components/perfumes/perfume-grid";
import { getPerfumeCount, getPerfumes } from "@/lib/actions/perfumes";
import {
  hasPerfumeFilters,
  perfumeQueryFromParams,
} from "@/lib/catalogue/perfume-params";
import {
  lastPage,
  pageHref,
  parsePagination,
  type ListSearchParams,
} from "@/lib/utils/pagination";

/** One page of the perfumes the URL asks for: its search, filters, sort and page. */
export async function PerfumeResults({ params }: { params: ListSearchParams }) {
  const query = perfumeQueryFromParams(params);
  const { page, perPage, offset } = parsePagination(params);
  // Count first: a page past the end goes to the last page before any read
  // with an offset beyond what the list accepts
  const total = await getPerfumeCount(query);
  if (total > 0 && page > lastPage(total, perPage))
    redirect(pageHref("/perfumes", params, lastPage(total, perPage)));
  const perfumes =
    offset < total ? await getPerfumes({ ...query, limit: perPage, offset }) : [];
  return (
    <PerfumeGrid
      perfumes={perfumes}
      pagination={{ page, perPage, total }}
      hasFilters={hasPerfumeFilters(params)}
    />
  );
}
