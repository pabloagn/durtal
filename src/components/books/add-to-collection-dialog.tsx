"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCollectionSelection,
  createCollection,
  bulkAddEditionsToCollection,
  removeEditionsFromCollection,
} from "@/lib/actions/collections";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";

type Data = Awaited<ReturnType<typeof getCollectionSelection>>;
interface Props {
  open: boolean;
  onClose: () => void;
  editionId?: string;
  workIds?: string[];
  title: string;
}
export function AddToCollectionDialog({
  open,
  onClose,
  editionId,
  workIds = [],
  title,
}: Props) {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const request = useRef("");
  const saving = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const selectionKey = JSON.stringify({ workIds, editionId });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const selection = JSON.parse(selectionKey);
    setData(null);
    setError(false);
    setQuery("");
    request.current = crypto.randomUUID();
    getCollectionSelection(
      selection.workIds,
      selection.editionId ? [selection.editionId] : [],
    )
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setSelected(result.editions.map((e) => e.id));
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectionKey, attempt]);
  function refreshed() {
    router.refresh();
    triggerActivityRefresh();
  }
  async function toggle(id: string, remove: boolean) {
    if (saving.current || !selected.length) return;
    saving.current = true;
    setBusy(true);
    try {
      if (remove) await removeEditionsFromCollection(id, selected);
      else await bulkAddEditionsToCollection(id, selected);
      setData(
        (current) =>
          current && {
            ...current,
            collections: current.collections.map((c) =>
              c.id !== id
                ? c
                : {
                    ...c,
                    collectionEditions: remove
                      ? c.collectionEditions.filter(
                          (e) => !selected.includes(e.editionId),
                        )
                      : [
                          ...c.collectionEditions,
                          ...selected
                            .filter(
                              (eid) =>
                                !c.collectionEditions.some(
                                  (e) => e.editionId === eid,
                                ),
                            )
                            .map((editionId) => ({ editionId })),
                        ],
                  },
            ),
          },
      );
      toast.success(remove ? "Removed from collection" : "Added to collection");
      refreshed();
    } catch {
      toast.error("Could not update this collection. Please try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || !query.trim() || !selected.length) return;
    const existing = data?.collections.find(
      (c) =>
        c.name.trim().toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
    );
    if (existing) {
      await toggle(existing.id, false);
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      const c = await createCollection(
        { name: query },
        selected,
        request.current,
      );
      setData(
        (current) =>
          current && {
            ...current,
            collections: [
              ...current.collections.filter((row) => row.id !== c.id),
              {
                ...c,
                collectionEditions: selected.map((editionId) => ({
                  editionId,
                })),
              },
            ],
          },
      );
      request.current = crypto.randomUUID();
      setQuery("");
      toast.success("Collection created and books added");
      refreshed();
    } catch {
      toast.error("Could not create and add. Your selection is still here.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const filtered =
    data?.collections.filter((c) =>
      c.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    ) ?? [];
  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving.current) onClose();
      }}
      title="Collections"
      description={title}
      className="max-w-lg"
      expandable={false}
    >
      <div className="space-y-3">
        {error ? (
          <div role="alert">
            Could not load collections.{" "}
            <Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>
          </div>
        ) : !data ? (
          <p role="status" className="text-sm text-fg-muted">
            Loading collections…
          </p>
        ) : (
          <>
            {data.withoutEditions.length > 0 && (
              <p className="text-xs text-fg-muted">
                {data.withoutEditions.map((w) => w.title).join(", ")}: add an
                edition to include{" "}
                {data.withoutEditions.length === 1
                  ? "this book"
                  : "these books"}{" "}
                in a collection.
              </p>
            )}
            {data.editions.length > 1 && (
              <details>
                <summary className="cursor-pointer text-xs text-fg-secondary">
                  {selected.length} of {data.editions.length} editions selected
                  · Choose editions
                </summary>
                <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
                  {data.editions.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-start gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(e.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelected((old) =>
                            event.target.checked
                              ? [...old, e.id]
                              : old.filter((id) => id !== e.id),
                          )
                        }
                      />
                      <span>
                        {e.title}
                        <span className="block text-fg-muted">
                          {[
                            e.publisher,
                            e.publicationYear,
                            e.language,
                            e.isbn13,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
            )}
            <form onSubmit={create} className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  aria-label="Find or create a collection"
                  placeholder="Find or create a collection…"
                  value={query}
                  maxLength={160}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    request.current = crypto.randomUUID();
                  }}
                  disabled={busy}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                disabled={busy || !query.trim() || !selected.length}
                variant="primary"
              >
                {data.collections.some(
                  (c) =>
                    c.name.trim().toLocaleLowerCase() ===
                    query.trim().toLocaleLowerCase(),
                )
                  ? "Add"
                  : "Create & add"}
              </Button>
            </form>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {filtered.length ? (
                filtered.map((c) => {
                  const amount = selected.filter((id) =>
                    c.collectionEditions.some((e) => e.editionId === id),
                  ).length;
                  const all = selected.length > 0 && amount === selected.length;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      role="checkbox"
                      aria-checked={all ? true : amount ? "mixed" : false}
                      aria-label={c.name}
                      disabled={busy || !selected.length}
                      onClick={() => toggle(c.id, all)}
                      className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-bg-tertiary disabled:opacity-50"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${amount ? "border-accent-rose bg-accent-rose/25" : "border-glass-border"}`}
                      >
                        {all ? (
                          <Check size={12} />
                        ) : amount ? (
                          <Minus size={12} />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.name}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {c.collectionEditions.length}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="py-4 text-center text-sm text-fg-muted">
                  {query
                    ? "No matching collections. Create one above."
                    : "Name your first collection above."}
                </p>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end">
          <Button onClick={onClose} disabled={busy}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
export function CollectionButton({
  workId,
  editionId,
  title,
}: {
  workId?: string;
  editionId?: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        title="Add to collection"
        aria-label="Add to collection"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-tertiary hover:text-fg-primary focus-visible:outline focus-visible:outline-accent-rose"
      >
        <FolderPlus size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <AddToCollectionDialog
          open={open}
          onClose={() => setOpen(false)}
          workIds={workId ? [workId] : []}
          editionId={editionId}
          title={title}
        />
      )}
    </>
  );
}
