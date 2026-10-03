import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  pageHref,
  lastPage,
  toSearchParams,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BookOpen } from "lucide-react";
import { getPublisher, getPublisherCatalogue } from "@/lib/actions/publishers";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedLinks } from "@/components/ui/segmented-links";
import { CopyBookButton } from "@/components/books/copy-book-button";
import { EditionCard } from "@/components/books/edition-card";
import { TARGET_STATE } from "@/components/publishers/target-state";
import { PublisherDetailHeader } from "./publisher-detail-header";

const FILTERS = [
  ["all", "All"],
  ["owned", "Owned"],
  ["wanted", "Wanted"],
  ["on_order", "On order"],
] as const;

export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const p = await getPublisher(slug);
  if (!p) notFound();
  const filterValue = toSearchParams(query).get("filter");
  const filter = FILTERS.some(([value]) => value === filterValue)
    ? filterValue!
    : "all";
  const { page, perPage } = parsePagination(query);
  const { rows, totals, pendingTargets } = await getPublisherCatalogue(
    p.id,
    filter,
    page,
    perPage,
  );
  if (page > lastPage(totals.works, perPage))
    redirect(
      pageHref(`/publishers/${slug}`, query, lastPage(totals.works, perPage)),
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

      <PublisherDetailHeader
        id={p.id}
        slug={p.slug}
        name={p.name}
        kind={p.kind}
        country={p.country}
        website={p.website}
        isFavourite={p.isFavourite}
        parent={p.parent}
        specialties={p.specialties}
      />

      {p.description && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">About</h2>
          <p className="max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">
            {p.description}
          </p>
        </section>
      )}

      {p.notes && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">My Notes</h2>
          <p className="max-w-2xl whitespace-pre-wrap border-l border-accent-rose pl-3 text-sm leading-relaxed text-fg-secondary">
            {p.notes}
          </p>
        </section>
      )}

      {p.children.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">
            Imprints ({p.children.length})
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {p.children.map((c) => (
              <Link
                key={c.id}
                href={`/publishers/${c.slug}`}
                className="text-fg-primary transition-colors hover:text-accent-rose"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {pendingTargets.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl text-fg-primary">
            Publisher Preferences ({pendingTargets.length})
          </h2>
          <div className="space-y-2">
            {pendingTargets.map((t) => {
              const state = TARGET_STATE[t.state] ?? TARGET_STATE.wanted;
              return (
                <div
                  key={t.target.id}
                  className="flex items-center gap-4 rounded-sm border border-glass-border bg-bg-secondary px-4 py-3 text-sm"
                >
                  <Link
                    href={`/library/${t.work.slug ?? t.work.id}`}
                    className="min-w-0 flex-1 truncate text-fg-primary transition-colors hover:text-accent-rose"
                  >
                    {t.work.title}
                  </Link>
                  <span className="text-xs text-fg-muted">
                    {t.publisher.name}
                  </span>
                  <Badge variant={state.variant}>{state.label}</Badge>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-2xl text-fg-primary">Catalogue</h2>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <SegmentedLinks
            label="Publisher catalogue filters"
            items={FILTERS.map(([value, label]) => ({
              href: pageHref(
                `/publishers/${slug}`,
                { ...query, filter: value },
                1,
              ),
              label,
              active: filter === value,
            }))}
          />
          <p className="text-xs text-fg-muted">
            {totals.works} book{totals.works === 1 ? "" : "s"} ·{" "}
            {totals.editions} edition{totals.editions === 1 ? "" : "s"} recorded
            in Durtal
          </p>
        </div>
        {rows.length ? (
          <PaginatedSection
            page={page}
            perPage={perPage}
            total={totals.works}
            noun="books"
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {rows.map(
                ({ edition: e, work, authors, owned, onOrder, wanted }) => (
                  <EditionCard
                    key={e.id}
                    href={`/library/${work.slug ?? work.id}#edition-${e.id}`}
                    title={e.title}
                    imageKey={e.thumbnailS3Key ?? e.coverS3Key}
                    authorNames={authors ? [authors] : []}
                    details={[
                      e.publisher,
                      e.imprint,
                      e.publicationYear,
                      e.language,
                      e.binding,
                    ]}
                    isbn={e.isbn13}
                    footer={
                      <>
                        <CopyBookButton
                          title={work.title}
                          authorName={authors ?? undefined}
                        />
                        <div className="flex items-center gap-1.5">
                          {owned && <Badge variant="sage">Owned edition</Badge>}
                          {onOrder && <Badge variant="blue">On order</Badge>}
                          {wanted && <Badge variant="gold">Wanted</Badge>}
                        </div>
                      </>
                    }
                  />
                ),
              )}
            </div>
          </PaginatedSection>
        ) : (
          <EmptyState
            icon={BookOpen}
            title="No editions here"
            description={
              filter === "all"
                ? "No editions in your catalogue are linked to this publisher yet."
                : "No editions match this view."
            }
          />
        )}
      </section>
    </>
  );
}
