"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchEditionsForPicker,
  searchWorksForCollection,
  bulkAddEditionsToCollection,
  bulkAddWorksToCollection,
} from "@/lib/actions/collections";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { WORK_DOMAINS, getEnabledWorkKinds } from "@/lib/catalogue/domains";
import type { WorkKind } from "@/lib/catalogue/kinds";
import { mediaUrl } from "@/lib/s3/media-url";

type Edition = Awaited<ReturnType<typeof searchEditionsForPicker>>[number];
type Work = Awaited<ReturnType<typeof searchWorksForCollection>>[number];

/** What the dialog adds: chosen editions of books, or whole works of one kind */
type Mode = "editions" | WorkKind;

const MODE_LABELS: Record<Mode, string> = {
  editions: "Editions",
  book: "Books",
  film: "Films",
  perfume: "Perfumes",
  painting: "Paintings",
};
const SEARCH_HINTS: Record<Mode, string> = {
  editions: "Search title, author or ISBN…",
  book: "Search title or author…",
  film: "Search title or director…",
  perfume: "Search title or perfumer…",
  painting: "Search title or painter…",
};

/**
 * Adds members to a collection: editions of books (a chosen edition), or whole
 * works of any open collection, including a book with no edition chosen and
 * works with nothing owned. Each choice joins after the last member.
 */
export function AddCollectionBooksDialog({
  open,
  onClose,
  collectionId,
  existingIds,
  existingWorkIds = [],
}: {
  open: boolean;
  onClose: () => void;
  collectionId: string;
  /** Editions already in the collection */
  existingIds: string[];
  /** Whole works already in the collection */
  existingWorkIds?: string[];
}) {
  const router = useRouter();
  // Books come first, then their editions, then the other kinds
  const modes: Mode[] = [
    "book",
    "editions",
    ...getEnabledWorkKinds().filter((kind) => kind !== "book"),
  ];
  const [mode, setMode] = useState<Mode>("book");
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Edition[]>([]),
    [works, setWorks] = useState<Work[]>([]),
    [selected, setSelected] = useState<Record<string, Edition>>({}),
    [selectedWorks, setSelectedWorks] = useState<Record<string, Work>>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [saving, setSaving] = useState(false),
    [retry, setRetry] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!open) return;
    setMode("book");
    setQuery("");
    setSelected({});
    setSelectedWorks({});
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    const timer = setTimeout(
      () => {
        const request =
          mode === "editions"
            ? searchEditionsForPicker(query).then((rows) => {
                if (!cancelled) setResults(rows);
              })
            : searchWorksForCollection(query, mode).then((rows) => {
                if (!cancelled) setWorks(rows);
              });
        request
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
  }, [query, open, retry, mode]);
  const ids = Object.keys(selected).filter((id) => !existingIds.includes(id));
  const workIds = Object.keys(selectedWorks).filter(
    (id) => !existingWorkIds.includes(id),
  );
  const count = ids.length + workIds.length;
  async function add() {
    if (busy.current || !count) return;
    busy.current = true;
    setSaving(true);
    try {
      const [editionsAdded, worksAdded] = await Promise.all([
        ids.length
          ? bulkAddEditionsToCollection(collectionId, ids)
          : { changed: 0 },
        workIds.length
          ? bulkAddWorksToCollection(collectionId, workIds)
          : { changed: 0 },
      ]);
      const changed = editionsAdded.changed + worksAdded.changed;
      toast.success(`${changed} added to the collection`);
      router.refresh();
      triggerActivityRefresh();
      onClose();
    } catch {
      toast.error("Could not add these. Your selection is still here.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const shown = mode === "editions" ? results.length : works.length;
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title="Add to collection"
      description="Choose editions of your books, or whole works."
      className="max-w-xl"
      expandable={false}
    >
      <div className="space-y-3">
        <div
          role="radiogroup"
          aria-label="What to add"
          className="flex flex-wrap gap-1"
        >
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              disabled={saving}
              onClick={() => {
                setMode(m);
                setQuery("");
              }}
              className={`h-8 pointer-coarse:h-11 rounded-sm border px-3 text-sm transition-colors ${
                mode === m
                  ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                  : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {mode === "book" && (
          <p className="text-xs text-fg-secondary">
            A whole book, with no edition chosen. To keep one edition, add it
            under Editions.
          </p>
        )}
        <Input
          aria-label={`Search ${MODE_LABELS[mode].toLowerCase()} to add`}
          placeholder={SEARCH_HINTS[mode]}
          value={query}
          maxLength={300}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          disabled={saving}
        />
        <div className="max-h-[40dvh] space-y-1 overflow-y-auto">
          {loading ? (
            <p
              role="status"
              className="py-6 text-center text-sm text-fg-secondary"
            >
              Searching…
            </p>
          ) : error ? (
            <div role="alert">
              Could not search.{" "}
              <Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>
            </div>
          ) : mode === "editions" && results.length ? (
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
                      src={mediaUrl(e.thumbnailS3Key)}
                      alt=""
                      className="h-12 w-8 shrink-0 rounded-sm object-cover"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{e.editionTitle}</span>
                    <span className="block text-xs text-fg-secondary">
                      {e.authorName}
                    </span>
                    <span className="block text-xs text-fg-secondary">
                      {[e.publisher, e.publicationYear, e.language, e.isbn13]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {added && <span className="text-xs">In collection</span>}
                </label>
              );
            })
          ) : mode !== "editions" && works.length ? (
            works.map((w) => {
              const added = existingWorkIds.includes(w.workId);
              return (
                <label
                  key={w.workId}
                  className={`flex items-center gap-3 rounded-sm px-2 py-2 ${added ? "opacity-50" : "cursor-pointer hover:bg-bg-tertiary"}`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select ${w.title}${w.creators ? `, ${w.creators}` : ""}`}
                    checked={added || !!selectedWorks[w.workId]}
                    disabled={saving || added}
                    onChange={(event) =>
                      setSelectedWorks((old) => {
                        const next = { ...old };
                        if (event.target.checked) next[w.workId] = w;
                        else delete next[w.workId];
                        return next;
                      })
                    }
                  />
                  {w.imageS3Key && (
                    <img
                      src={mediaUrl(w.imageS3Key)}
                      alt=""
                      className={`${w.kind === "perfume" ? "h-10 w-10 object-contain" : "h-12 w-8 object-cover"} shrink-0 rounded-sm`}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{w.title}</span>
                    <span className="block text-xs text-fg-secondary">
                      {[WORK_DOMAINS[w.kind].label, w.creators]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {added && <span className="text-xs">In collection</span>}
                </label>
              );
            })
          ) : (
            <p className="py-6 text-center text-sm text-fg-secondary">
              Nothing matches. Try another search.
            </p>
          )}
        </div>
        {shown === 30 && !loading && (
          <p className="text-xs text-fg-secondary">
            Showing the first 30 matches. Refine your search to find more.
          </p>
        )}
        {count > 0 && (
          <details>
            <summary className="cursor-pointer text-xs text-fg-secondary">
              {count} selected · Review
            </summary>
            <div className="max-h-24 overflow-y-auto">
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="block text-xs text-fg-secondary"
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
              {workIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="block text-xs text-fg-secondary"
                  disabled={saving}
                  onClick={() =>
                    setSelectedWorks((old) => {
                      const next = { ...old };
                      delete next[id];
                      return next;
                    })
                  }
                >
                  Remove {selectedWorks[id].title}
                </button>
              ))}
            </div>
          </details>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-glass-border pt-3">
          <span className="text-xs text-fg-secondary">{count} selected</span>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={saving || !count} onClick={add}>
              {saving ? "Adding…" : count ? `Add ${count}` : "Add"}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
