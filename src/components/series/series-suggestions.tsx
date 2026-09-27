"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addWorksToSeries, type SeriesSuggestion } from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

/**
 * Books whose titles match a series. Nothing is linked until the user
 * confirms, one book or the whole group at once.
 */
export function SeriesSuggestions({
  suggestions,
  showSeriesTitles = false,
}: {
  suggestions: SeriesSuggestion[];
  showSeriesTitles?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const groups = new Map<string, SeriesSuggestion[]>();
  for (const s of suggestions)
    groups.set(s.seriesId, [...(groups.get(s.seriesId) ?? []), s]);

  async function link(
    seriesId: string,
    items: SeriesSuggestion[],
    key: string,
  ) {
    if (busy) return;
    setBusy(key);
    try {
      const { added } = await addWorksToSeries(
        seriesId,
        items.map((i) => i.workId),
      );
      toast.success(
        `${added} ${added === 1 ? "book" : "books"} linked to ${items[0].seriesTitle}`,
      );
      router.refresh();
      triggerActivityRefresh();
    } catch {
      toast.error("Could not link these books");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([seriesId, items]) => (
        <div
          key={seriesId}
          className="rounded-sm border border-dashed border-glass-border p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            {showSeriesTitles ? (
              <Link
                href={`/series/${seriesId}`}
                className="font-serif text-lg text-fg-primary hover:text-accent-rose"
              >
                {items[0].seriesTitle}
              </Link>
            ) : (
              <span className="text-xs text-fg-muted">
                Books whose titles match this series
              </span>
            )}
            {items.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={!!busy}
                onClick={() => link(seriesId, items, seriesId)}
              >
                Link all {items.length}
              </Button>
            )}
          </div>
          <ul className="space-y-1">
            {items.map((item) => (
              <li
                key={item.workId}
                className="flex items-center gap-3 px-1 py-1"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg-primary">
                    {item.workTitle}
                  </p>
                  <p className="truncate text-xs text-fg-muted">
                    {item.authors}
                    {item.currentSeriesTitle && (
                      <span className="text-accent-gold">
                        {" "}
                        · now in {item.currentSeriesTitle}; linking moves it
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => link(seriesId, [item], item.workId)}
                >
                  {busy === item.workId ? "Linking…" : "Link"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
