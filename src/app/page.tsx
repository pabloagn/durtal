import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  BookOpen,
  Layers,
  Copy,
  Users,
  Plus,
  Upload,
  ArrowRight,
  Star,
  ShoppingCart,
} from "lucide-react";
import { getLibraryStats } from "@/lib/actions/works";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BookCard } from "@/components/books/book-card";
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
        <div className="rounded-sm border border-glass-border bg-bg-primary/50 p-2.5">
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
            className="flex items-center gap-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
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

async function DashboardContent() {
  const stats = await getLibraryStats();

  return (
    <>
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Works" value={stats.works} icon={BookOpen} />
        <StatCard label="Editions" value={stats.editions} icon={Layers} />
        <StatCard label="Instances" value={stats.instances} icon={Copy} />
        <StatCard label="Authors" value={stats.authors} icon={Users} />
      </div>

      {/* Quick actions */}
      <div className="mt-8 flex items-center gap-3">
        <Link href="/library/new">
          <Button variant="primary" size="md">
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
            Add book
          </Button>
        </Link>
        <Link href="/library/import">
          <Button variant="secondary" size="md">
            <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
            Import
          </Button>
        </Link>
      </div>

      {/* Favourite books (top rated) */}
      {stats.topRatedWorks.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Favourites"
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

      {/* Recent additions */}
      {stats.recentWorks.length > 0 && (
        <section className="mt-12">
          <SectionHeader
            title="Recent additions"
            icon={BookOpen}
            href="/library?sort=recent"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {stats.recentWorks.map((work) => (
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
                        {author.worksCount} {author.worksCount === 1 ? "work" : "works"}
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
