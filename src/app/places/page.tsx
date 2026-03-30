import { Suspense } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { getVenues, getVenueCount } from "@/lib/actions/venues";
import type { VenueType } from "@/lib/actions/venues";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { PlacesShell, type VenueItem } from "./places-shell";
import { VenueCreateDialog } from "./venue-create-dialog";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    page?: string;
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

  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 48;
  const offset = (page - 1) * limit;

  const filters = {
    types: typeFilter?.length ? typeFilter : undefined,
    favorite: favoriteFilter,
  };

  const [rawVenues, total] = await Promise.all([
    getVenues({ search, sort, order, limit, offset, filters }),
    getVenueCount({ search, filters }),
  ]);

  if (rawVenues.length === 0) {
    return (
      <EmptyState
        icon={MapPin}
        title={search ? "No venues found" : "No venues yet"}
        description={
          search
            ? `No venues matching "${search}"`
            : "Add your first venue to start building your places catalogue"
        }
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

  const totalPages = Math.ceil(total / limit);

  const paginationParams = {
    ...(search ? { q: search } : {}),
    sort,
    ...(searchParams.order ? { order: searchParams.order } : {}),
    ...(searchParams.type ? { type: searchParams.type } : {}),
    ...(searchParams.favorite ? { favorite: searchParams.favorite } : {}),
  };

  return (
    <>
      <PlacesShell venues={venues} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/places?${new URLSearchParams({ ...paginationParams, page: String(page - 1) })}`}
            >
              <Button variant="ghost" size="sm">
                Previous
              </Button>
            </Link>
          )}
          <span className="font-mono text-xs text-fg-muted">
            {page} / {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`/places?${new URLSearchParams({ ...paginationParams, page: String(page + 1) })}`}
            >
              <Button variant="ghost" size="sm">
                Next
              </Button>
            </Link>
          )}
        </div>
      )}

      <p className="mt-4 text-center font-mono text-xs text-fg-muted">
        {total} {total === 1 ? "venue" : "venues"}
      </p>
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
