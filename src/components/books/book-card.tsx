import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface BookCardProps {
  workId: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
}

export function BookCard({
  workId,
  title,
  authorName,
  coverUrl,
  publicationYear,
  language,
  instanceCount,
  rating,
}: BookCardProps) {
  return (
    <Link
      href={`/library/${workId}`}
      className="group block rounded-sm border border-bg-tertiary bg-bg-secondary transition-all hover:border-fg-muted/30 hover:shadow-lg hover:shadow-accent-rose/5"
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
            <span className="font-serif text-lg text-fg-muted/40">{title[0]}</span>
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
      <div className="p-3">
        <h3 className="line-clamp-2 font-serif text-sm leading-tight text-fg-primary">
          {title}
        </h3>
        <p className="mt-1 line-clamp-1 text-xs text-fg-secondary">
          {authorName}
        </p>
        <div className="mt-2 flex items-center gap-2">
          {publicationYear && (
            <span className="font-mono text-[10px] text-fg-muted">
              {publicationYear}
            </span>
          )}
          {language && language !== "en" && (
            <Badge variant="blue">{language}</Badge>
          )}
          <span className="ml-auto font-mono text-[10px] text-fg-muted">
            {instanceCount} {instanceCount === 1 ? "copy" : "copies"}
          </span>
        </div>
      </div>
    </Link>
  );
}
