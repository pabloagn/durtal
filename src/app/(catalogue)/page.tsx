import { Suspense, type ReactNode } from "react";
import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import { collectionCounts } from "@/lib/collections/counts";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { libraryStatsReads } from "@/lib/actions/utils/library-stats";
import {
  getCollectionCoverPreviews,
  getCollections,
} from "@/lib/actions/collections";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import {
  loadDomainCounts,
  loadRecentTiles,
  type HomeKind,
} from "@/lib/catalogue/domain-homes";
import { PageHeader } from "@/components/layout/page-header";
import { SkeletonBlock } from "@/components/shared/skeleton";
import { BookCard } from "@/components/books/book-card";
import { CollectionCard } from "@/components/collections/collection-card";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { DomainTileCard } from "@/components/domains/domain-tile";
import { mediaCrop } from "@/lib/utils/media-style";
import { getAuthorCoverPreviews, getPersonRoles } from "@/lib/actions/authors";
import { RecentPeopleGrid } from "@/components/people/recent-people-grid";
import { SectionHeading } from "@/components/shared/section-heading";
import { SectionRail } from "@/components/shared/section-rail";
import { finishedItem, tileItem } from "@/components/reading/hub-cards";
import { DashboardReading } from "@/components/reading/reading-tiles";
import { getOpenReadings } from "@/lib/actions/reading";
import { getRecentlyFinished } from "@/lib/reading/journal";
import { readingDayStartHour, readingToday } from "@/lib/reading/day";
import { getGoalProgress } from "@/lib/actions/reading-goals";
import { readingEstimates } from "@/lib/reading/estimates";
import { cardReadingOf } from "@/lib/reading/card";
import { mediaUrl } from "@/lib/s3/media-url";
import { appTimeZone } from "@/lib/utils/date";
import { PhonePairGrid } from "@/components/shared/phone-pair-grid";
import { DashboardStatistics, statisticsReads } from "@/components/statistics/dashboard-statistics";
import { Dateline } from "@/components/shared/dateline";
import { formatDateline } from "@/lib/utils/dateline";

// The root layout's title template skips a page in its own segment
export const metadata = { title: { absolute: "Dashboard | Durtal" } };

/*
 * The dashboard is the library's front page (SLN-741): what is being read,
 * what came in, the numbers, then what is curated, best loved and still
 * hunted. The counts sit in one index under the title instead of a block of
 * tiles per collection. Each section has a rule above it and a tick on the
 * section rail (SLN-740).
 */

/** One figure of the index; held while the dashboard loads */
function Figure({ label, value }: { label: string; value?: number }) {
  return (
    // The label is the term; the number shows above it
    <div className="flex min-w-0 flex-col-reverse justify-end">
      <dt className="text-xs text-fg-secondary [overflow-wrap:break-word]">{label}</dt>
      <dd>
        {value === undefined ? (
          <SkeletonBlock className="type-stat h-[1lh] w-12" />
        ) : (
          <span className="type-stat block tabular-nums text-fg-primary">{value.toLocaleString()}</span>
        )}
      </dd>
    </div>
  );
}

const CREATOR_LABELS: Record<HomeKind, string> = {
  perfume: "Perfumers",
  film: "Directors",
  painting: "Painters",
};

interface IndexCounts {
  books?: { works: number; editions: number; instances: number; authors: number };
  others?: Partial<Record<HomeKind, { records: number; creators: number }>>;
}

/**
 * The library's index: each open collection's name, linked to its home, over
 * its figures. Books take two columns: they have four figures.
 */
function LibraryIndex({ books, others }: IndexCounts) {
  const kinds = getEnabledWorkKinds().filter((kind): kind is HomeKind => kind !== "book");
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-glass-border pt-6 min-[375px]:grid-cols-2 xl:grid-cols-[repeat(var(--index-columns),minmax(0,1fr))]" style={{ "--index-columns": 2 + kinds.length } as React.CSSProperties} data-dashboard-index="">
      <IndexGroup kind="book" wide>
        <Figure label="Books" value={books?.works} />
        <Figure label="Editions" value={books?.editions} />
        {/* Named as on Statistics and Settings, and the authors of books as
            the other collections name their creators (SLN-886) */}
        <Figure label="Copies" value={books?.instances} />
        <Figure label="Authors" value={books?.authors} />
      </IndexGroup>
      {kinds.map((kind) => (
        <IndexGroup key={kind} kind={kind}>
          <Figure label={WORK_DOMAINS[kind].pluralLabel} value={others?.[kind]?.records} />
          <Figure label={CREATOR_LABELS[kind]} value={others?.[kind]?.creators} />
        </IndexGroup>
      ))}
    </div>
  );
}

function IndexGroup({ kind, wide = false, children }: { kind: keyof typeof WORK_DOMAINS; wide?: boolean; children: ReactNode }) {
  const domain = WORK_DOMAINS[kind];
  return (
    <section aria-label={domain.pluralLabel} className={wide ? "col-span-full xl:col-span-2" : ""}>
      <Link href={domain.basePath} className="type-caption inline-flex items-center gap-1 transition-colors hover:text-fg-primary touch-hit">
        {domain.pluralLabel}
        <ArrowRight className="h-3 w-3" strokeWidth={1.5} aria-hidden />
      </Link>
      <dl className={`mt-2 grid gap-4 ${wide ? "grid-cols-2 min-[375px]:grid-cols-4" : "grid-cols-2"}`}>{children}</dl>
    </section>
  );
}

/** A section of the front page: a rule, its title with "View all", then its content */
function DashboardSection({ id, title, href, children }: { id: string; title: string; href?: string; children: ReactNode }) {
  return (
    // Focus lands here after a jump from the rail; the heading names it
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className="mt-12 scroll-mt-16 border-t border-glass-border pt-8 outline-none md:scroll-mt-6">
      <SectionHeading
        id={`${id}-title`}
        title={title}
        action={
          href && (
            <Link
              href={href}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
            >
              View all
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          )
        }
      />
      {children}
    </section>
  );
}

function workToCardProps(work: {
  id: string;
  slug: string | null;
  title: string;
  rating: number | null;
  catalogueStatus: string;
  acquisitionPriority: string;
  isRare: boolean;
  huntAssessedOn: string | null;
  isPoison: boolean;
  originalYear: number | null;
  readingState?: string | null;
  readingPercent?: number | null;
  workAuthors: Array<{ author: { name: string } }>;
  editions: Array<{
    id: string;
    thumbnailS3Key: string | null;
    publicationYear: number | null;
    language: string | null;
    updatedAt: Date;
    instances: Array<{ id: string }>;
  }>;
  media?: Array<{
    s3Key: string;
    thumbnailS3Key: string | null;
    type: string;
    isActive: boolean;
    cropX: number;
    cropY: number;
    cropZoom: number;
    brightness: number;
    contrast: number;
    createdAt: Date;
    tone?: string | null;
  }>;
}) {
  const edition = work.editions[0];
  const author = work.workAuthors[0]?.author;
  const instanceCount = work.editions.reduce(
    (acc, e) => acc + (e.instances?.length ?? 0),
    0,
  );

  // Prefer active poster from media table, fall back to edition cover
  const activePoster = work.media?.find(
    (m) => m.type === "poster" && m.isActive,
  );
  const coverS3Key =
    activePoster?.thumbnailS3Key ??
    activePoster?.s3Key ??
    edition?.thumbnailS3Key;
  // Versioned as the library's card is, so both share one cached image
  const coverVersion = activePoster ? activePoster.createdAt : edition?.updatedAt;

  return {
    workId: work.id,
    slug: work.slug ?? "",
    title: work.title,
    authorName: author?.name ?? "Unknown",
    coverUrl: coverS3Key
      ? mediaUrl(coverS3Key, { version: coverVersion })
      : null,
    coverCrop: activePoster
      ? mediaCrop(activePoster)
      : null,
    coverTone: activePoster?.tone ?? null,
    publicationYear: edition?.publicationYear ?? work.originalYear,
    language: edition?.language,
    instanceCount,
    rating: work.rating,
    catalogueStatus: work.catalogueStatus,
    acquisitionPriority: work.acquisitionPriority,
    isRare: work.isRare,
    huntAssessedOn: work.huntAssessedOn,
    isPoison: work.isPoison,
    reading: cardReadingOf(work),
  };
}

/**
 * Cards a shelf takes: two full rows at five columns (a 1440px window), and
 * full rows at two; at three or four columns the last row's spares are left
 * out (PhonePairGrid)
 */
const SHELF = 10;

/** The other open collections: counts, newest records. Books come from getLibraryStats. */
async function otherDomains() {
  const kinds = getEnabledWorkKinds().filter(
    (kind): kind is HomeKind => kind !== "book",
  );
  return Promise.all(
    kinds.map(async (kind) => {
      const [counts, recent] = await Promise.all([loadDomainCounts(kind), loadRecentTiles(kind, SHELF)]);
      return { kind, counts, recent };
    }),
  );
}

async function DashboardContent() {
  // Each read starts once what it needs is in, not when every read above is:
  // two round trips in all, Statistics' own reads among them (SLN-795)
  const statistics = statisticsReads();
  const { library: statsRead, wantedIds, wanted } = libraryStatsReads({ shelf: SHELF });
  const collectionsRead = getCollections({ limit: 4, offset: 0 });
  // Books being read before paused ones; three at most
  const currentRead = getOpenReadings().then((open) =>
    [...open]
      .sort((a, b) => Number(a.reading.status === "paused") - Number(b.reading.status === "paused"))
      .slice(0, 3),
  );
  const [library, wantedWorks, others, collections, currentReads, finishedReads, digital, covers, authorCovers, personRoles, estimates, goal] =
    await Promise.all([
      statsRead,
      wanted,
      otherDomains(),
      collectionsRead,
      currentRead,
      getRecentlyFinished(4),
      // The wanted shelf's from its ids, so this need not wait for its cards
      Promise.all([statsRead, wantedIds]).then(([s, ids]) => catalogueAvailability([...s.recentWorks.map((work) => work.id), ...s.topRatedWorks.map((work) => work.id), ...ids])),
      collectionsRead.then((shelf) => getCollectionCoverPreviews(shelf.map((collection) => collection.id))),
      // Recent authors with no portrait show some of their book covers
      statsRead.then((s) => getAuthorCoverPreviews(s.recentAuthors.filter((a) => !a.photoS3Key).map((a) => a.id))),
      // Every card's roles, in one query
      statsRead.then((s) => getPersonRoles(s.recentAuthors.map((a) => a.id))),
      // Time left and the finish date of the reading tiles (SLN-451)
      Promise.all([readingToday(), currentRead]).then(([today, reads]) => readingEstimates(reads.map((o) => o.reading.id), today)),
      // This year's first goal, for one line under the tiles (SLN-455)
      Promise.all([readingToday(), readingDayStartHour()]).then(async ([today, dayStartHour]) => {
        const [progress] = await getGoalProgress(Number(today.slice(0, 4)));
        return progress ? { progress, serverToday: today, dayStartHour } : null;
      }),
    ]);
  const stats = { ...library, wantedWorks };
  // Newest first across the open collections
  const recent = [
    ...stats.recentWorks.map((work) => ({
      key: work.id,
      createdAt: work.createdAt,
      card: <BookCard key={work.id} {...workToCardProps(work)} ebook={digital.get(work.id)?.read ?? null} readerReturnTo="/" />,
    })),
    ...others.flatMap(({ kind, recent: tiles }) =>
      tiles.map((tile) => ({
        key: tile.id,
        createdAt: tile.createdAt,
        card: <DomainTileCard key={tile.id} kind={kind} tile={tile} />,
      })),
    ),
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, SHELF);
  const singleDomain = others.length === 0;
  const book = (work: Parameters<typeof workToCardProps>[0]) => (
    <BookCard key={work.id} {...workToCardProps(work)} ebook={digital.get(work.id)?.read ?? null} readerReturnTo="/" />
  );

  // The front page's order. A section with nothing to show is left out, and
  // the rail lists only the sections the page draws
  const sections: { id: string; title: string; href?: string; content: ReactNode }[] = [];
  if (currentReads.length > 0 || finishedReads.length > 0 || goal) {
    sections.push({
      id: "reading",
      title: "Reading",
      href: "/reading",
      content: <DashboardReading tiles={currentReads.map((o) => tileItem(o, estimates[o.reading.id]))} finished={finishedReads.map(finishedItem)} goal={goal} />,
    });
  }
  if (recent.length > 0) {
    sections.push({
      id: "recent",
      title: "Recent additions",
      href: singleDomain ? "/library?sort=recent" : undefined,
      content: <PhonePairGrid>{recent.map((item) => item.card)}</PhonePairGrid>,
    });
  }
  // The numbers, between what is new and what is curated (SLN-742); the body loads on its own
  sections.push({ id: "statistics", title: "Statistics", href: "/statistics", content: <DashboardStatistics reads={statistics} /> });
  if (collections.length > 0) {
    sections.push({
      id: "collections",
      title: "Collections",
      href: "/collections",
      content: (
        <PhonePairGrid>
          {collections.map((collection) => (
            <CollectionCard
              key={collection.id}
              collection={{ ...collection, ...collectionCounts(collection) }}
              covers={covers
                .filter((preview) => preview.collectionId === collection.id)
                .map((preview) => preview.s3Key)}
            />
          ))}
        </PhonePairGrid>
      ),
    });
  }
  if (stats.topRatedWorks.length > 0) {
    sections.push({
      id: "highest-rated",
      title: "Highest rated",
      href: "/library?sort=rating",
      content: <PhonePairGrid>{stats.topRatedWorks.map(book)}</PhonePairGrid>,
    });
  }
  if (stats.wantedWorks.length > 0) {
    sections.push({
      id: "wanted",
      title: "Wanted",
      href: "/library?status=wanted,shortlisted",
      content: <PhonePairGrid>{stats.wantedWorks.map(book)}</PhonePairGrid>,
    });
  }
  if (stats.recentAuthors.length > 0) {
    sections.push({
      id: "people",
      title: "Recent people",
      href: "/people?sort=recent",
      content: (
        <RecentPeopleGrid
          people={stats.recentAuthors}
          covers={Object.fromEntries(stats.recentAuthors.filter((a) => authorCovers[a.id]?.length).map((a) => [a.id, authorCovers[a.id]]))}
          roles={personRoles}
        />
      ),
    });
  }

  return (
    <>
      <LibraryIndex
        books={stats}
        others={Object.fromEntries(others.map(({ kind, counts }) => [kind, counts]))}
      />
      {sections.map(({ id, title, href, content }) => (
        <DashboardSection key={id} id={id} title={title} href={href}>
          {content}
        </DashboardSection>
      ))}
      <SectionRail label="Dashboard sections" sections={sections.map(({ id, title }) => ({ id, label: title }))} />
    </>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={<Dateline initial={formatDateline(new Date(), appTimeZone())} />}
        actions={
          // No Import: importing books is not built yet (SLN-832)
          <DomainAddLink kind="book" size="md" />
        }
      />
      <Suspense
        fallback={
          // The index with its figures held; the sections arrive with it
          <div role="status" aria-label="Loading the dashboard">
            <LibraryIndex />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </>
  );
}
