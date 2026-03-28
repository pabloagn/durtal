export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getAuthor } from "@/lib/actions/authors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AuthorMediaSection } from "./author-media-section";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AuthorDetailPage({ params }: PageProps) {
  const { id } = await params;
  const author = await getAuthor(id);

  if (!author) notFound();

  const works = author.workAuthors.map((wa) => ({
    ...wa.work,
    role: wa.role,
  }));

  const contributions = author.editionContributors.map((ec) => ({
    ...ec.edition,
    role: ec.role,
  }));

  const poster = author.media?.find((m) => m.type === "poster");
  const background = author.media?.find((m) => m.type === "background");
  const galleryMedia = author.media?.filter((m) => m.type === "gallery") ?? [];

  return (
    <>
      <Link
        href="/authors"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to authors
      </Link>

      {/* Header with optional poster */}
      <div className="mb-8 flex gap-6">
        {poster && (
          <div className="relative h-48 w-36 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            <img
              src={`/api/s3/read?key=${encodeURIComponent(poster.s3Key)}`}
              alt={`${author.name} portrait`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl tracking-tight text-fg-primary">
            {author.name}
          </h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-fg-secondary">
            {author.nationality && <span>{author.nationality}</span>}
            {author.birthYear && (
              <span className="font-mono text-xs text-fg-muted">
                {author.birthYear}–{author.deathYear ?? ""}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {author.bio && (
        <section className="mb-8">
          <p className="max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {author.bio}
          </p>
        </section>
      )}

      {/* Media upload and gallery */}
      <AuthorMediaSection
        authorId={author.id}
        gallery={galleryMedia}
        hasPoster={!!poster}
        hasBackground={!!background}
      />

      {/* Works as author */}
      {works.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 font-serif text-lg text-fg-primary">
            Works ({works.length})
          </h2>
          <div className="space-y-2">
            {works.map((work) => (
              <Link key={work.id} href={`/library/${work.id}`}>
                <Card hover>
                  <CardContent className="flex items-center justify-between py-2.5">
                    <div>
                      <span className="font-serif text-sm text-fg-primary">
                        {work.title}
                      </span>
                      {work.originalYear && (
                        <span className="ml-2 font-mono text-xs text-fg-muted">
                          {work.originalYear}
                        </span>
                      )}
                    </div>
                    <Badge variant="muted">{work.role}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Edition contributions */}
      {contributions.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-4 font-serif text-lg text-fg-primary">
            Edition contributions ({contributions.length})
          </h2>
          <div className="space-y-2">
            {contributions.map((edition) => (
              <Card key={`${edition.id}-${edition.role}`}>
                <CardContent className="flex items-center justify-between py-2.5">
                  <div>
                    <span className="font-serif text-sm text-fg-primary">
                      {edition.title}
                    </span>
                    {edition.publicationYear && (
                      <span className="ml-2 font-mono text-xs text-fg-muted">
                        {edition.publicationYear}
                      </span>
                    )}
                  </div>
                  <Badge variant="blue">{edition.role}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* External links */}
      {(author.website || author.openLibraryKey || author.goodreadsId) && (
        <section className="mb-8">
          <h2 className="mb-2 font-serif text-sm text-fg-secondary">
            External links
          </h2>
          <div className="flex gap-3">
            {author.website && (
              <a
                href={author.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-rose hover:underline"
              >
                Website
              </a>
            )}
            {author.openLibraryKey && (
              <a
                href={`https://openlibrary.org${author.openLibraryKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-accent-rose hover:underline"
              >
                Open Library
              </a>
            )}
          </div>
        </section>
      )}
    </>
  );
}
