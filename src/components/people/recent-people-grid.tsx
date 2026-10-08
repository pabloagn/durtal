"use client";

import Link from "next/link";
import { CardHeading } from "@/components/shared/card-heading";
import { FadeImage } from "@/components/shared/fade-image";
import { CoverFan, Monogram } from "@/components/shared/no-photo";
import { PersonRoles } from "@/components/people/person-roles";
import { coverToneStyle } from "@/lib/utils/media-style";
import { displayYear } from "@/lib/utils/years";
import type { PersonRole } from "@/lib/catalogue/person-roles";
import { mediaUrl } from "@/lib/s3/media-url";

/**
 * The dashboard's recent people (moved from `src/app/page.tsx`, SLN-448): a
 * client component, so the page sends each card's few fields once instead of
 * its whole element tree. That keeps "/" within its 300 KB budget with the
 * reading tiles above it.
 */
export function RecentPeopleGrid({
  people,
  covers,
  roles,
}: {
  people: {
    id: string;
    slug: string | null;
    name: string;
    photoS3Key: string | null;
    photoTone: string | null;
    nationality: string | null;
    birthYear: number | null;
    deathYear: number | null;
    worksCount: number;
  }[];
  covers: Record<string, string[]>;
  roles: Record<string, PersonRole[]>;
}) {
  return (
    <div className="catalogue-grid">
      {people.map((author) => (
        <Link
          key={author.id}
          href={`/people/${author.slug ?? ""}`}
          className="catalogue-card group rounded-sm border border-glass-border bg-bg-secondary card-interactive"
        >
          {/* While the photo loads, the frame shows its main color */}
          <div
            className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary"
            style={coverToneStyle(author.photoTone)}
          >
            {author.photoS3Key ? (
              <FadeImage
                src={mediaUrl(author.photoS3Key)}
                alt={author.name}
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover group-hover:scale-[1.02]"
              />
            ) : covers[author.id]?.length ? (
              <CoverFan covers={covers[author.id]} />
            ) : (
              <Monogram name={author.name} />
            )}
          </div>
          <div className="card-body">
            {/* The author card's layout: two name lines, one
                nationality line, then years and the book count */}
            <CardHeading title={author.name} subtitle={author.nationality} />
            <PersonRoles roles={roles[author.id]} className="mt-1" />
            <div className="mt-2.5 flex min-h-5 flex-wrap items-center gap-2 font-mono text-micro text-fg-secondary">
              {author.birthYear && (
                <span>
                  {`${displayYear(author.birthYear)}–${author.deathYear ? displayYear(author.deathYear) : ""}`}
                </span>
              )}
              {author.worksCount > 0 && (
                <span className="ml-auto shrink-0">
                  {author.worksCount} {author.worksCount === 1 ? "book" : "books"}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
