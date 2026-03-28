export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import {
  BookOpen,
  Layers,
  Copy,
  Users,
  Plus,
  Upload,
  ArrowRight,
} from "lucide-react";
import { getLibraryStats } from "@/lib/actions/works";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
    <Card>
      <CardContent className="flex items-center gap-4 py-4">
        <div className="rounded-sm border border-bg-tertiary bg-bg-primary p-2.5">
          <Icon className="h-5 w-5 text-fg-muted" strokeWidth={1.5} />
        </div>
        <div>
          <p className="font-mono text-2xl tracking-tight text-fg-primary">
            {value.toLocaleString()}
          </p>
          <p className="text-xs text-fg-secondary">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
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

      {/* Recent additions */}
      {stats.recentWorks.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-serif text-lg text-fg-primary">
              Recent additions
            </h2>
            <Link
              href="/library?sort=recent"
              className="flex items-center gap-1 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              View all
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
            {stats.recentWorks.map((work) => {
              const edition = work.editions[0];
              const author = work.workAuthors[0]?.author;
              const instanceCount =
                work.editions.reduce(
                  (acc, e) => acc + (e.instances?.length ?? 0),
                  0,
                );
              return (
                <Link
                  key={work.id}
                  href={`/library/${work.id}`}
                  className="group rounded-sm border border-bg-tertiary bg-bg-secondary p-3 transition-all hover:border-fg-muted/30 hover:shadow-lg hover:shadow-accent-rose/5"
                >
                  <h3 className="line-clamp-2 font-serif text-sm leading-tight text-fg-primary">
                    {work.title}
                  </h3>
                  {author && (
                    <p className="mt-1 line-clamp-1 text-xs text-fg-secondary">
                      {author.name}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    {edition?.publicationYear && (
                      <span className="font-mono text-[10px] text-fg-muted">
                        {edition.publicationYear}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-fg-muted">
                      {instanceCount} {instanceCount === 1 ? "copy" : "copies"}
                    </span>
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
