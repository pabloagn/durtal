import Image from "next/image";
import Link from "next/link";

interface AuthorListItemProps {
  id: string;
  slug: string;
  name: string;
  nationality?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  photoUrl?: string | null;
  worksCount: number;
}

export function AuthorListItem({
  slug,
  name,
  nationality,
  birthYear,
  deathYear,
  photoUrl,
  worksCount,
}: AuthorListItemProps) {
  const years = birthYear
    ? `${birthYear}–${deathYear ?? ""}`
    : null;

  return (
    <Link
      href={`/authors/${slug}`}
      className="group flex items-center gap-3 rounded-sm px-3 py-2 transition-colors hover:bg-bg-secondary"
    >
      {/* Small thumbnail */}
      <div className="relative h-10 w-7 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={name}
            fill
            sizes="28px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="font-serif text-nano text-fg-muted/40">
              {name[0]}
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-serif text-lg text-fg-primary group-hover:text-accent-rose">
          {name}
        </h3>
        <p className="truncate text-sm text-fg-secondary">
          {nationality ?? "Unknown nationality"}
        </p>
      </div>

      {/* Meta */}
      <div className="flex flex-shrink-0 items-center gap-3">
        {years && (
          <span className="font-mono text-micro text-fg-muted">{years}</span>
        )}
        <span className="w-14 text-right font-mono text-micro text-fg-muted">
          {worksCount} {worksCount === 1 ? "work" : "works"}
        </span>
      </div>
    </Link>
  );
}
