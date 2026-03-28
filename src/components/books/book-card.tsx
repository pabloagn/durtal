import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { CatalogueStatus } from "@/lib/types";

const STATUS_CONFIG: Record<CatalogueStatus, { label: string; variant: "muted" | "blue" | "gold" | "rose" | "sage" | "red" }> = {
  tracked: { label: "Tracked", variant: "muted" },
  shortlisted: { label: "Shortlisted", variant: "blue" },
  wanted: { label: "Wanted", variant: "gold" },
  on_order: { label: "On Order", variant: "rose" },
  accessioned: { label: "Accessioned", variant: "sage" },
  deaccessioned: { label: "Deaccessioned", variant: "red" },
};

interface BookCardProps {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
}

export function BookCard({
  slug,
  title,
  authorName,
  coverUrl,
  publicationYear,
  language,
  instanceCount,
  rating,
  catalogueStatus,
}: BookCardProps) {
  const statusInfo = catalogueStatus
    ? STATUS_CONFIG[catalogueStatus as CatalogueStatus]
    : null;

  return (
    <Link
      href={`/library/${slug}`}
      className="group block rounded-sm border border-glass-border bg-bg-secondary card-interactive"
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] overflow-hidden bg-bg-primary">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={title}
            fill
            sizes="(min-width: 1280px) 200px, (min-width: 768px) 180px, 160px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-serif text-3xl text-fg-muted/30">{title[0]}</span>
          </div>
        )}

        {/* Status badge — top-left, always visible */}
        {statusInfo && (
          <div className="absolute left-2 top-2">
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
          </div>
        )}

        {/* Rating overlay */}
        {rating && (
          <div className="absolute right-2 top-2">
            <Badge variant="gold">{rating}/5</Badge>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="p-3.5">
        <h3 className="line-clamp-2 font-serif text-lg leading-snug text-fg-primary">
          {title}
        </h3>
        <p className="mt-1 line-clamp-1 text-sm text-fg-secondary">
          {authorName}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          {publicationYear && (
            <span className="font-mono text-micro text-fg-muted">
              {publicationYear}
            </span>
          )}
          {language && language !== "en" && (
            <Badge variant="blue">{language}</Badge>
          )}
          <span className="ml-auto font-mono text-micro text-fg-muted">
            {instanceCount} {instanceCount === 1 ? "copy" : "copies"}
          </span>
        </div>
      </div>
    </Link>
  );
}
