import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSeriesSuggestions } from "@/lib/actions/series";
import { PageHeader } from "@/components/layout/page-header";
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
        className="relative mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to series
      </Link>
      <PageHeader
        title="Suggested books"
        description={
          suggestions.length
            ? `${suggestions.length} books match ${seriesCount} series by title. Nothing is linked until you confirm.`
            : "No suggestions: every matching book is already in its series."
        }
      />
      <SeriesSuggestions suggestions={suggestions} showSeriesTitles />
    </>
  );
}
