import { Suspense } from "react";
import { Spinner } from "@/components/ui/spinner";
import { redirect } from "next/navigation";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import Link from "next/link";
import { Library, ListChecks } from "lucide-react";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";
import { clearedListHref, hasListQuery } from "@/lib/utils/list-params";
import { LibraryShell } from "./library-shell";
import { LibraryFiltersBar } from "./library-filters-bar";
import { DomainSwitch } from "@/components/domains/domain-switch";
import {
  DomainAddLink,
  domainDescription,
} from "@/components/domains/domain-add-link";
import { getWorkIdsWithDigitalEditions } from "@/lib/calibre/queries";
import { mediaUrl } from "@/lib/s3/media-url";
import { mediaCrop } from "@/lib/utils/media-style";
import { parseMarks } from "@/lib/constants/marks";

export const metadata = { title: "Library" };

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    order?: string;
    status?: string;
    priority?: string;
    rare?: string;
    mark?: string;
    publisher?: string;
    rating?: string;
    location?: string;
    poster?: string;
    page?: string;
    perPage?: string;
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
    mark?: string;
    publisher?: string;
    rating?: string;
    location?: string;
    poster?: string;
    page?: string;
    perPage?: string;
  };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "title") as
    | "title"
    | "recent"
    | "year"
    | "rating"
    | "authorFirstName"
    | "authorLastName";
  const order = (searchParams.order ?? undefined) as "asc" | "desc" | undefined;
  const { page, perPage: limit, offset } = parsePagination(searchParams);

  const statusFilter = searchParams.status?.split(",").filter(Boolean);
  const priorityFilter = searchParams.priority?.split(",").filter(Boolean);
  // One "Marks" group; the old `rare=true` link still selects Rare
  const markFilter = parseMarks(
    [searchParams.mark, searchParams.rare === "true" ? "rare" : ""].join(","),
  );
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

  const [works, total] = await Promise.all([
    getWorks({
      search,
      sort,
      order,
      limit,
      offset,
      filters: {
        catalogueStatus: statusFilter?.length ? statusFilter : undefined,
        marks: markFilter,
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
      marks: markFilter,
      publisherIds: searchParams.publisher
        ?.split(",")
        .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
      acquisitionPriority: priorityFilter?.length ? priorityFilter : undefined,
      minRating,
      locationId,
      hasPoster,
    }),
  ]);

  if (page > lastPage(total, limit)) redirect(pageHref("/library", searchParams, lastPage(total, limit)));

  if (works.length === 0) {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    if (hasListQuery(params)) {
      // The filters bar is rendered by the page, so it stays visible here
      return (
        <NoResults
          noun="books"
          search={search}
          hasFilters={
            !!(
              statusFilter?.length ||
              priorityFilter?.length ||
              markFilter.length > 0 ||
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
        title="No books yet"
        description="Add your first book to get started"
        action={<DomainAddLink kind="book" />}
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
    // Edition cover keys are reused when the cover changes: version the URL
    const coverVersion = activePoster
      ? activePoster.createdAt
      : firstEdition?.updatedAt;

    return {
      workId: work.id,
      slug: work.slug ?? "",
      title: work.title,
      authorName: primaryAuthor?.name ?? "Unknown",
      authorNames: work.workAuthors.map((wa) => wa.author.name),
      coverUrl: coverS3Key
        ? mediaUrl(coverS3Key, { version: coverVersion })
        : null,
      coverCrop: activePoster ? mediaCrop(activePoster) : null,
      coverTone: activePoster?.tone ?? null,
      publicationYear: firstEdition?.publicationYear ?? work.originalYear,
      language: firstEdition?.language,
      instanceCount,
      rating: work.rating,
      catalogueStatus: work.catalogueStatus,
      acquisitionPriority: work.acquisitionPriority,
      isRare: work.isRare,
      huntAssessedOn: work.huntAssessedOn,
      isPoison: work.isPoison,
      isFavourite: work.isFavourite,
      primaryEditionId: firstEdition?.id ?? null,
      hasDigitalEdition: digitalWorkIds.has(work.id),
    };
  });


  return (
    <>
      <LibraryShell
        books={books}
        timelineQuery={{
          search,
          filters: {
            catalogueStatus: statusFilter?.length ? statusFilter : undefined,
            marks: markFilter,
            publisherIds: searchParams.publisher
              ?.split(",")
              .filter((v) => /^[0-9a-f-]{36}$/i.test(v)),
          },
        }}
        pagination={{ page, perPage: limit, total }}
      />
    </>
  );
}

export default async function LibraryPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Books"
        description={domainDescription("book")}
        tabs={<DomainSwitch current="book" searchParams={params} />}
        actions={
          <>
            <Link
              href="/library/identify"
              className={`${buttonClass("ghost", "md")} whitespace-nowrap`}
            >
              <ListChecks className="h-3.5 w-3.5" strokeWidth={1.5} />
              Identify editions
            </Link>
            <DomainAddLink kind="book" />
          </>
        }
      />

      <LibraryFiltersBar />
      <Suspense key={JSON.stringify(params)} fallback={<div className="py-16"><Spinner /></div>}><LibraryContent searchParams={params} /></Suspense>
    </>
  );
}
