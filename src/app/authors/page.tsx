import { Suspense } from "react";
import { Users } from "lucide-react";
import {
  getAuthors,
  getAuthorCount,
  getDistinctNationalities,
  getDistinctGenders,
  getDistinctZodiacSigns,
  getAuthorBirthYearRange,
  getAuthorDeathYearRange,
} from "@/lib/actions/authors";
import { getAuthorsForMap } from "@/lib/actions/author-map";
import { getAuthorsForTimeline } from "@/lib/actions/author-timeline";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { AuthorsShell, type AuthorItem } from "./authors-shell";
import { AuthorCreateDialog } from "./author-create-dialog";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
    order?: string;
    nationality?: string;
    gender?: string;
    zodiac?: string;
    birthYearMin?: string;
    birthYearMax?: string;
    deathYearMin?: string;
    deathYearMax?: string;
    alive?: string;
  }>;
}

async function AuthorsContent({
  searchParams,
}: {
  searchParams: {
    q?: string;
    sort?: string;
    page?: string;
    order?: string;
    nationality?: string;
    gender?: string;
    zodiac?: string;
    birthYearMin?: string;
    birthYearMax?: string;
    deathYearMin?: string;
    deathYearMax?: string;
    alive?: string;
  };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "name") as
    | "name"
    | "lastName"
    | "recent"
    | "birth"
    | "works";
  const order = (searchParams.order ?? undefined) as "asc" | "desc" | undefined;
  const nationalityFilter = searchParams.nationality?.split(",").filter(Boolean);
  const genderFilter = searchParams.gender?.split(",").filter(Boolean);
  const zodiacFilter = searchParams.zodiac?.split(",").filter(Boolean);
  const birthYearMin = searchParams.birthYearMin ? parseInt(searchParams.birthYearMin, 10) : undefined;
  const birthYearMax = searchParams.birthYearMax ? parseInt(searchParams.birthYearMax, 10) : undefined;
  const deathYearMin = searchParams.deathYearMin ? parseInt(searchParams.deathYearMin, 10) : undefined;
  const deathYearMax = searchParams.deathYearMax ? parseInt(searchParams.deathYearMax, 10) : undefined;
  const aliveParam = searchParams.alive;
  const alive = aliveParam === "true" ? true : aliveParam === "false" ? false : undefined;

  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 48;
  const offset = (page - 1) * limit;

  const filters = {
    nationalities: nationalityFilter?.length ? nationalityFilter : undefined,
    genders: genderFilter?.length ? genderFilter : undefined,
    zodiacSigns: zodiacFilter?.length ? zodiacFilter : undefined,
    birthYearMin,
    birthYearMax,
    deathYearMin,
    deathYearMax,
    alive,
  };

  // getAuthorsForTimeline uses alive as a string ("true"|"false"), not boolean
  const timelineFilters = {
    nationalities: nationalityFilter?.length ? nationalityFilter : undefined,
    genders: genderFilter?.length ? genderFilter : undefined,
    zodiacSigns: zodiacFilter?.length ? zodiacFilter : undefined,
    birthYearMin,
    birthYearMax,
    deathYearMin,
    deathYearMax,
    alive: aliveParam,
  };

  const [rawAuthors, total, nationalities, genders, zodiacSigns, birthYearRange, deathYearRange, mapAuthors, timelineAuthors] =
    await Promise.all([
      getAuthors({ search, sort, order, limit, offset, filters }),
      getAuthorCount({ search, filters }),
      getDistinctNationalities(),
      getDistinctGenders(),
      getDistinctZodiacSigns(),
      getAuthorBirthYearRange(),
      getAuthorDeathYearRange(),
      getAuthorsForMap({ search, filters }),
      getAuthorsForTimeline({ search, filters: timelineFilters }),
    ]);

  if (rawAuthors.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={search ? "No authors found" : "No authors yet"}
        description={
          search
            ? `No authors matching "${search}"`
            : "Authors are created when you add books"
        }
      />
    );
  }

  const authors: AuthorItem[] = rawAuthors.map((a) => {
    // Prefer active poster from media table, fall back to legacy photoS3Key
    const activePoster = a.media?.find(
      (m) => m.type === "poster" && m.isActive,
    );
    const photoKey =
      activePoster?.thumbnailS3Key ?? activePoster?.s3Key ?? a.photoS3Key;

    return {
      id: a.id,
      slug: a.slug ?? "",
      name: a.name,
      firstName: a.firstName ?? null,
      lastName: a.lastName ?? null,
      sortName: a.sortName,
      nationality: a.country?.name ?? null,
      birthYear: a.birthYear,
      deathYear: a.deathYear,
      gender: a.gender,
      photoUrl: photoKey
        ? `/api/s3/read?key=${encodeURIComponent(photoKey)}`
        : null,
      posterCrop: activePoster
        ? { x: activePoster.cropX, y: activePoster.cropY, zoom: activePoster.cropZoom }
        : null,
      website: a.website,
      bio: a.bio,
      worksCount: a.workAuthors.length,
      createdAt: new Date(a.createdAt).toLocaleDateString(),
    };
  });

  const totalPages = Math.ceil(total / limit);

  const paginationParams = {
    ...(search ? { q: search } : {}),
    sort,
    ...(searchParams.order ? { order: searchParams.order } : {}),
    ...(searchParams.nationality ? { nationality: searchParams.nationality } : {}),
    ...(searchParams.gender ? { gender: searchParams.gender } : {}),
    ...(searchParams.zodiac ? { zodiac: searchParams.zodiac } : {}),
    ...(searchParams.birthYearMin ? { birthYearMin: searchParams.birthYearMin } : {}),
    ...(searchParams.birthYearMax ? { birthYearMax: searchParams.birthYearMax } : {}),
    ...(searchParams.deathYearMin ? { deathYearMin: searchParams.deathYearMin } : {}),
    ...(searchParams.deathYearMax ? { deathYearMax: searchParams.deathYearMax } : {}),
    ...(searchParams.alive ? { alive: searchParams.alive } : {}),
  };

  return (
    <>
      <AuthorsShell
        authors={authors}
        mapAuthors={mapAuthors}
        timelineAuthors={timelineAuthors}
        nationalities={nationalities}
        genders={genders}
        zodiacSigns={zodiacSigns}
        birthYearRange={birthYearRange}
        deathYearRange={deathYearRange}
        pagination={{
          page,
          totalPages,
          total,
          paginationParams,
        }}
      />
    </>
  );
}

export default async function AuthorsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <>
      <PageHeader
        title="Authors"
        description="Browse all authors in your catalogue"
        actions={<AuthorCreateDialog />}
      />

      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <AuthorsContent searchParams={params} />
      </Suspense>
    </>
  );
}
