import type { Metadata } from "next";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { cache } from "react";
import Link from "next/link";
import { BackLink } from "@/components/shared/back-link";
import { notFound, redirect } from "next/navigation";
import { Library } from "lucide-react";
import { findPublisher, getPublisher } from "@/lib/actions/publishers";
import { getPublisherSuggestionSummary } from "@/lib/actions/publisher-names";
import {
  getPublisherBookFacets,
  getPublisherBooks,
  getPublisherCounts,
  getPublisherImages,
  getPublisherTargets,
  parsePublisherBookQuery,
} from "@/lib/publishers/books";
import { HOUSE_KIND_LABEL } from "@/lib/publishers/kinds";
import { lastPage, pageHref, toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import { clearedListHref, hasListQuery } from "@/lib/utils/list-params";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { isLogoCard } from "@/lib/media/logo-card-options";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { FullBleedLayer } from "@/components/shared/full-bleed-layer";
import { SectionHeading } from "@/components/shared/section-heading";
import { Prose } from "@/components/shared/prose";
import { NoResults } from "@/components/shared/no-results";
import { EmptyState } from "@/components/ui/empty-state";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import {
  DetailColumns,
  RecordField,
  RecordFields,
  RecordGroup,
  RecordPanel,
} from "@/components/shared/detail-layout";
import { PublisherHeader } from "@/components/publishers/publisher-header";
import { WorkCarousel } from "@/components/books/work-carousel";
import { loadRelatedBooks } from "@/lib/catalogue/related-books";
import { PublisherBooksFilters, PublisherBooksView } from "@/components/publishers/publisher-books";
import { ListPendingProvider, ListPendingSwap } from "@/components/shared/list-pending";
import { mediaUrl } from "@/lib/s3/media-url";
import { FadeImage } from "@/components/shared/fade-image";

const LINK = "text-command";
/** Wanted books shown on the house's page; its heading opens them all */
const WANTED_SHELF = 24;
/** One read per request for the page and its title */
const loadPublisher = cache(getPublisher);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const publisher = await loadPublisher((await params).slug);
  return { title: publisher?.name ?? "Publisher not found" };
}

/** URL parameters for how the books show (`publisher-books.tsx`), not which */
const BOOK_VIEW_PARAMS = ["view", "cols"];

/** "Founded 1963 in New York", "Founded 1963", "Founded in New York" */
function founded(p: { foundedYear: number | null; foundedPlace: { name: string } | null }) {
  if (p.foundedYear == null && !p.foundedPlace) return null;
  return [
    "Founded",
    p.foundedYear,
    p.foundedPlace && `in ${p.foundedPlace.name}`,
  ]
    .filter(Boolean)
    .join(" ");
}

export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  // The page's reads start from the house's id, beside its details (SLN-839)
  const house = await findPublisher(slug);
  if (!house) notFound();
  const query = parsePublisherBookQuery(raw);
  const booksRead = getPublisherBooks(house.id, query);
  // The books wanted from the house, one card each (a book can be wanted
  // from the house and from an imprint), the first WANTED_SHELF of them
  const targetsRead = getPublisherTargets(house.id);
  const wantedRead = targetsRead.then((targets) => [...new Set(targets.map((t) => t.work.id))].slice(0, WANTED_SHELF));

  const [p, { books, total }, facets, counts, images, targets, suggested, digital, wanted] = await Promise.all([
    loadPublisher(slug),
    booksRead,
    getPublisherBookFacets(house.id),
    getPublisherCounts(house.id),
    getPublisherImages(house.id),
    targetsRead,
    getPublisherSuggestionSummary(house.id),
    Promise.all([booksRead, wantedRead]).then(([{ books }, wantedIds]) =>
      catalogueAvailability([...books.map((book) => book.workId), ...wantedIds]),
    ),
    wantedRead.then((wantedIds) => loadRelatedBooks(wantedIds.map((workId) => ({ workId })))),
  ]);
  if (!p) notFound();
  const basePath = `/publishers/${p.slug}`;
  if (query.page > lastPage(total, query.perPage))
    redirect(pageHref(basePath, raw, lastPage(total, query.perPage)));

  const wantedIds = [...new Set(targets.map((t) => t.work.id))];
  const wantedWorks = wantedIds.slice(0, WANTED_SHELF).flatMap((id) => {
    const work = wanted.books.get(id);
    return work ? [{ ...work, targets: targets.filter((t) => t.work.id === id) }] : [];
  });
  const digitalBooks = books.map((book) => ({ ...book, ebook: digital.get(book.workId)?.read ?? null, readerReturnTo: pageHref(basePath, raw, query.page) }));
  const { logo, background } = images;
  const facts = [
    p.kind !== "publisher" && HOUSE_KIND_LABEL[p.kind],
    p.parent && (
      <span key="parent">
        {p.kind === "imprint" ? "Imprint of " : "Part of "}
        <Link href={`/publishers/${p.parent.slug}`} className={LINK}>
          {p.parent.name}
        </Link>
      </span>
    ),
    p.country,
    founded(p),
    `${counts.books} ${counts.books === 1 ? "book" : "books"}`,
  ].filter(Boolean) as React.ReactNode[];

  const website = p.website && /^https?:\/\//i.test(p.website) ? p.website : null;
  const urlParams = toSearchParams(raw);
  // The books' view and columns are how the list shows, not what it holds
  const filterParams = new URLSearchParams(urlParams);
  for (const key of BOOK_VIEW_PARAMS) filterParams.delete(key);
  const hasDetails =
    !!p.country ||
    p.foundedYear != null ||
    !!p.foundedPlace ||
    !!p.group ||
    p.children.length > 0 ||
    p.aliases.length > 0 ||
    p.specialties.length > 0 ||
    p.isbnPrefixes.length > 0;

  // A house with nothing in the catalogue leaves the counts out: six zeros
  // only repeat the empty Books section (docs/03, a group with nothing to
  // show is left out)
  const inCatalogue = [counts.books, counts.editions, counts.owned, counts.read, counts.wanted, counts.onOrder].some((n) => n > 0);
  const record = (
    <RecordPanel>
      {inCatalogue && (
        <RecordGroup title="In the catalogue">
          <RecordFields>
            <RecordField label="Books">{counts.books}</RecordField>
            <RecordField label="Editions">{counts.editions}</RecordField>
            <RecordField label="Owned">{counts.owned}</RecordField>
            <RecordField label="Read">{counts.read}</RecordField>
            <RecordField label="Wanted">{counts.wanted}</RecordField>
            <RecordField label="On order">{counts.onOrder}</RecordField>
          </RecordFields>
        </RecordGroup>
      )}
      {hasDetails && (
        <RecordGroup title="Details">
          <RecordFields>
            {p.country && <RecordField label="Country">{p.country}</RecordField>}
            {p.foundedYear != null && (
              <RecordField label="Founded">{p.foundedYear}</RecordField>
            )}
            {p.foundedPlace && (
              <RecordField label="Founded in">
                {p.foundedPlace.fullName ?? p.foundedPlace.name}
              </RecordField>
            )}
            {p.group && (
              <RecordField label="Group">
                <Link href={`/publishers/${p.group.slug}`} className={LINK}>
                  {p.group.name}
                </Link>
              </RecordField>
            )}
            {p.children.length > 0 && (
              <RecordField label={p.kind === "group" ? "Publishers" : "Imprints"}>
                <ul className="space-y-0.5">
                  {p.children.map((c) => (
                    <li key={c.id}>
                      <Link href={`/publishers/${c.slug}`} className={LINK}>
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </RecordField>
            )}
            {p.aliases.length > 0 && <RecordField label="Other names">{p.aliases.join(" · ")}</RecordField>}
            {p.specialties.length > 0 && (
              <RecordField label="Specialties">{p.specialties.map((s) => s.name).join(" · ")}</RecordField>
            )}
            {p.isbnPrefixes.length > 0 && (
              <RecordField label="ISBN prefixes">
                <span className="font-mono text-xs">{p.isbnPrefixes.join(" · ")}</span>
              </RecordField>
            )}
          </RecordFields>
        </RecordGroup>
      )}
      <RecordGroup title="Links">
        <ul className="space-y-1 text-sm">
          {/* Every role of this house, in every collection */}
          <li>
            <Link href={`/organizations/${p.slug}`} className={LINK}>
              Organization page
            </Link>
          </li>
          {website && (
            <li>
              <a href={website} target="_blank" rel="noopener noreferrer" className={LINK}>
                Website
              </a>
            </li>
          )}
        </ul>
      </RecordGroup>
    </RecordPanel>
  );

  return (
    <>
      <CopyShortcuts name={p.name} />
      {/* Backdrop and header, like the author page */}
      <div className={background ? "relative -mx-6 -mt-6 mb-8" : ""}>
        {background && (
          <FullBleedLayer className="-z-0">
            <FadeImage
              src={mediaUrl(background.s3Key)}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(background))}
              fallback={null}
            />
            {/* Dark overlay for readability */}
            <div className="absolute inset-0 bg-scrim" />
            {/* Bottom gradient: dissolves into the page background */}
            <div
              className="absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(to top, var(--color-bg-primary) 0%, var(--color-bg-primary) 5%, transparent 100%)",
              }}
            />
          </FullBleedLayer>
        )}
        <div className={background ? "relative z-10 px-6 pt-6 pb-2" : ""}>
          <BackLink href="/publishers">Back to publishers</BackLink>
          <PublisherHeader
            id={p.id}
            slug={p.slug}
            name={p.name}
            logoUrl={logo ? mediaUrl(logo.thumbnailS3Key ?? logo.s3Key) : null}
            logoIsCard={isLogoCard(logo?.processingParams)}
            facts={facts}
            favourite={p.isFavourite}
          />
        </div>
      </div>

      <DetailColumns record={record}>
        {p.description && (
          <section className="mb-8">
            <SectionHeading title="About" />
            <Prose className="whitespace-pre-line">{p.description}</Prose>
          </section>
        )}

        {p.notes && (
          <section className="mb-8">
            <SectionHeading title="Notes" />
            <p className="max-w-3xl whitespace-pre-wrap border-l border-accent-primary pl-3 text-sm text-fg-secondary">
              {p.notes}
            </p>
          </section>
        )}

        <section className="mb-8" id="list-start">
          <SectionHeading title="Books" count={total} />
          {(suggested.editions > 0 || p.createdFrom) && (
            <div className="mb-4 space-y-1 text-sm text-fg-secondary">
              {suggested.editions > 0 && (
                <p>
                  {suggested.editions} more edition{suggested.editions === 1 ? "" : "s"} without a publishing house
                  look{suggested.editions === 1 ? "s" : ""} like {p.name}.{" "}
                  <Link href={`/publishers/review?publisher=${p.slug}`} className={LINK}>
                    Review
                  </Link>
                </p>
              )}
              {p.createdFrom && (
                <p>
                  Created automatically on{" "}
                  <span className="font-mono">{p.createdFrom.createdAt.toISOString().slice(0, 10)}</span> from the
                  book data name &ldquo;{p.createdFrom.name}&rdquo;.{" "}
                  <Link href="/publishers/review" className={LINK}>
                    Undo in Publisher names
                  </Link>
                </p>
              )}
            </div>
          )}
          {/* A search, sort or filter marks the books busy at once, as on the
              other lists (SLN-806) */}
          <ListPendingProvider>
            {counts.books > 0 && <PublisherBooksFilters basePath={basePath} facets={facets} />}
            <ListPendingSwap>
              {books.length > 0 ? (
                <PublisherBooksView books={digitalBooks} pagination={{ page: query.page, perPage: query.perPage, total }} />
              ) : counts.books > 0 && hasListQuery(filterParams) ? (
                <NoResults
                  noun="books"
                  search={query.q}
                  hasFilters={[...filterParams.keys()].some((k) => k !== "q" && hasListQuery(new URLSearchParams([[k, filterParams.get(k)!]])))}
                  clearHref={clearedListHref(basePath, urlParams)}
                />
              ) : (
                <EmptyState
                  icon={Library}
                  title="No books yet"
                  description={`No edition in the catalogue names ${p.name} as its publisher.`}
                  action={suggested.editions > 0 ? undefined : <DomainAddLink kind="book" size="md" />}
                />
              )}
            </ListPendingSwap>
          </ListPendingProvider>
        </section>

        {/* Cover cards, as every book list. The heading is no link: the
            house's book list counts its editions, so a book wanted from the
            house with no edition of it catalogued would not be there */}
        {wantedWorks.length > 0 && (
          <section className="mb-8" aria-label="Wanted from this publisher">
            <WorkCarousel
              title="Wanted from this publisher"
              count={wantedIds.length}
              works={wantedWorks}
              ebooks={new Map([...digital].map(([id, value]) => [id, value.read]))}
              readerReturnTo={pageHref(basePath, raw, query.page)}
              caption={(w) => (
                <p className="mt-1.5 text-micro text-fg-secondary">
                  {w.targets.map((t) => `${t.publisher} · ${t.state === "on_order" ? "On order" : "Wanted"}`).join("; ")}
                </p>
              )}
            />
          </section>
        )}
      </DetailColumns>
    </>
  );
}
