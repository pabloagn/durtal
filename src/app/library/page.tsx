import Link from "next/link";
import { Plus, Library } from "lucide-react";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LibraryShell } from "./library-shell";
import { LibraryFiltersBar } from "./library-filters-bar";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    status?: string;
    priority?: string;
    rating?: string;
    location?: string;
    poster?: string;
    page?: string;
  }>;
}

async function LibraryContent({
  searchParams,
}: {
  searchParams: {
    q?: string;
    sort?: string;
    order?: string;
    status?: string;
    priority?: string;
    rating?: string;
    location?: string;
    poster?: string;
    page?: string;
  };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "recent") as
    | "title"
    | "recent"
    | "year"
    | "rating"
    | "authorFirstName"
    | "authorLastName";
  const order = (searchParams.order ?? undefined) as "asc" | "desc" | undefined;
  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 48;
  const offset = (page - 1) * limit;

  const statusFilter = searchParams.status?.split(",").filter(Boolean);
  const priorityFilter = searchParams.priority?.split(",").filter(Boolean);
  const ratingParam = searchParams.rating;
  const minRating = ratingParam ? parseInt(ratingParam, 10) : undefined;
  const locationId = searchParams.location || undefined;
  const posterParam = searchParams.poster;
  const hasPoster = posterParam === "has" ? true : posterParam === "missing" ? false : undefined;

  const [works, total] = await Promise.all([
    getWorks({
      search,
      sort,
      order,
      limit,
      offset,
      filters: {
        catalogueStatus: statusFilter?.length ? statusFilter : undefined,
        acquisitionPriority: priorityFilter?.length ? priorityFilter : undefined,
        minRating,
        locationId,
        hasPoster,
      },
    }),
    getWorkCount(search, {
      catalogueStatus: statusFilter?.length ? statusFilter : undefined,
      acquisitionPriority: priorityFilter?.length ? priorityFilter : undefined,
      minRating,
      locationId,
      hasPoster,
    }),
  ]);

  if (works.length === 0) {
    const hasFilters = !!(search || statusFilter?.length || priorityFilter?.length || ratingParam || locationId || posterParam);
    return (
      <EmptyState
        icon={Library}
        title={hasFilters ? "No results" : "Your library is empty"}
        description={
          search
            ? `No works matching "${search}"`
            : hasFilters
              ? "No works match the current filters"
              : "Add your first book to get started"
        }
        action={
          !hasFilters ? (
            <Link href="/library/new">
              <Button variant="primary">
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                Add book
              </Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  const books = works.map((work) => {
    const firstEdition = work.editions[0];
    const primaryAuthor = work.workAuthors[0]?.author;
    const instanceCount = work.editions.reduce(
      (acc, e) => acc + (e.instances?.length ?? 0),
      0,
    );

    // Prefer active poster from media table, fall back to edition cover
    const activePoster = work.media?.find(
      (m) => m.type === "poster" && m.isActive,
    );
    const coverS3Key =
      activePoster?.thumbnailS3Key ??
      activePoster?.s3Key ??
      firstEdition?.thumbnailS3Key;

    return {
      workId: work.id,
      slug: work.slug ?? "",
      title: work.title,
      authorName: primaryAuthor?.name ?? "Unknown",
      coverUrl: coverS3Key
        ? `/api/s3/read?key=${encodeURIComponent(coverS3Key)}`
        : null,
      coverCrop: activePoster
        ? { x: activePoster.cropX, y: activePoster.cropY, zoom: activePoster.cropZoom }
        : null,
      publicationYear: firstEdition?.publicationYear ?? work.originalYear,
      language: firstEdition?.language,
      instanceCount,
      rating: work.rating,
      catalogueStatus: work.catalogueStatus,
      acquisitionPriority: work.acquisitionPriority,
      primaryEditionId: firstEdition?.id ?? null,
    };
  });

  const totalPages = Math.ceil(total / limit);

  const paginationParams = {
    ...(search ? { q: search } : {}),
    sort,
    ...(order ? { order } : {}),
    ...(searchParams.status ? { status: searchParams.status } : {}),
    ...(searchParams.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams.rating ? { rating: searchParams.rating } : {}),
    ...(searchParams.location ? { location: searchParams.location } : {}),
    ...(searchParams.poster ? { poster: searchParams.poster } : {}),
  };

  return (
    <>
      <LibraryShell books={books} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/library?${new URLSearchParams({ ...paginationParams, page: String(page - 1) })}`}
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
              href={`/library?${new URLSearchParams({ ...paginationParams, page: String(page + 1) })}`}
            >
              <Button variant="ghost" size="sm">
                Next
              </Button>
            </Link>
          )}
        </div>
      )}

      <p className="mt-4 text-center font-mono text-xs text-fg-muted">
        {total} {total === 1 ? "work" : "works"}
      </p>
    </>
  );
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Library"
        description="Browse your complete catalogue"
        actions={
          <Link href="/library/new">
            <Button variant="primary" size="md">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add book
            </Button>
          </Link>
        }
      />

      <LibraryFiltersBar />
      <LibraryContent searchParams={params} />
    </>
  );
}
