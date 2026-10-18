"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, FolderPlus } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useShortcut } from "@/components/shortcuts/shortcuts-provider";
import {
  getCollectionSelection,
  createCollection,
  addToCollection,
  removeFromCollection,
} from "@/lib/actions/collections";
import {
  collectionCountLine,
  collectionCreatedMessage,
} from "@/lib/collections/counts";
import { triggerActivityRefresh } from "@/lib/activity/refresh-event";
import { useFocusThroughBusy } from "@/hooks/use-focus-through-busy";
import { CollectionIconLazy } from "@/components/collections/collection-icon-lazy";
import { CountParts } from "@/components/collections/count-parts";
import { countLabel } from "@/lib/utils/format";
import { shortcutProps } from "@/lib/shortcuts/shortcuts";

type Data = Awaited<ReturnType<typeof getCollectionSelection>>;

/** A work joining a collection, with its kind for the row's count line */
function workKind(data: Data, workId: string) {
  return { kind: data.works.find((w) => w.id === workId)?.kind ?? ("book" as const) };
}
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
  const field = useRef<HTMLInputElement>(null);
  useFocusThroughBusy(busy, field);
  const saving = useRef(false);
  // A read after a failed change keeps the editions the reader chose
  const keepChoice = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const selectionKey = JSON.stringify({ workIds, editionId });
  useEffect(() => {
    if (!open) {
      keepChoice.current = false;
      return;
    }
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
          const ids = result.editions.map((e) => e.id);
          const keep = keepChoice.current;
          keepChoice.current = false;
          setData(result);
          setSelected((old) => (keep ? old.filter((id) => ids.includes(id)) : ids));
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
  // Films, perfumes, paintings and books with no edition join as whole works
  const wholeWorks = data?.works.map((w) => w.id) ?? [];
  const chosen = selected.length + wholeWorks.length;
  async function toggle(id: string, remove: boolean) {
    if (saving.current || !chosen) return;
    saving.current = true;
    setBusy(true);
    try {
      // Editions and whole works change together or not at all (SLN-573)
      const members = { editionIds: selected, workIds: wholeWorks };
      await (remove ? removeFromCollection(id, members) : addToCollection(id, members));
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
                            .map((editionId) => ({
                              editionId,
                              edition: {
                                workId:
                                  current.editions.find((e) => e.id === editionId)
                                    ?.workId ?? editionId,
                              },
                            })),
                        ],
                    collectionWorks: remove
                      ? c.collectionWorks.filter((w) => !wholeWorks.includes(w.workId))
                      : [
                          ...c.collectionWorks,
                          ...wholeWorks
                            .filter((wid) => !c.collectionWorks.some((w) => w.workId === wid))
                            .map((workId) => ({ workId, work: workKind(current, workId) })),
                        ],
                  },
            ),
          },
      );
      toast.success(remove ? "Removed from collection" : "Added to collection");
      refreshed();
    } catch {
      // Nothing was changed; a book may have gone meanwhile, so read again
      toast.error("Could not update this collection. Nothing was changed.");
      keepChoice.current = true;
      setAttempt((n) => n + 1);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (saving.current || !query.trim() || !chosen) return;
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
        wholeWorks,
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
                  edition: {
                    workId:
                      current.editions.find((e) => e.id === editionId)?.workId ??
                      editionId,
                  },
                })),
                collectionWorks: wholeWorks.map((workId) => ({ workId, work: workKind(current, workId) })),
                media: [],
              },
            ],
          },
      );
      request.current = crypto.randomUUID();
      setQuery("");
      // One kind per work added: a book once, however many of its editions
      const books = new Set(
        selected.map((id) => data?.editions.find((e) => e.id === id)?.workId ?? id),
      );
      const kinds = [
        ...[...books].map(() => "book" as const),
        ...(data?.works.map((w) => w.kind) ?? []),
      ];
      toast.success(collectionCreatedMessage(kinds));
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
          <p role="status" className="text-sm text-fg-secondary">
            Loading collections…
          </p>
        ) : (
          <>
            {data.works.some((w) => w.kind === "book") && (
              <p className="text-xs text-fg-secondary">
                {data.works
                  .filter((w) => w.kind === "book")
                  .map((w) => w.title)
                  .join(", ")}
                : no edition yet, so{" "}
                {data.works.filter((w) => w.kind === "book").length === 1
                  ? "this book joins"
                  : "these books join"}{" "}
                as a whole book.
              </p>
            )}
            {data.editions.length > 1 && (
              <details>
                <summary className="cursor-pointer text-xs text-fg-secondary pointer-coarse:py-3">
                  {selected.length.toLocaleString("en")} of {countLabel(data.editions.length, "edition")} selected
                  · Choose editions
                </summary>
                <div className="mt-2 max-h-36 space-y-2 overflow-y-auto">
                  {data.editions.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-start gap-2 text-xs pointer-coarse:min-h-11"
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
                        <span className="block text-fg-secondary">
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
                  ref={field}
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
              {/* ⌘Enter in the field creates too: the dialog's Done is
                  otherwise its last main button, and would close it */}
              <Button
                type="submit"
                disabled={busy || !query.trim() || !chosen}
                variant="primary"
                data-shortcut="save"
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
                  const amount =
                    selected.filter((id) =>
                      c.collectionEditions.some((e) => e.editionId === id),
                    ).length +
                    wholeWorks.filter((id) =>
                      c.collectionWorks.some((w) => w.workId === id),
                    ).length;
                  const all = chosen > 0 && amount === chosen;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      role="checkbox"
                      aria-checked={all ? true : amount ? "mixed" : false}
                      aria-label={c.name}
                      disabled={busy || !chosen}
                      onClick={() => toggle(c.id, all)}
                      className="flex w-full items-center gap-3 rounded-sm px-2 py-2 text-left hover:bg-bg-tertiary disabled:opacity-50 pointer-coarse:min-h-11"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${amount ? "border-accent-primary bg-accent-primary/25" : "border-glass-border"}`}
                      >
                        {all ? (
                          <Check size={12} />
                        ) : amount ? (
                          <Minus size={12} />
                        ) : null}
                      </span>
                      {/* Same slot for every row, so names line up */}
                      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-fg-secondary">
                        <CollectionIconLazy
                          icon={c.icon}
                          className="h-3.5 w-3.5"
                        />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {c.name}
                      </span>
                      {/* At most half the row, so a long count never hides the name */}
                      <span className="max-w-[50%] shrink-0 text-right text-xs text-fg-secondary">
                        <CountParts line={collectionCountLine(c) ?? "Empty"} />
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="py-4 text-center text-sm text-fg-secondary">
                  {query
                    ? "No matching collections. Create one above."
                    : "Name your first collection above."}
                </p>
              )}
            </div>
          </>
        )}
        <div className="flex justify-end">
          {/* The main action: Enter closes the picker, each tick saved */}
          <Button variant="primary" onClick={onClose} disabled={busy}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
/** A then this key opens the open item's collections (SLN-571) */
export const COLLECTION_SHORTCUT = "c";

/** Registers A then C for the open item: one call per detail page */
export function CollectionShortcut({ run }: { run: () => void }) {
  useShortcut(COLLECTION_SHORTCUT, "Add to a collection", run, "a");
  return null;
}

export function CollectionButton({
  workId,
  editionId,
  title,
  size = "sm",
  shortcut = false,
}: {
  workId?: string;
  editionId?: string;
  title: string;
  size?: "sm" | "md";
  /** The page's own item: A then C opens it too */
  shortcut?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {shortcut && <CollectionShortcut run={() => setOpen(true)} />}
      <button
        type="button"
        data-tooltip="Add to collection"
        {...shortcutProps(shortcut ? `a then ${COLLECTION_SHORTCUT}` : undefined)}
        aria-label="Add to collection"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={size === "sm" ? "action-icon-sm" : "action-icon"}
      >
        <FolderPlus size={16} strokeWidth={1.5} />
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
