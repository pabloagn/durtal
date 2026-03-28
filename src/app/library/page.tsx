export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { Plus, Library } from "lucide-react";
import { getWorks, getWorkCount } from "@/lib/actions/works";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { LibraryShell } from "./library-shell";

interface PageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    page?: string;
  }>;
}

async function LibraryContent({
  searchParams,
}: {
  searchParams: { q?: string; sort?: string; page?: string };
}) {
  const search = searchParams.q;
  const sort = (searchParams.sort ?? "recent") as
    | "title"
    | "recent"
    | "year"
    | "rating";
  const page = parseInt(searchParams.page ?? "1", 10);
  const limit = 48;
  const offset = (page - 1) * limit;

  const [works, total] = await Promise.all([
    getWorks({ search, sort, limit, offset }),
    getWorkCount(search),
  ]);

  if (works.length === 0) {
    return (
      <EmptyState
        icon={Library}
        title={search ? "No results" : "Your library is empty"}
        description={
          search
            ? `No works matching "${search}"`
            : "Add your first book to get started"
        }
        action={
          !search ? (
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

    return {
      workId: work.id,
      slug: work.slug ?? "",
      title: work.title,
      authorName: primaryAuthor?.name ?? "Unknown",
      coverUrl: firstEdition?.thumbnailS3Key ?? null,
      publicationYear: firstEdition?.publicationYear ?? work.originalYear,
      language: firstEdition?.language,
      instanceCount,
      rating: work.rating,
      catalogueStatus: work.catalogueStatus,
    };
  });

  const totalPages = Math.ceil(total / limit);

  return (
    <>
      <LibraryShell books={books} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {page > 1 && (
            <Link
              href={`/library?${new URLSearchParams({ ...(search ? { q: search } : {}), sort, page: String(page - 1) })}`}
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
              href={`/library?${new URLSearchParams({ ...(search ? { q: search } : {}), sort, page: String(page + 1) })}`}
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

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <LibraryContent searchParams={params} />
      </Suspense>
    </>
  );
}
