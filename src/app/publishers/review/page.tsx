import { redirect } from "next/navigation";
import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  pageHref,
  lastPage,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import {
  getPublisherReview,
  getEditionPublisherLinks,
} from "@/lib/actions/publishers";
import { EditionPublishers } from "@/components/publishers/edition-publishers";
import { PageHeader } from "@/components/layout/page-header";
export default async function ReviewPublisherMatches({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const query = await searchParams;
  const { page, perPage } = parsePagination(query);
  const { rows, total } = await getPublisherReview(page, perPage);
  if (page > lastPage(total, perPage))
    redirect(pageHref("/publishers/review", query, lastPage(total, perPage)));
  const links = await Promise.all(
    rows.map((r) => getEditionPublisherLinks(r.edition.id)),
  );
  return (
    <>
      <Link
        href="/publishers"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to publishers
      </Link>
      <PageHeader
        title="Review publisher matches"
        description={`${total} edition${total === 1 ? " has" : "s have"} names that need review. Original metadata is preserved.`}
      />
      <PaginatedSection
        page={page}
        perPage={perPage}
        total={total}
        noun="editions"
      >
        <div className="space-y-3">
          {rows.map(({ edition: e, work: w }, i) => (
            <div
              key={e.id}
              className="space-y-2 rounded-sm border border-glass-border bg-bg-secondary p-4"
            >
              <Link
                href={`/library/${w.slug ?? w.id}#edition-${e.id}`}
                className="font-serif text-xl text-fg-primary transition-colors hover:text-accent-rose"
              >
                {w.title}
              </Link>
              <p className="text-xs text-fg-muted">
                {[e.publisher, e.imprint, e.isbn13, e.publicationCountry]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <EditionPublishers
                editionId={e.id}
                confirmed={e.publisherLinksConfirmed}
                linked={links[i].map((l) => l.publisher)}
              />
            </div>
          ))}
        </div>
        {!rows.length && (
          <EmptyState
            icon={CheckCircle2}
            title="All matched"
            description="No unmatched publisher names."
          />
        )}
      </PaginatedSection>
    </>
  );
}
