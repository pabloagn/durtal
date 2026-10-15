import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { getSeriesSuggestionScope, getSeriesSuggestions } from "@/lib/actions/series";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/button";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { SeriesFormDialog } from "@/components/series/series-form-dialog";
import { SeriesSuggestions } from "@/components/series/series-suggestions";

export const metadata = { title: "Suggested books" };

export const dynamic = "force-dynamic";

export default async function SeriesSuggestionsPage() {
  const suggestions = await getSeriesSuggestions();
  const seriesCount = new Set(suggestions.map((s) => s.seriesId)).size;
  return (
    <>
      <Link
        href="/series"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to series
      </Link>
      <PageHeader
        title="Suggested books"
        description={
          suggestions.length
            ? `${suggestions.length} books match ${seriesCount} series by title. Nothing is linked until you confirm.`
            : undefined
        }
      />
      {suggestions.length ? (
        <SeriesSuggestions suggestions={suggestions} showSeriesTitles />
      ) : (
        <NoSuggestions />
      )}
    </>
  );
}

/** Why nothing is suggested, and the next step: add a book, add a series, or none is left to link (SLN-755) */
async function NoSuggestions() {
  const scope = await getSeriesSuggestionScope();
  if (!scope.books)
    return (
      <EmptyState
        icon={Layers}
        title="No books yet"
        description="Books whose titles match a series are suggested here. Add books to start."
        action={<DomainAddLink kind="book" size="md" />}
      />
    );
  if (!scope.series)
    return (
      <EmptyState
        icon={Layers}
        title="No series yet"
        description="Books whose titles match a series are suggested here. Add a series to start."
        action={<SeriesFormDialog />}
      />
    );
  return (
    <EmptyState
      icon={Layers}
      title="No suggestions"
      description="Every book whose title matches a series is already in it."
      action={
        <Link href="/series" className={buttonClass("secondary")}>
          See all series
        </Link>
      }
    />
  );
}
