import type { Metadata } from "next";
import { ebooksAvailableText } from "@/lib/utils/format";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { getSeriesEbookSuggestionCount } from "@/lib/ebooks/review-queue/suggestions";
import { EbookSuggestionLine } from "@/components/ebooks/ebook-suggestion-line";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { cache, Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { seriesBooksLabel, seriesOutOf } from "@/lib/series/counts";
import { getSeriesDetail, getSeriesSuggestions } from "@/lib/actions/series";
import { getSeriesNextToRead } from "@/lib/actions/reading";
import { Badge } from "@/components/ui/badge";
import { DetailControls, DetailTitleRow } from "@/components/shared/detail-layout";
import { AddSeriesBooksButton, SeriesActions } from "@/components/series/series-actions";
import { EmptyState } from "@/components/ui/empty-state";
import { SeriesBooks, type SeriesBook } from "@/components/series/series-books";
import { SeriesSuggestions } from "@/components/series/series-suggestions";
import { STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus } from "@/lib/types";
import { mediaCrop } from "@/lib/utils/media-style";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";
import { Prose } from "@/components/shared/prose";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ add?: string }>;
}

/** One read per request for the page and its title */
const loadSeries = cache(getSeriesDetail);

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const series = await loadSeries((await params).id);
  return { title: series?.title ?? "Series not found" };
}

export default async function SeriesDetailPage({
  params,
  searchParams,
}: PageProps) {
  const { id } = await params;
  // The volumes' e-book availability follows the series alone, beside the rest
  const [s, digital, suggestions, query, next, ebookSuggestions] = await Promise.all([
    loadSeries(id),
    loadSeries(id).then((series) => catalogueAvailability(series?.works.map((work) => work.id) ?? [])),
    getSeriesSuggestions(id).catch(() => []),
    searchParams,
    getSeriesNextToRead(id).catch(() => null),
    getSeriesEbookSuggestionCount(id),
  ]);
  if (!s) notFound();

  const digitalCount = [...digital.values()].filter((value) => value.read).length;
  const books: (SeriesBook & { owned: boolean })[] = s.works.map((w) => {
    const poster = w.media?.find((m) => m.type === "poster" && m.isActive);
    return {
      id: w.id,
      ebook: digital.get(w.id)?.read ?? null,
      readerReturnTo: `/series/${id}`,
      slug: w.slug ?? w.id,
      title: w.title,
      authors: w.workAuthors.map((wa) => wa.author.name).join(" & "),
      position: w.seriesPosition,
      cover:
        poster?.thumbnailS3Key ??
        poster?.s3Key ??
        w.editions[0]?.thumbnailS3Key ??
        w.editions[0]?.coverS3Key ??
        null,
      coverCrop: poster ? mediaCrop(poster) : null,
      owned: w.owned,
      status:
        STATUS_CONFIG[w.catalogueStatus as CatalogueStatus]?.label ??
        w.catalogueStatus,
      statusVariant:
        STATUS_CONFIG[w.catalogueStatus as CatalogueStatus]?.variant ?? "muted",
      readingState: w.readingState,
      timesRead: w.timesRead,
      readingPercent: w.readingPercent,
    };
  });
  // The catalogue status, the same rule as the series list (SLN-635)
  const owned = books.filter((b) => b.owned).length;
  // Read: at least one finished reading, so a volume being re-read counts
  const read = books.filter((b) => (b.timesRead ?? 0) >= 1).length;
  const count = books.length;

  return (
    <>
      <CopyShortcuts name={s.title} />
      <Link
        href="/series"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to series
      </Link>

      <header className="mb-8 min-w-0">
        <DetailTitleRow title={s.title} controls="free">
          <DetailControls>
            <FavouriteToggle
              favourite={s.isFavourite}
              target={{ entity: "series", id: s.id }}
              name={s.title}
              shortcut
            />
            <SeriesActions
              series={{
                id: s.id,
                title: s.title,
                originalTitle: s.originalTitle,
                description: s.description,
                totalVolumes: s.totalVolumes,
                isComplete: s.isComplete,
              }}
              bookCount={count}
              initialAdd={query.add === "1"}
            />
          </DetailControls>
        </DetailTitleRow>
        {s.originalTitle && s.originalTitle !== s.title && (
          <p className="mt-1 text-sm italic text-fg-secondary">
            {s.originalTitle}
          </p>
        )}
        {/* Who wrote it, from its books' authors (SLN-636) */}
        {s.authors.length > 0 && (
          <p className="mt-2 text-sm text-fg-secondary [overflow-wrap:anywhere]" data-series-authors="">
            {s.authors.map((author, i) => (
              <Fragment key={author.id}>
                {i > 0 && ", "}
                {author.slug ? (
                  <Link
                    href={`/people/${author.slug}`}
                    className="transition-colors hover:text-accent-primary"
                  >
                    {author.name}
                  </Link>
                ) : (
                  author.name
                )}
              </Fragment>
            ))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="muted">
            {seriesBooksLabel(count, s.totalVolumes)}
          </Badge>
          {count > 0 && (
            <Badge variant="sage">
              {owned} of {seriesOutOf(count, s.totalVolumes)} owned
            </Badge>
          )}
          {read > 0 && (
            <Badge variant="blue">
              Read {read} of {seriesOutOf(count, s.totalVolumes)}
            </Badge>
          )}
          {digitalCount > 0 && <Badge variant="blue">{ebooksAvailableText(digitalCount)}</Badge>}
          {s.isComplete && <Badge variant="gold">Complete series</Badge>}
        </div>
        {/* The volume to read next and where its copy is (SLN-449) */}
        <EbookSuggestionLine seriesId={id} count={ebookSuggestions} />
        {next && read > 0 && (
          <p className="mt-3 text-sm text-fg-secondary" data-next-to-read="">
            Next to read:{" "}
            <Link href={`/library/${next.slug ?? next.id}`} className="text-fg-primary transition-colors hover:text-accent-primary">
              {next.position ? `${next.position}. ` : ""}
              {next.title}
            </Link>
            {` · ${next.whereabouts}`}
          </p>
        )}
        {s.description && (
          <Prose className="mt-4 whitespace-pre-wrap">{s.description}</Prose>
        )}
      </header>

      {/* Empty, one state with the page's one Add, as an empty collection (SLN-918) */}
      {count ? (
        <section className="mb-8">
          <SectionHeading title="Books" />
          <SeriesBooks seriesId={s.id} books={books} />
        </section>
      ) : (
        <EmptyState
          icon={Layers}
          heading="h2"
          title="No books in this series yet"
          description="Add its books to keep them in reading order, by their volume numbers."
          action={<AddSeriesBooksButton />}
        />
      )}

      {suggestions.length > 0 && (
        <section className="mb-8">
          <SectionHeading title="Suggested books" />
          <SeriesSuggestions suggestions={suggestions} />
        </section>
      )}
    </>
  );
}
