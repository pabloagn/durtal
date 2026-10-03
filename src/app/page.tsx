import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BookOpen,
  Layers,
  Copy,
  Users,
  Upload,
  ArrowRight,
  Star,
  ShoppingCart,
  FolderOpen,
} from "lucide-react";
import { getLibraryStats } from "@/lib/actions/works";
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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BookCard } from "@/components/books/book-card";
import { CollectionCard } from "@/components/collections/collection-card";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { DomainTileCard } from "@/components/domains/domain-tile";
import { DOMAIN_ICONS } from "@/components/shortcuts/section-icons";
import { STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { CatalogueStatus } from "@/lib/types";
import { mediaCrop } from "@/lib/utils/media-style";
import { SectionHeading } from "@/components/shared/section-heading";

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <Card glass>
      <CardContent className="flex items-center gap-4 py-5">
        {/* Decoration only: on a phone the count and its label need the room */}
        <div className="hidden rounded-sm border border-glass-border bg-bg-primary/50 p-2.5 sm:block">
          <Icon className="h-5 w-5 text-fg-muted" strokeWidth={1.5} />
        </div>
        <div>
          <p className="type-stat text-fg-primary">
            {value.toLocaleString()}
          </p>
          <p className="text-xs text-fg-secondary">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  title,
  href,
  icon: Icon,
}: {
  title: string;
  href?: string;
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}) {
  return (
    <SectionHeading
      title={title}
      icon={Icon}
      action={
        href && (
          <Link
            href={href}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            View all
            <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
          </Link>
        )
      }
    />
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
  workAuthors: Array<{ author: { name: string } }>;
  editions: Array<{
    id: string;
    thumbnailS3Key: string | null;
    publicationYear: number | null;
    language: string | null;
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

  return {
    workId: work.id,
    slug: work.slug ?? "",
    title: work.title,
    authorName: author?.name ?? "Unknown",
    coverUrl: coverS3Key
      ? `/api/s3/read?key=${encodeURIComponent(coverS3Key)}`
      : null,
    coverCrop: activePoster
      ? mediaCrop(activePoster)
      : null,
    publicationYear: edition?.publicationYear ?? work.originalYear,
    language: edition?.language,
    instanceCount,
    rating: work.rating,
    catalogueStatus: work.catalogueStatus,
    acquisitionPriority: work.acquisitionPriority,
    isRare: work.isRare,
    huntAssessedOn: work.huntAssessedOn,
    isPoison: work.isPoison,
  };
}

/** The other open collections: counts, newest records. Books come from getLibraryStats. */
async function otherDomains() {
  const kinds = getEnabledWorkKinds().filter(
    (kind): kind is HomeKind => kind !== "book",
  );
  return Promise.all(
    kinds.map(async (kind) => ({
      kind,
      counts: await loadDomainCounts(kind),
      recent: await loadRecentTiles(kind, 8),
    })),
  );
}

const CREATOR_LABELS: Record<HomeKind, string> = {
  perfume: "Perfumers",
  film: "Directors",
  painting: "Painters",
};

async function DashboardContent() {
  const [stats, others, collections] = await Promise.all([
    getLibraryStats(),
    otherDomains(),
    getCollections({ limit: 4, offset: 0 }),
  ]);
  const covers = await getCollectionCoverPreviews(
    collections.map((collection) => collection.id),
  );
  // Newest first across the open collections
  const recent = [
    ...stats.recentWorks.map((work) => ({
      key: work.id,
      createdAt: work.createdAt,
      card: <BookCard key={work.id} {...workToCardProps(work)} />,
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
    .slice(0, 8);
  const singleDomain = others.length === 0;

  return (
    <>
      {/* Books: counts and the book actions */}
      <section>
        <SectionHeader
          title={WORK_DOMAINS.book.pluralLabel}
          icon={DOMAIN_ICONS.book}
          href={WORK_DOMAINS.book.basePath}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Books" value={stats.works} icon={BookOpen} />
          <StatCard label="Editions" value={stats.editions} icon={Layers} />
          <StatCard label="Instances" value={stats.instances} icon={Copy} />
          <StatCard label="Authors" value={stats.authors} icon={Users} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <DomainAddLink kind="book" />
          <Link
            href="/library/import"
            className={`${buttonClass("secondary", "md")} whitespace-nowrap`}
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            Import books
          </Link>
        </div>
      </section>

      {/* Each other open collection: its counts and its add action */}
      {others.map(({ kind, counts }) => (
        <section key={kind} className="mt-12">
          <SectionHeader
            title={WORK_DOMAINS[kind].pluralLabel}
            icon={DOMAIN_ICONS[kind]}
            href={WORK_DOMAINS[kind].basePath}
          />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={WORK_DOMAINS[kind].pluralLabel}
              value={counts.records}
              icon={DOMAIN_ICONS[kind]}
            />
            <StatCard
              label={CREATOR_LABELS[kind]}
              value={counts.creators}
              icon={Users}
            />
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <DomainAddLink kind={kind} />
          </div>
        </section>
      ))}

      {/* Recent additions, newest first across the open collections */}
      {recent.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Recent additions"
            icon={BookOpen}
            href={singleDomain ? "/library?sort=recent" : undefined}
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {recent.map((item) => item.card)}
          </div>
        </section>
      )}

      {/* Collections: the first ones in their curated order */}
      {collections.length > 0 && (
        <section className="mt-12">
          <SectionHeader title="Collections" icon={FolderOpen} href="/collections" />
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4">
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={{
                  ...collection,
                  editionCount: collection.collectionEditions?.length ?? 0,
                }}
                covers={covers
                  .filter((preview) => preview.collectionId === collection.id)
                  .map((preview) => preview.s3Key)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Highest rated books */}
      {stats.topRatedWorks.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Highest rated"
            icon={Star}
            href="/library?sort=rating"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {stats.topRatedWorks.map((work) => (
              <BookCard key={work.id} {...workToCardProps(work)} />
            ))}
          </div>
        </section>
      )}

      {/* Recent authors */}
      {stats.recentAuthors.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Recent authors"
            icon={Users}
            href="/authors?sort=recent"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {stats.recentAuthors.map((author) => (
              <Link
                key={author.id}
                href={`/authors/${author.slug ?? ""}`}
                className="group rounded-sm border border-glass-border bg-bg-secondary card-interactive"
              >
                <div className="relative aspect-[2/3] overflow-hidden bg-bg-primary">
                  {author.photoS3Key ? (
                    <Image
                      src={`/api/s3/read?key=${encodeURIComponent(author.photoS3Key)}`}
                      alt={author.name}
                      fill
                      sizes="(min-width: 1280px) 180px, (min-width: 768px) 150px, 140px"
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    unoptimized
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <span className="font-serif text-3xl text-fg-muted/30">
                        {author.name[0]}
                      </span>
                    </div>
                  )}
                  {author.worksCount > 0 && (
                    <div className="absolute right-1.5 top-1.5">
                      <Badge variant="muted">
                        {author.worksCount} {author.worksCount === 1 ? "book" : "books"}
                      </Badge>
                    </div>
                  )}
                </div>
                <div className="p-3">
                  {/* Fixed lines: every author card has the same height */}
                  <h3 className="type-item-title lines-2">
                    {author.name}
                  </h3>
                  <p className="mt-1 lines-1 text-sm text-fg-secondary">
                    {author.nationality}
                  </p>
                  <p className="mt-1.5 lines-1 font-mono text-micro text-fg-secondary">
                    {author.birthYear
                      ? `${author.birthYear}–${author.deathYear ?? ""}`
                      : null}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Wanted / shortlisted */}
      {stats.wantedWorks.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Wanted"
            icon={ShoppingCart}
            href="/library?status=wanted,shortlisted"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {stats.wantedWorks.map((work) => {
              const edition = work.editions[0];
              const author = work.workAuthors[0]?.author;
              const statusInfo =
                STATUS_CONFIG[work.catalogueStatus as CatalogueStatus];
              return (
                <Link
                  key={work.id}
                  href={`/library/${work.slug ?? ""}`}
                  className="group rounded-sm border border-glass-border bg-bg-secondary p-4 card-interactive"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="type-item-title lines-2">
                      {work.title}
                    </h3>
                    {statusInfo && (
                      <Badge variant={statusInfo.variant} className="shrink-0">
                        {statusInfo.label}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1.5 lines-1 text-sm text-fg-secondary">
                    {author?.name}
                  </p>
                  <div className="mt-3 flex h-5 items-center gap-2">
                    {edition?.publicationYear && (
                      <span className="font-mono text-micro text-fg-secondary">
                        {edition.publicationYear}
                      </span>
                    )}
                    {edition?.language && edition.language !== "en" && (
                      <Badge variant="blue">{edition.language}</Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your library at a glance"
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <DashboardContent />
      </Suspense>
    </>
  );
}
