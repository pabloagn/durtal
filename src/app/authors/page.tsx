export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { getAuthors, getAuthorCount } from "@/lib/actions/authors";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { AuthorsShell, type AuthorItem } from "./authors-shell";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
  }>;
}

async function AuthorsContent({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; page?: string };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "name") as
    | "name"
    | "recent"
    | "birth"
    | "works";
  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 48;
  const offset = (page - 1) * limit;

  const [rawAuthors, total] = await Promise.all([
    getAuthors({ search, sort, limit, offset }),
    getAuthorCount(search),
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

  const authors: AuthorItem[] = rawAuthors.map((a) => ({
    id: a.id,
    slug: a.slug ?? "",
    name: a.name,
    sortName: a.sortName,
    nationality: a.country?.name ?? null,
    birthYear: a.birthYear,
    deathYear: a.deathYear,
    gender: a.gender,
    photoUrl: a.photoS3Key ?? null,
    website: a.website,
    bio: a.bio,
    worksCount: a.workAuthors.length,
    createdAt: new Date(a.createdAt).toLocaleDateString(),
  }));

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      <AuthorsShell authors={authors} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/authors?${new URLSearchParams({ ...(search ? { q: search } : {}), sort, page: String(page - 1) })}`}
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
              href={`/authors?${new URLSearchParams({ ...(search ? { q: search } : {}), sort, page: String(page + 1) })}`}
            >
              <Button variant="ghost" size="sm">
                Next
              </Button>
            </Link>
          )}
        </div>
      )}

      <p className="mt-4 text-center font-mono text-xs text-fg-muted">
        {total} {total === 1 ? "author" : "authors"}
      </p>
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
      />

      <Suspense
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
