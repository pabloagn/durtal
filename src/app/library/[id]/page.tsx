export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star } from "lucide-react";
import { getWork } from "@/lib/actions/works";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { WorkMediaSection } from "./work-media-section";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function WorkDetailPage({ params }: PageProps) {
  const { id } = await params;
  const work = await getWork(id);

  if (!work) notFound();

  const primaryAuthors = work.workAuthors.map((wa) => wa.author);
  const subjects = work.workSubjects.map((ws) => ws.subject);
  const poster = work.media?.find((m) => m.type === "poster");
  const background = work.media?.find((m) => m.type === "background");
  const galleryMedia = work.media?.filter((m) => m.type === "gallery") ?? [];

  return (
    <>
      {/* Back link */}
      <Link
        href="/library"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to library
      </Link>

      {/* Header with optional poster */}
      <div className="mb-8 flex gap-6">
        {/* Poster */}
        {poster && (
          <div className="relative h-48 w-32 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            <img
              src={`/api/s3/read?key=${encodeURIComponent(poster.s3Key)}`}
              alt={`${work.title} poster`}
              className="h-full w-full object-cover"
            />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="font-serif text-3xl tracking-tight text-fg-primary">
            {work.title}
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <p className="text-sm text-fg-secondary">
              {primaryAuthors.map((a) => a.name).join(", ")}
            </p>
            {work.originalYear && (
              <span className="font-mono text-xs text-fg-muted">
                {work.originalYear}
              </span>
            )}
            {work.rating && (
              <div className="flex items-center gap-1">
                <Star
                  className="h-3 w-3 text-accent-gold"
                  strokeWidth={1.5}
                  fill="currentColor"
                />
                <span className="font-mono text-xs text-accent-gold">
                  {work.rating}/5
                </span>
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge variant="muted">{work.originalLanguage}</Badge>
            {work.isAnthology && <Badge variant="blue">Anthology</Badge>}
            <Badge
              variant={
                work.catalogueStatus === "accessioned"
                  ? "sage"
                  : work.catalogueStatus === "wanted" || work.catalogueStatus === "shortlisted"
                    ? "gold"
                    : work.catalogueStatus === "deaccessioned"
                      ? "red"
                      : work.catalogueStatus === "on_order"
                        ? "blue"
                        : "muted"
              }
            >
              {work.catalogueStatus}
            </Badge>
          </div>
        </div>
      </div>

      {/* Description */}
      {work.description && (
        <section className="mb-8">
          <p className="max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {work.description}
          </p>
        </section>
      )}

      {/* Series */}
      {work.seriesName && (
        <section className="mb-8">
          <p className="text-xs text-fg-muted">
            Series:{" "}
            <span className="text-fg-secondary">
              {work.seriesName}
              {work.seriesPosition && ` #${work.seriesPosition}`}
            </span>
          </p>
        </section>
      )}

      {/* Subjects */}
      {subjects.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 font-serif text-sm text-fg-secondary">
            Subjects
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {subjects.map((s) => (
              <Badge key={s.id} variant="default">
                {s.name}
              </Badge>
            ))}
          </div>
        </section>
      )}

      {/* Media upload and gallery */}
      <WorkMediaSection
        workId={work.id}
        gallery={galleryMedia}
        hasPoster={!!poster}
        hasBackground={!!background}
      />

      {/* Editions */}
      <section className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg text-fg-primary">
            Editions ({work.editions.length})
          </h2>
        </div>

        <div className="space-y-4">
          {work.editions.map((edition) => (
            <Card key={edition.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-serif text-base text-fg-primary">
                      {edition.title}
                      {edition.subtitle && (
                        <span className="text-fg-secondary">
                          : {edition.subtitle}
                        </span>
                      )}
                    </h3>
                    <div className="mt-1 flex items-center gap-3 text-xs text-fg-secondary">
                      {edition.publisher && <span>{edition.publisher}</span>}
                      {edition.publicationYear && (
                        <span className="font-mono">{edition.publicationYear}</span>
                      )}
                      {edition.language && (
                        <Badge variant="blue">{edition.language}</Badge>
                      )}
                      {edition.binding && (
                        <Badge variant="muted">{edition.binding}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {edition.isbn13 && (
                      <span className="font-mono text-[10px] text-fg-muted">
                        {edition.isbn13}
                      </span>
                    )}
                    {edition.isFirstEdition && (
                      <Badge variant="gold">1st ed.</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              {/* Edition contributors */}
              {edition.contributors.length > 0 && (
                <div className="border-b border-bg-tertiary px-4 py-2">
                  <div className="flex flex-wrap gap-2">
                    {edition.contributors.map((c) => (
                      <span
                        key={`${c.authorId}-${c.role}`}
                        className="text-xs text-fg-secondary"
                      >
                        <span className="text-fg-muted">{c.role}:</span>{" "}
                        {c.author.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instances */}
              <CardContent>
                {edition.instances.length > 0 ? (
                  <div className="space-y-2">
                    {edition.instances.map((instance) => (
                      <div
                        key={instance.id}
                        className="flex items-center gap-3 rounded-sm bg-bg-primary px-3 py-2 text-xs"
                      >
                        <span className="text-fg-primary">
                          {instance.location.name}
                          {instance.subLocation && (
                            <span className="text-fg-muted">
                              {" "}
                              / {instance.subLocation.name}
                            </span>
                          )}
                        </span>
                        {instance.format && (
                          <Badge variant="muted">{instance.format}</Badge>
                        )}
                        {instance.condition && (
                          <Badge variant="sage">{instance.condition}</Badge>
                        )}
                        {instance.isSigned && (
                          <Badge variant="gold">Signed</Badge>
                        )}
                        {instance.status === "lent_out" && (
                          <Badge variant="red">
                            Lent to {instance.lentTo}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-fg-muted">No copies recorded</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Notes */}
      {work.notes && (
        <section className="mb-8">
          <h2 className="mb-2 font-serif text-sm text-fg-secondary">Notes</h2>
          <p className="max-w-2xl whitespace-pre-wrap text-sm text-fg-secondary">
            {work.notes}
          </p>
        </section>
      )}
    </>
  );
}
