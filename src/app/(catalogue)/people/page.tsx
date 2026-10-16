import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { favouritesOnly } from "@/lib/constants/favourites";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import {
  getAuthors,
  getAuthorCoverPreviews,
  getAuthorCount,
  getDistinctNationalities,
  getDistinctGenders,
  getDistinctZodiacSigns,
  getAuthorBirthYearRange,
  getAuthorDeathYearRange,
  getPeopleFilterOptions,
  getPersonRoles,
  getPersonWorkCounts,
} from "@/lib/actions/authors";
import type { PersonRole } from "@/lib/catalogue/person-roles";
import { WORK_KINDS, type WorkKind } from "@/lib/catalogue/kinds";
import { resolveLegacyNationalityParam } from "@/lib/actions/utils/author-filters";
import {
  formatNationalityParam,
  parseNationalityCodes,
} from "@/lib/utils/nationality-param";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyIndex } from "@/components/shared/empty-index";
import { ListPending, ListPendingProvider, ListPendingSwap } from "@/components/shared/list-pending";
import { AuthorsShell, type AuthorItem } from "./authors-shell";
import { AuthorsFiltersBar } from "./authors-filters-bar";
import { AuthorCreateDialog } from "./author-create-dialog";
import { mediaCrop } from "@/lib/utils/media-style";
import { stripHtmlToText } from "@/lib/utils/sanitize";
import { countryDisplayName } from "@/lib/utils/labels";
import { mediaUrl } from "@/lib/s3/media-url";

export const metadata = { title: "People" };

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
    perPage?: string;
    order?: string;
    nationality?: string;
    gender?: string;
    zodiac?: string;
    birthYearMin?: string;
    birthYearMax?: string;
    deathYearMin?: string;
    deathYearMax?: string;
    alive?: string;
    collection?: string;
    role?: string;
    favourites?: string;
  }>;
}

type PeopleParams = {
  q?: string;
  sort?: string;
  page?: string;
  perPage?: string;
  order?: string;
  nationality?: string;
  gender?: string;
  zodiac?: string;
  birthYearMin?: string;
  birthYearMax?: string;
  deathYearMin?: string;
  deathYearMax?: string;
  alive?: string;
  collection?: string;
  role?: string;
  favourites?: string;
  }

/** The list's options and its first read, started before the page knows whether anyone exists */
function peopleQuery(searchParams: PeopleParams) {
  const search = searchParams.q;
  // A search orders by best match unless the user picks another sort
  const sort = (searchParams.sort ?? (search?.trim() ? "relevance" : "name")) as
    | "relevance"
    | "name"
    | "lastName"
    | "recent"
    | "birth"
    | "works";
  const order = (searchParams.order ?? undefined) as "asc" | "desc" | undefined;
  const nationalityFilter = parseNationalityCodes(searchParams.nationality) ?? [];
  const genderFilter = searchParams.gender?.split(",").filter(Boolean);
  const zodiacFilter = searchParams.zodiac?.split(",").filter(Boolean);
  const birthYearMin = searchParams.birthYearMin ? parseInt(searchParams.birthYearMin, 10) : undefined;
  const birthYearMax = searchParams.birthYearMax ? parseInt(searchParams.birthYearMax, 10) : undefined;
  const deathYearMin = searchParams.deathYearMin ? parseInt(searchParams.deathYearMin, 10) : undefined;
  const deathYearMax = searchParams.deathYearMax ? parseInt(searchParams.deathYearMax, 10) : undefined;
  const aliveParam = searchParams.alive;
  const alive = aliveParam === "true" ? true : aliveParam === "false" ? false : undefined;

  const { page, perPage: limit, offset } = parsePagination(searchParams);

  const collections = searchParams.collection?.split(",").filter(Boolean);
  const roles = searchParams.role?.split(",").filter(Boolean);
  const filters = {
    collections: collections?.length ? collections : undefined,
    roles: roles?.length ? roles : undefined,
    nationalities: nationalityFilter.length ? nationalityFilter : undefined,
    genders: genderFilter?.length ? genderFilter : undefined,
    zodiacSigns: zodiacFilter?.length ? zodiacFilter : undefined,
    birthYearMin,
    birthYearMax,
    deathYearMin,
    deathYearMax,
    alive,
    favourites: favouritesOnly(searchParams.favourites) || undefined,
  };

  // getAuthorsForTimeline uses alive as a string ("true"|"false"), not boolean
  const timelineFilters = {
    collections: filters.collections,
    roles: filters.roles,
    nationalities: nationalityFilter.length ? nationalityFilter : undefined,
    genders: genderFilter?.length ? genderFilter : undefined,
    zodiacSigns: zodiacFilter?.length ? zodiacFilter : undefined,
    birthYearMin,
    birthYearMax,
    deathYearMin,
    deathYearMax,
    alive: aliveParam,
    favourites: favouritesOnly(searchParams.favourites) || undefined,
  };

  const first = Promise.all([
    getAuthors({ search, sort, order, limit, offset, filters }),
    getAuthorCount({ search, filters }),
  ]);
  // With no people the list is never awaited: its failure must not go unhandled
  first.catch(() => {});
  return { search, filters, timelineFilters, collections, roles, page, limit, first };
}

async function AuthorsContent({
  searchParams,
  query,
}: {
  searchParams: PeopleParams;
  query: ReturnType<typeof peopleQuery>;
}) {
  const { search, filters, timelineFilters, collections, roles, page, limit } = query;
  const [rawAuthors, total] = await query.first;

  if (page > lastPage(total, limit)) redirect(pageHref("/people", searchParams, lastPage(total, limit)));

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
      nationality: countryDisplayName(a.country),
      birthYear: a.birthYear,
      deathYear: a.deathYear,
      gender: a.gender,
      photoUrl: photoKey
        ? mediaUrl(photoKey)
        : null,
      posterCrop: activePoster
        ? mediaCrop(activePoster)
        : null,
      photoTone: activePoster?.tone ?? null,
      website: a.website,
      // Bios are stored as HTML; the list shows a one-line text preview
      bio: a.bio ? stripHtmlToText(a.bio) || null : null,
      worksCount: a.workAuthors.length,
      roles: [] as PersonRole[],
      booksCount: a.workAuthors.length,
      isFavourite: a.isFavourite,
      createdAt: new Date(a.createdAt).toLocaleDateString(),
      coverPreviews: [] as string[],
    };
  });

  // Authors with no portrait show some of their book covers instead
  // Cover previews, every card's roles and the Works column's counts: one
  // query each, never one per card
  const [previews, rolesById, workCounts] = await Promise.all([
    getAuthorCoverPreviews(
      authors.filter((a) => !a.photoUrl && a.booksCount > 0).map((a) => a.id),
    ),
    getPersonRoles(authors.map((a) => a.id)),
    // The Works column counts every collection's works, not only books
    getPersonWorkCounts(authors.map((a) => a.id)),
  ]);
  for (const a of authors) {
    a.coverPreviews = previews[a.id] ?? [];
    a.roles = rolesById[a.id] ?? [];
    a.worksCount = workCounts[a.id] ?? 0;
  }
  // Filtered to one collection: its roles come first on the cards
  const preferKind =
    collections?.length === 1 && (WORK_KINDS as readonly string[]).includes(collections[0])
      ? (collections[0] as WorkKind)
      : null;


  return (
    <>
      <AuthorsShell
        authors={authors}
        preferKind={preferKind}
        preferRoles={roles?.length ? roles : null}
        mapQuery={{ search, filters }}
        timelineQuery={{ search, filters: timelineFilters }}
        pagination={{
          page,
          perPage: limit,
          total,
        }}
      />
    </>
  );
}

/**
 * Toolbar data does not depend on the URL. Its Suspense boundary has no key,
 * so the toolbar stays mounted (and keeps focus) while results reload.
 */
async function AuthorsToolbar() {
  const [people, nationalities, genders, zodiacSigns, birthYearRange, deathYearRange] =
    await Promise.all([
      getPeopleFilterOptions(),
      getDistinctNationalities(),
      getDistinctGenders(),
      getDistinctZodiacSigns(),
      getAuthorBirthYearRange(),
      getAuthorDeathYearRange(),
    ]);

  return (
    <AuthorsFiltersBar
      collections={people.collections}
      roles={people.roles}
      nationalities={nationalities}
      genders={genders}
      zodiacSigns={zodiacSigns}
      birthYearRange={birthYearRange}
      deathYearRange={deathYearRange}
    />
  );
}

export default async function AuthorsPage({ searchParams }: PageProps) {
  const params = await searchParams;

  // Old links used country names ("Hungary, Republic of"), which contain the
  // list delimiter. Redirect them to the code-based format ("HU").
  if (params.nationality && parseNationalityCodes(params.nationality) === null) {
    const codes = await resolveLegacyNationalityParam(params.nationality);
    const next = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"),
    );
    if (codes.length > 0) {
      next.set("nationality", formatNationalityParam(codes));
    } else {
      next.delete("nationality");
    }
    redirect(`/people?${next.toString()}`);
  }

  // Whether anyone exists and the list itself, read side by side
  const anyone = getAuthorCount();
  const query = peopleQuery(params);
  if (!(await anyone)) {
    return (
      <EmptyIndex
        title="People"
        icon={Users}
        empty="No people yet"
        description="People are the writers, translators, directors, perfumers and painters behind your works. They come with the books, films, perfumes and paintings you add, or add one here."
        action={<AuthorCreateDialog />}
      />
    );
  }
  return (
    <>
      <PageHeader
        title="People"
        actions={<AuthorCreateDialog />}
      />

      {/* A search, sort or filter marks the results busy at once (SLN-753) */}
      <ListPendingProvider>
        <Suspense fallback={<div className="mb-6 h-8" aria-hidden />}>
          <AuthorsToolbar />
        </Suspense>

        <ListPendingSwap>
          <Suspense key={JSON.stringify(params)} fallback={<ListPending />}>
            <AuthorsContent searchParams={params} query={query} />
          </Suspense>
        </ListPendingSwap>
      </ListPendingProvider>
    </>
  );
}
