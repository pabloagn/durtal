import Link from "next/link";
import type { WorkWithRelations } from "@/lib/types";

interface WorkMetadataGridProps {
  work: WorkWithRelations;
}

interface MetaRowProps {
  label: string;
  children: React.ReactNode;
}

function MetaRow({ label, children }: MetaRowProps) {
  return (
    <>
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-sm text-fg-secondary">{children}</dd>
    </>
  );
}

export function WorkMetadataGrid({ work }: WorkMetadataGridProps) {
  const hasSeries = !!(work.seriesId && work.series);
  const hasSeriesName = !!work.seriesName;
  const hasAnyMeta =
    work.originalLanguage ||
    work.originalYear ||
    work.workType ||
    work.catalogueStatus ||
    work.acquisitionPriority !== "none" ||
    work.isAnthology ||
    hasSeries ||
    hasSeriesName;

  if (!hasAnyMeta) return null;

  return (
    <section className="mb-8">
      <h2 className="mb-3 font-serif text-xl text-fg-secondary">Details</h2>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
        {work.originalLanguage && (
          <MetaRow label="Original Language">
            {work.originalLanguage}
          </MetaRow>
        )}
        {work.originalYear && (
          <MetaRow label="Original Year">
            <span className="font-mono text-xs">{work.originalYear}</span>
          </MetaRow>
        )}
        {work.workType && (
          <MetaRow label="Work Type">{work.workType.name}</MetaRow>
        )}
        <MetaRow label="Catalogue Status">{work.catalogueStatus}</MetaRow>
        {work.acquisitionPriority && work.acquisitionPriority !== "none" && (
          <MetaRow label="Acquisition Priority">
            {work.acquisitionPriority}
          </MetaRow>
        )}
        {work.isAnthology && (
          <MetaRow label="Anthology">Yes</MetaRow>
        )}
        {hasSeries && work.series && (
          <MetaRow label="Series">
            <Link
              href={`/series/${work.series.id}`}
              className="transition-colors hover:text-accent-rose"
            >
              {work.series.title}
            </Link>
            {work.seriesPosition && (
              <span className="ml-1 font-mono text-xs text-fg-muted">
                #{work.seriesPosition}
              </span>
            )}
          </MetaRow>
        )}
        {!hasSeries && hasSeriesName && work.seriesName && (
          <MetaRow label="Series">
            {work.seriesName}
            {work.seriesPosition && (
              <span className="ml-1 font-mono text-xs text-fg-muted">
                #{work.seriesPosition}
              </span>
            )}
          </MetaRow>
        )}
      </dl>
    </section>
  );
}
