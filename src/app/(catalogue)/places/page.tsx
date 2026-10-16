import { PaginatedSection } from "@/components/shared/pagination";
import { favouritesOnly } from "@/lib/constants/favourites";
import { redirect } from "next/navigation";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { Suspense } from "react";
import { MapPin } from "lucide-react";
import { getVenues, getVenueCount } from "@/lib/actions/venues";
import { getVenueCountries } from "@/lib/actions/venue-pages";
import { VENUE_TYPES, type VenueType } from "@/lib/catalogue/venues";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
import { Spinner } from "@/components/ui/spinner";
import { PlacesShell, type VenueItem } from "./places-shell";
import { PlacesFiltersBar } from "./places-filters-bar";
import { VenueCreateDialog } from "./venue-create-dialog";
import { mediaUrl } from "@/lib/s3/media-url";

export const metadata = { title: "Places" };

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    page?: string;
    perPage?: string;
    type?: string;
    favourites?: string;
    country?: string;
    archived?: string;
  }>;
}

type PlacesParams = {
  q?: string;
  sort?: string;
  order?: string;
  page?: string;
  perPage?: string;
  type?: string;
  favourites?: string;
  country?: string;
  archived?: string;
};

/** The list's first read, started before the page knows whether any place exists */
function placesQuery(searchParams: PlacesParams) {
  const search = searchParams.q?.slice(0, 200);
  const sort = searchParams.sort === "recent" || searchParams.sort === "rating" ? searchParams.sort : "name";
  const order = searchParams.order === "asc" || searchParams.order === "desc" ? searchParams.order : undefined;
  const typeFilter = searchParams.type
    ?.split(",")
    .filter((value): value is VenueType => VENUE_TYPES.includes(value as VenueType));
  const favoriteFilter = favouritesOnly(searchParams.favourites) ? true : undefined;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const countryFilter = searchParams.country?.split(",").filter((id) => UUID.test(id)).slice(0, 50);
  const archivedFilter: "include" | "only" | undefined =
    searchParams.archived === "include" || searchParams.archived === "only" ? searchParams.archived : undefined;

  const { page, perPage: limit, offset } = parsePagination(searchParams);

  const filters = {
    types: typeFilter?.length ? typeFilter : undefined,
    favorite: favoriteFilter,
    countryIds: countryFilter?.length ? countryFilter : undefined,
    archived: archivedFilter,
  };

  const first = Promise.all([
    getVenues({ search, sort, order, limit, offset, filters }),
    getVenueCount({ search, filters }),
  ]);
  // With none the list is never awaited: its failure must not go unhandled
  first.catch(() => {});
  return { page, limit, first };
}

async function PlacesContent({
  searchParams,
  query,
}: {
  searchParams: PlacesParams;
  query: ReturnType<typeof placesQuery>;
}) {
  const { page, limit } = query;
  const [rawVenues, total] = await query.first;

  if (page > lastPage(total, limit)) redirect(pageHref("/places", searchParams, lastPage(total, limit)));

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
      ? mediaUrl(v.thumbnailS3Key)
      : null,
    color: v.color,
    createdAt: new Date(v.createdAt).toLocaleDateString(),
    archived: v.archivedAt !== null,
  }));


  return (
    <>
      <PaginatedSection page={page} perPage={limit} total={total} noun="places"><PlacesShell venues={venues} total={total} /></PaginatedSection>
    </>
  );
}

export default async function PlacesPage({ searchParams }: PageProps) {
  // Whether any place exists (archived ones too) and the list itself, read side by side
  const any = getVenueCount({ filters: { archived: "include" } });
  const params = await searchParams;
  const query = placesQuery(params);
  const [countries, count] = await Promise.all([getVenueCountries(), any]);
  if (!count) {
    return (
      <EmptyIndex
        title="Places"
        icon={MapPin}
        empty="No places yet"
        description="A place is somewhere your works come from or live: a bookshop, a library, a museum, a perfumery, a cinema. Add one to keep its address and what you found there."
        action={<VenueCreateDialog />}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Places"
        actions={<VenueCreateDialog />}
      />

      <PlacesFiltersBar countries={countries} />

      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <PlacesContent searchParams={params} query={query} />
      </Suspense>
    </>
  );
}
