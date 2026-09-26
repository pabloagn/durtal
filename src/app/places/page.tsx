import { PaginatedSection } from "@/components/shared/pagination";
import { redirect } from "next/navigation";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { getVenues, getVenueCount } from "@/lib/actions/venues";
import type { VenueType } from "@/lib/actions/venues";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { PlacesShell, type VenueItem } from "./places-shell";
import { PlacesFiltersBar } from "./places-filters-bar";
import { VenueCreateDialog } from "./venue-create-dialog";
import { hasListQuery } from "@/lib/utils/list-params";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    page?: string;
    perPage?: string;
    type?: string;
    favorite?: string;
  }>;
}

async function PlacesContent({
  searchParams,
}: {
  searchParams: {
    q?: string;
    sort?: string;
    order?: string;
    page?: string;
    perPage?: string;
    type?: string;
    favorite?: string;
  };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "name") as "name" | "recent" | "rating";
  const order = (searchParams.order ?? undefined) as "asc" | "desc" | undefined;
  const typeFilter = searchParams.type
    ?.split(",")
    .filter(Boolean) as VenueType[] | undefined;
  const favoriteFilter = searchParams.favorite === "true" ? true : undefined;

  const { page, perPage: limit, offset } = parsePagination(searchParams);

  const filters = {
    types: typeFilter?.length ? typeFilter : undefined,
    favorite: favoriteFilter,
  };

  const [rawVenues, total] = await Promise.all([
    getVenues({ search, sort, order, limit, offset, filters }),
    getVenueCount({ search, filters }),
  ]);

  if (page > lastPage(total, limit)) redirect(pageHref("/places", searchParams, lastPage(total, limit)));

  // Full-page empty state only when there are no venues at all. A search or
  // filter with no match is handled by the shell, below the toolbar.
  const hasQuery = hasListQuery(
    new URLSearchParams(
      Object.entries(searchParams).filter((e): e is [string, string] => typeof e[1] === "string"),
    ),
  );
  if (total === 0 && !hasQuery) {
    return (
      <EmptyState
        icon={MapPin}
        title="No venues yet"
        description="Add your first venue to start building your places catalogue"
        action={<VenueCreateDialog />}
      />
    );
  }

  const venues: VenueItem[] = rawVenues.map((v) => ({
    id: v.id,
    slug: v.slug ?? "",
    name: v.name,
    type: v.type,
    formattedAddress: v.formattedAddress,
    placeName: v.place?.fullName ?? v.place?.name ?? null,
    isFavorite: v.isFavorite,
    personalRating: v.personalRating,
    website: v.website,
    thumbnailUrl: v.thumbnailS3Key
      ? `/api/s3/read?key=${encodeURIComponent(v.thumbnailS3Key)}`
      : null,
    color: v.color,
    createdAt: new Date(v.createdAt).toLocaleDateString(),
  }));


  return (
    <>
      <PaginatedSection page={page} perPage={limit} total={total} noun="venues"><PlacesShell venues={venues} total={total} /></PaginatedSection>
    </>
  );
}

export default async function PlacesPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Places"
        description="Bookshops, cafes, libraries, and other venues"
        actions={<VenueCreateDialog />}
      />

      <PlacesFiltersBar />

      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <PlacesContent searchParams={params} />
      </Suspense>
    </>
  );
}
