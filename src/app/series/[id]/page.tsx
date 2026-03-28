export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSeriesDetail } from "@/lib/actions/series";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function SeriesDetailPage({ params }: PageProps) {
  const { id } = await params;
  const s = await getSeriesDetail(id);

  if (!s) notFound();

  const ownedCount = s.works.filter((w) =>
    w.editions.some((e) =>
      e.instances.some((i) => i.status !== "deaccessioned"),
    ),
  ).length;

  return (
    <>
      <Link
        href="/series"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to series
      </Link>

      <div className="mb-8">
        <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
          {s.title}
        </h1>
        {s.originalTitle && s.originalTitle !== s.title && (
          <p className="mt-1 text-sm text-fg-muted italic">
            {s.originalTitle}
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Badge variant="muted">
            {s.works.length} work{s.works.length !== 1 ? "s" : ""}
          </Badge>
          <Badge variant="sage">
            {ownedCount} of {s.totalVolumes ?? s.works.length} owned
          </Badge>
          {s.isComplete && <Badge variant="gold">Complete series</Badge>}
        </div>
        {s.description && (
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-fg-secondary">
            {s.description}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {s.works.map((work) => {
          const author = work.workAuthors[0]?.author;
          const edition = work.editions[0];
          const hasInstance = edition?.instances.some(
            (i) => i.status !== "deaccessioned",
          );
          const thumb = edition?.thumbnailS3Key;

          return (
            <Link key={work.id} href={`/library/${work.slug ?? ""}`}>
              <Card hover>
                <CardContent className="flex items-center gap-4 py-3">
                  {/* Position number */}
                  <span className="w-6 text-right font-mono text-xs text-fg-muted">
                    {work.seriesPosition ?? "—"}
                  </span>

                  {/* Thumbnail */}
                  {thumb ? (
                    <img
                      src={`/api/s3/read?key=${encodeURIComponent(thumb)}`}
                      alt=""
                      className="h-12 w-8 shrink-0 rounded-sm object-cover"
                    />
                  ) : (
                    <div className="h-12 w-8 shrink-0 rounded-sm bg-bg-tertiary" />
                  )}

                  {/* Details */}
                  <div className="min-w-0 flex-1">
                    <h3 className="line-clamp-1 font-serif text-lg text-fg-primary">
                      {work.title}
                    </h3>
                    {author && (
                      <p className="mt-0.5 text-xs text-fg-secondary">
                        {author.name}
                      </p>
                    )}
                  </div>

                  {/* Status */}
                  {hasInstance ? (
                    <Badge variant="sage">Owned</Badge>
                  ) : (
                    <Badge variant="muted">
                      {work.catalogueStatus === "wanted"
                        ? "Wanted"
                        : work.catalogueStatus === "shortlisted"
                          ? "Shortlisted"
                          : "Not owned"}
                    </Badge>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </>
  );
}
