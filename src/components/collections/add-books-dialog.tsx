"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchEditionsForPicker,
  bulkAddEditionsToCollection,
} from "@/lib/actions/collections";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
type Edition = Awaited<ReturnType<typeof searchEditionsForPicker>>[number];
export function AddCollectionBooksDialog({
  open,
  onClose,
  collectionId,
  existingIds,
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  existingIds: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Edition[]>([]),
    [selected, setSelected] = useState<Record<string, Edition>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [saving, setSaving] = useState(false),
    [retry, setRetry] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected({});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = setTimeout(
      () => {
        searchEditionsForPicker(query)
          .then((rows) => {
            if (!cancelled) setResults(rows);
          })
          .catch(() => {
            if (!cancelled) setError(true);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, retry]);
  const ids = Object.keys(selected).filter((id) => !existingIds.includes(id));
  async function add() {
    if (busy.current || !ids.length) return;
    busy.current = true;
    setSaving(true);
    try {
      const result = await bulkAddEditionsToCollection(collectionId, ids);
      toast.success(
        `${result.changed} ${result.changed === 1 ? "edition" : "editions"} added`,
      );
      router.refresh();
      triggerActivityRefresh();
      onClose();
    } catch {
      toast.error("Could not add these books. Your selection is still here.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title="Add books"
      description="Choose editions from your library."
      className="max-w-xl"
      expandable={false}
    >
      <div className="space-y-3">
        <Input
          aria-label="Search books to add"
          placeholder="Search title, author or ISBN…"
          value={query}
          maxLength={300}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          disabled={saving}
        />
        <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
          {loading ? (
            <p role="status" className="py-6 text-center text-sm text-fg-muted">
              Finding books…
            </p>
          ) : error ? (
            <div role="alert">
              Could not load books.{" "}
              <Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>
            </div>
          ) : results.length ? (
            results.map((e) => {
              const added = existingIds.includes(e.editionId);
              return (
                <label
                  key={e.editionId}
                  className={`flex items-center gap-3 rounded-sm px-2 py-2 ${added ? "opacity-50" : "cursor-pointer hover:bg-bg-tertiary"}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.editionTitle}, ${e.publisher ?? "unknown publisher"}${e.publicationYear ? `, ${e.publicationYear}` : ""}`}
                    checked={added || !!selected[e.editionId]}
                    disabled={saving || added}
                    onChange={(event) =>
                      setSelected((old) => {
                        const next = { ...old };
                        if (event.target.checked) next[e.editionId] = e;
                        else delete next[e.editionId];
                        return next;
                      })
                    }
                  />
                  {e.thumbnailS3Key && (
                    <img
                      src={`/api/s3/read?key=${encodeURIComponent(e.thumbnailS3Key)}`}
                      alt=""
                      className="h-12 w-8 shrink-0 rounded-sm object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{e.editionTitle}</span>
                    <span className="block text-xs text-fg-muted">
                      {e.authorName}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {[e.publisher, e.publicationYear, e.language, e.isbn13]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {added && <span className="text-xs">In collection</span>}
                </label>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-fg-muted">
              No editions match. Try another title, author or ISBN.
            </p>
          )}
        </div>
        {results.length === 30 && !loading && (
          <p className="text-xs text-fg-muted">
            Showing the first 30 matches. Refine your search to find more.
          </p>
        )}
        {ids.length > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-fg-secondary">
              {ids.length} selected · Review
            </summary>
            <div className="max-h-24 overflow-y-auto">
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="block text-xs text-fg-muted"
                  disabled={saving}
                  onClick={() =>
                    setSelected((old) => {
                      const next = { ...old };
                      delete next[id];
                      return next;
                    })
                  }
                >
                  Remove {selected[id].editionTitle}
                </button>
              ))}
            </div>
          </details>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-glass-border pt-3">
          <span className="text-xs text-fg-muted">{ids.length} selected</span>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || !ids.length}
              onClick={add}
            >
              {saving ? "Adding…" : `Add ${ids.length || "books"}`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
