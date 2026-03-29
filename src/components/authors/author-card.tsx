import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

interface AuthorCardProps {
  id: string;
  slug: string;
  name: string;
  nationality?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  photoUrl?: string | null;
  worksCount: number;
}

export function AuthorCard({
  slug,
  name,
  nationality,
  birthYear,
  deathYear,
  photoUrl,
  worksCount,
}: AuthorCardProps) {
  const years = birthYear
    ? `${birthYear}–${deathYear ?? ""}`
    : null;

  return (
    <Link
      href={`/authors/${slug}`}
      className="group block rounded-sm border border-glass-border bg-bg-secondary card-interactive"
    >
      {/* Photo */}
      <div className="relative aspect-[2/3] overflow-hidden bg-bg-primary">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={name}
            fill
            sizes="(min-width: 1280px) 200px, (min-width: 768px) 180px, 160px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-serif text-3xl text-fg-muted/30">
              {name[0]}
            </span>
          </div>
        )}

        {/* Works count overlay */}
        {worksCount > 0 && (
          <div className="absolute right-2 top-2">
            <Badge variant="muted">
              {worksCount} {worksCount === 1 ? "work" : "works"}
            </Badge>
          </div>
        )}
      </div>

      {/* Meta */}
      <div className="p-3.5">
        <h3 className="line-clamp-2 font-serif text-lg leading-snug text-fg-primary">
          {name}
        </h3>
        {nationality && (
          <p className="mt-1 line-clamp-1 text-sm text-fg-secondary">
            {nationality}
          </p>
        )}
        <div className="mt-2.5 flex items-center gap-2">
          {years && (
            <span className="font-mono text-micro text-fg-muted">{years}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
