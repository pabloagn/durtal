import Link from "next/link";
import { Plus, Library } from "lucide-react";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { getWorksForTimeline } from "@/lib/actions/work-timeline";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";
import { clearedListHref, hasListQuery } from "@/lib/utils/list-params";
import { LibraryShell } from "./library-shell";
import { LibraryFiltersBar } from "./library-filters-bar";
import { getWorkIdsWithDigitalEditions } from "@/lib/calibre/queries";
import { mediaCrop } from "@/lib/utils/media-style";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    status?: string;
    priority?: string;
    rare?: string;
    publisher?: string;
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
    rare?: string;
    publisher?: string;
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
  const rareFilter = searchParams.rare === "true" ? true : undefined;
  const ratingParam = searchParams.rating;
  const minRating = ratingParam ? parseInt(ratingParam, 10) : undefined;
  const locationId = searchParams.location || undefined;
  const posterParam = searchParams.poster;
  const hasPoster =
    posterParam === "has"
      ? true
      : posterParam === "missing"
        ? false
        : undefined;

  const [works, total, timelineWorks] = await Promise.all([
    getWorks({
      search,
      sort,
      order,
      limit,
      offset,
      filters: {
        catalogueStatus: statusFilter?.length ? statusFilter : undefined,
        isRare: rareFilter,
        publisherIds: searchParams.publisher
          ?.split(",")
          .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
        acquisitionPriority: priorityFilter?.length
          ? priorityFilter
          : undefined,
        minRating,
        locationId,
        hasPoster,
      },
    }),
    getWorkCount(search, {
      catalogueStatus: statusFilter?.length ? statusFilter : undefined,
      isRare: rareFilter,
      publisherIds: searchParams.publisher
        ?.split(",")
        .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
      acquisitionPriority: priorityFilter?.length ? priorityFilter : undefined,
      minRating,
      locationId,
      hasPoster,
    }),
    getWorksForTimeline({
      search,
      filters: {
        catalogueStatus: statusFilter?.length ? statusFilter : undefined,
        isRare: rareFilter,
        publisherIds: searchParams.publisher
          ?.split(",")
          .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
      },
    }),
  ]);

  if (works.length === 0 && timelineWorks.length === 0) {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    if (hasListQuery(params)) {
      // The filters bar is rendered by the page, so it stays visible here
      return (
        <NoResults
          noun="works"
          search={search}
          hasFilters={
            !!(
              statusFilter?.length ||
              priorityFilter?.length ||
              rareFilter ||
              ratingParam ||
              locationId ||
              posterParam
            )
          }
          clearHref={clearedListHref("/library", params)}
        />
      );
    }
    return (
      <EmptyState
        icon={Library}
        title="Your library is empty"
        description="Add your first book to get started"
        action={
          <Link href="/library/new">
            <Button variant="primary">
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Add book
            </Button>
          </Link>
        }
      />
    );
  }

  // Check which works have digital editions in Calibre
  const workIds = works.map((w) => w.id);
  const digitalWorkIds = await getWorkIdsWithDigitalEditions(workIds);

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
      coverCrop: activePoster ? mediaCrop(activePoster) : null,
      publicationYear: firstEdition?.publicationYear ?? work.originalYear,
      language: firstEdition?.language,
      instanceCount,
      rating: work.rating,
      catalogueStatus: work.catalogueStatus,
      acquisitionPriority: work.acquisitionPriority,
      isRare: work.isRare,
      huntAssessedOn: work.huntAssessedOn,
      primaryEditionId: firstEdition?.id ?? null,
      hasDigitalEdition: digitalWorkIds.has(work.id),
    };
  });

  const totalPages = Math.ceil(total / limit);

  const paginationParams = {
    ...(search ? { q: search } : {}),
    sort,
    ...(order ? { order } : {}),
    ...(searchParams.status ? { status: searchParams.status } : {}),
    ...(searchParams.rare ? { rare: searchParams.rare } : {}),
    ...(searchParams.priority ? { priority: searchParams.priority } : {}),
    ...(searchParams.rating ? { rating: searchParams.rating } : {}),
    ...(searchParams.location ? { location: searchParams.location } : {}),
    ...(searchParams.poster ? { poster: searchParams.poster } : {}),
  };

  return (
    <>
      <LibraryShell books={books} timelineWorks={timelineWorks}>
        {/* Pagination — hidden in timeline mode by LibraryShell */}
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
      </LibraryShell>
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
