import { Suspense } from "react";
import { Layers } from "lucide-react";
import Link from "next/link";
import { getSeries } from "@/lib/actions/series";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";

async function SeriesContent() {
  const allSeries = await getSeries();

  if (allSeries.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No series yet"
        description="Series will appear here once works are assigned to them"
      />
    );
  }

  return (
    <div className="space-y-2">
      {allSeries.map((s) => {
        const workCount = s.works.length;
        const ownedCount = s.works.filter((w) =>
          w.editions.some((e) => e.instances.length > 0),
        ).length;

        return (
          <Link key={s.id} href={`/series/${s.id}`}>
            <Card hover>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <h3 className="font-serif text-lg text-fg-primary">
                    {s.title}
                  </h3>
                  {s.originalTitle && s.originalTitle !== s.title && (
                    <p className="mt-0.5 text-xs text-fg-muted italic">
                      {s.originalTitle}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="muted">
                    {workCount} work{workCount !== 1 ? "s" : ""}
                  </Badge>
                  {ownedCount > 0 && (
                    <Badge variant="sage">
                      {ownedCount} owned
                    </Badge>
                  )}
                  {s.isComplete && (
                    <Badge variant="gold">Complete</Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </div>
  );
}

export default function SeriesPage() {
  return (
    <>
      <PageHeader
        title="Series"
        description="Book series in your catalogue"
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <SeriesContent />
      </Suspense>
    </>
  );
}
