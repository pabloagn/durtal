"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addWorksToSeries, searchWorksForSeries } from "@/lib/actions/series";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

type Work = Awaited<ReturnType<typeof searchWorksForSeries>>[number];

/** Search books and put them into the series; books from another series move. */
export function AddSeriesBooksDialog({
  open,
  onClose,
  seriesId,
  seriesTitle,
}: {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  seriesTitle: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Work[]>([]);
  const [selected, setSelected] = useState<Record<string, Work>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSelected({});
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      searchWorksForSeries(query)
        .then((rows) => !cancelled && setResults(rows))
        .catch(() => !cancelled && toast.error("Could not search books"))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  const chosen = Object.values(selected);
  const moving = chosen.filter((w) => w.seriesId && w.seriesId !== seriesId);

  async function add() {
    if (saving || !chosen.length) return;
    setSaving(true);
    try {
      const { added } = await addWorksToSeries(
        seriesId,
        chosen.map((w) => w.id),
      );
      toast.success(
        `${added} ${added === 1 ? "book" : "books"} added to ${seriesTitle}`,
      );
      router.refresh();
      triggerActivityRefresh();
      onClose();
    } catch {
      toast.error("Could not add these books. Your selection is still here.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      title="Add books"
      description={`Put books into ${seriesTitle}.`}
      className="max-w-xl"
      expandable={false}
    >
      <div className="space-y-3">
        <Input
          ref={inputRef}
          aria-label="Search books to add"
          placeholder="Search title or author…"
          value={query}
          maxLength={200}
          onChange={(e) => setQuery(e.target.value)}
          disabled={saving}
        />
        <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
          {!query.trim() ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              Type a title or an author.
            </p>
          ) : loading ? (
            <p role="status" className="py-6 text-center text-sm text-fg-muted">
              Finding books…
            </p>
          ) : results.length ? (
            results.map((w) => {
              const inThis = w.seriesId === seriesId;
              return (
                <label
                  key={w.id}
                  className={`flex items-center gap-3 rounded-sm px-2 py-2 ${inThis ? "opacity-50" : "cursor-pointer hover:bg-bg-tertiary"}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${w.title}`}
                    checked={inThis || !!selected[w.id]}
                    disabled={saving || inThis}
                    onChange={(event) =>
                      setSelected((old) => {
                        const next = { ...old };
                        if (event.target.checked) next[w.id] = w;
                        else delete next[w.id];
                        return next;
                      })
                    }
                    className="h-4 w-4 rounded-sm border-glass-border accent-accent-rose"
                  />
                  <div className="flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-bg-tertiary">
                    {w.cover && (
                      <img
                        src={`/api/s3/read?key=${encodeURIComponent(w.cover)}`}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    )}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{w.title}</span>
                    <span className="block truncate text-xs text-fg-muted">
                      {w.authors}
                    </span>
                    {w.seriesTitle && (
                      <span
                        className={`block truncate text-xs ${inThis ? "text-fg-muted" : "text-accent-gold"}`}
                      >
                        {inThis
                          ? "Already in this series"
                          : `In ${w.seriesTitle} — will move here`}
                      </span>
                    )}
                  </span>
                </label>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-fg-muted">
              No books match.
            </p>
          )}
        </div>
        {moving.length > 0 && (
          <p className="text-xs text-accent-gold">
            {moving.length} {moving.length === 1 ? "book moves" : "books move"}{" "}
            from another series. A book belongs to one series.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={saving || !chosen.length}
            onClick={add}
          >
            {saving ? "Adding…" : `Add ${chosen.length || ""}`.trim()}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
