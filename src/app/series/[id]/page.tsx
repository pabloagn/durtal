import type { Metadata } from "next";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Layers } from "lucide-react";
import { getSeriesDetail, getSeriesSuggestions } from "@/lib/actions/series";
import { getSeriesNextToRead } from "@/lib/actions/reading";
import { Badge } from "@/components/ui/badge";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { SeriesActions } from "@/components/series/series-actions";
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
  const [s, suggestions, query, next] = await Promise.all([
    loadSeries(id),
    getSeriesSuggestions(id).catch(() => []),
    searchParams,
    getSeriesNextToRead(id).catch(() => null),
  ]);
  if (!s) notFound();

  const books: SeriesBook[] = s.works.map((w) => {
    const poster = w.media?.find((m) => m.type === "poster" && m.isActive);
    return {
      id: w.id,
      slug: w.slug ?? w.id,
      title: w.title,
      authors: w.workAuthors.map((wa) => wa.author.name).join(" & "),
      position: w.seriesPosition,
      cover:
        poster?.thumbnailS3Key ??
        poster?.s3Key ??
        w.editions[0]?.thumbnailS3Key ??
        null,
      coverCrop: poster ? mediaCrop(poster) : null,
      owned: w.editions.some((e) =>
        e.instances.some((i) => i.status !== "deaccessioned"),
      ),
      status:
        STATUS_CONFIG[w.catalogueStatus as CatalogueStatus]?.label ??
        w.catalogueStatus,
      readingState: w.readingState,
      timesRead: w.timesRead,
      readingPercent: w.readingPercent,
    };
  });
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

      <header className="mb-8 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="type-page-title break-words">
            {s.title}
          </h1>
          {s.originalTitle && s.originalTitle !== s.title && (
            <p className="mt-1 text-sm italic text-fg-secondary">
              {s.originalTitle}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="muted">
              {count} {count === 1 ? "book" : "books"}
              {s.totalVolumes ? ` of ${s.totalVolumes}` : ""}
            </Badge>
            {count > 0 && (
              <Badge variant="sage">
                {owned} of {s.totalVolumes ?? count} owned
              </Badge>
            )}
            {read > 0 && (
              <Badge variant="blue">
                Read {read} of {s.totalVolumes ?? count}
              </Badge>
            )}
            {s.isComplete && <Badge variant="gold">Complete series</Badge>}
          </div>
          {/* The volume to read next and where its copy is (SLN-449) */}
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
        </div>
        {/* On the cap-height center of the title's first line */}
        <CapAlignedControls height={32} coarseHeight={44} className="type-page-title">
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
        </CapAlignedControls>
      </header>

      <section className="mb-8">
        <SectionHeading title="Books" />
        {count ? (
          <SeriesBooks seriesId={s.id} books={books} />
        ) : (
          <div className="rounded-sm border border-dashed border-glass-border px-6 py-12 text-center">
            <Layers
              className="mx-auto mb-3 text-fg-muted"
              size={24}
              strokeWidth={1}
            />
            <p className="text-sm text-fg-secondary">
              No books yet. Use Add books, or pick this series in a book&apos;s
              Edit dialog.
            </p>
          </div>
        )}
      </section>

      {suggestions.length > 0 && (
        <section className="mb-8">
          <SectionHeading title="Suggested books" />
          <SeriesSuggestions suggestions={suggestions} />
        </section>
      )}
    </>
  );
}
