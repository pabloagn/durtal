import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, ListChecks, Plus } from "lucide-react";
import { parsePagination, pageHref, lastPage } from "@/lib/utils/pagination";
import { hasListQuery } from "@/lib/utils/list-params";
import {
  getPublishers,
  getPublisherCountries,
  type PublisherListOptions,
} from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { buttonClass } from "@/components/ui/button";
import type { PublisherItem } from "@/components/publishers/publisher-card";
import { PublishersFiltersBar } from "./publishers-filters-bar";
import { PublishersShell } from "./publishers-shell";
import { mediaUrl } from "@/lib/s3/media-url";

export const metadata = { title: "Publishers" };

type Params = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function many(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : value ? [value] : []).filter(Boolean);
}
function flatParams(params: Params) {
  const flat = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const v of many(value)) flat.append(key, v);
  return flat;
}

async function PublishersContent({ params }: { params: Params }) {
  const flat = flatParams(params);
  const { page, perPage } = parsePagination({
    page: one(params.page),
    perPage: one(params.perPage),
  });
  const kinds = one(params.kind)
    ?.split(",")
    .filter((k) => k === "group" || k === "publisher" || k === "imprint") as
    | PublisherListOptions["kinds"]
    | undefined;
  const sort = one(params.sort);
  const order = one(params.order);
  const { rows, total } = await getPublishers({
    search: one(params.q),
    sort: ["relevance", "name", "editions", "recent"].includes(sort ?? "")
      ? (sort as PublisherListOptions["sort"])
      : undefined,
    order: order === "asc" || order === "desc" ? order : undefined,
    favourites: one(params.favourites) === "true",
    kinds,
    countries: many(params.country),
    page,
    perPage,
  });
  if (page > lastPage(total, perPage))
    redirect(pageHref("/publishers", flat, lastPage(total, perPage)));

  // Full-page empty state only when there are no publishers at all. A search
  // or filter with no match is handled by the shell, below the toolbar.
  if (total === 0 && !hasListQuery(flat)) {
    return (
      <EmptyState
        icon={Building2}
        title="No publishers yet"
        description="Add the publishing houses and imprints you collect"
        action={
          <Link
            href="/publishers/new"
            className={buttonClass("secondary", "sm")}
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add publisher
          </Link>
        }
      />
    );
  }

  const publishers: PublisherItem[] = rows.map(
    ({ publisher: p, editionCount, parentName, logoKey, logoCard }) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      kind: p.kind,
      country: p.country,
      parentName,
      website: p.website,
      isFavourite: p.isFavourite,
      editionCount,
      logoUrl: logoKey ? mediaUrl(logoKey) : null,
      logoIsCard: logoCard,
      createdAt: new Date(p.createdAt).toLocaleDateString(),
    }),
  );

  return (
    <PublishersShell
      publishers={publishers}
      pagination={{ page, perPage, total }}
    />
  );
}

/**
 * Toolbar data does not depend on the URL. Its Suspense boundary has no key,
 * so the toolbar stays mounted (and keeps focus) while results reload.
 */
async function PublishersToolbar() {
  const countries = await getPublisherCountries();
  return <PublishersFiltersBar countries={countries} />;
}

export default async function PublishersPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  return (
    <>
      <PageHeader
        title="Publishers"
        description="Publishing houses and imprints you collect · edition counts refer to your catalogue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/publishers/review"
              className={buttonClass("ghost", "sm")}
            >
              <ListChecks className="h-4 w-4" strokeWidth={1.5} />
              Publisher names
            </Link>
            <Link
              href="/publishers/new"
              className={buttonClass("secondary", "sm")}
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Add Publisher
            </Link>
          </div>
        }
      />

      <Suspense fallback={<div className="mb-6 h-8" aria-hidden />}>
        <PublishersToolbar />
      </Suspense>

      <Suspense
        key={JSON.stringify(params)}
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <PublishersContent params={params} />
      </Suspense>
    </>
  );
}
