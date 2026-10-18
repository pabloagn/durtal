"use client";

import { useListSearchClear } from "@/lib/hooks/use-list-search-clear";

import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  useTransition,
} from "react";
import Link from "next/link";
import {
  getTaxonomyBrowsePage,
  getTaxonomyEditorChoices,
} from "@/lib/actions/taxonomy-browse";
import { firstPageHref } from "@/lib/utils/list-params";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Pencil, Plus, Search, Tags, Trash2 } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NoResults } from "@/components/shared/no-results";
import { searchScore } from "@/lib/utils/search-text";
import { TaxonomyTree } from "@/components/taxonomy/taxonomy-tree";
import type { TaxonomyItemData } from "@/components/taxonomy/taxonomy-item-row";
import { CreateItemDialog } from "@/components/taxonomy/create-item-dialog";
import { MergeDialog } from "@/components/taxonomy/merge-dialog";
import { DeleteItemDialog } from "@/components/taxonomy/delete-item-dialog";
import { EditFamilyDialog } from "@/components/taxonomy/edit-family-dialog";
import { DeleteFamilyDialog } from "@/components/taxonomy/delete-family-dialog";
import { getEnabledWorkKinds } from "@/lib/catalogue/domains";
import { taxonomyMergeTargets } from "@/lib/catalogue/taxonomy-management";
import type { WorkKind } from "@/lib/catalogue/kinds";
import {
  taxonomyScopeLabel,
  type TaxonomyLevel,
} from "@/lib/catalogue/taxonomies";

// ── Types ──────────────────────────────────────────────────────────────────

interface Family {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  isSystem: boolean;
  entityLevel: string;
  hierarchical: boolean;
  manualOrdering?: boolean;
  sortOrder: number;
  applicability: { kind: WorkKind; level: TaxonomyLevel }[];
}

type SortMode = "manual" | "alphabetical" | "most-used";

// ── Props ──────────────────────────────────────────────────────────────────

interface TaxonomyFamilyShellProps {
  family: Family;
  items: TaxonomyItemData[];
  browse?: {
    total: number;
    familyTotal: number;
    wholeTree: boolean;
    page: number;
    perPage: number;
    nested: boolean;
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export function TaxonomyFamilyShell({
  family,
  items,
  browse,
}: TaxonomyFamilyShellProps) {
  const serverPaged = !!browse && !browse.wholeTree;
  const [choices, setChoices] =
    useState<{ id: string; name: string; parentId?: string | null }[]>(items);
  const router = useRouter();
  const params = useSearchParams();
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(firstPageHref(`/taxonomy/${family.slug}`, next), {
      scroll: false,
    });
  }
  const [isPending, startTransition] = useTransition();

  // The filter's text is the field's own: the list is filtered here, with no
  // server request, so a key never waits on the URL (typed letters were lost
  // when the field showed the URL until the server answered, SLN-881). The URL
  // follows after a pause, without a server request. When the address changes
  // from elsewhere (back, forward), its query wins; our own write coming back
  // doesn't overwrite what was typed since.
  const urlQuery = params.get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(urlQuery);
  const [urlBefore, setUrlBefore] = useState(urlQuery);
  const [written, setWritten] = useState<string | null>(null);
  if (urlQuery !== urlBefore) {
    setUrlBefore(urlQuery);
    if (urlQuery !== written) setSearchQuery(urlQuery);
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(searchTimer.current), []);
  function writeFilter(value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set("q", value);
    else next.delete("q");
    setWritten(value);
    if (serverPaged)
      startTransition(() =>
        router.replace(firstPageHref(`/taxonomy/${family.slug}`, next), {
          scroll: false,
        }),
      );
    else
      window.history.replaceState(
        null,
        "",
        firstPageHref(`/taxonomy/${family.slug}`, next),
      );
  }
  useListSearchClear(searchRef, (navigate) => {
    clearTimeout(searchTimer.current);
    setSearchQuery("");
    if (navigate) writeFilter("");
  });
  function typeFilter(value: string) {
    setSearchQuery(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => writeFilter(value), 300);
  }
  // Clear search empties the field here, with no server request, and leaves
  // focus in it to type again
  function clearFilter(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    clearTimeout(searchTimer.current);
    setSearchQuery("");
    writeFilter("");
    searchRef.current?.focus();
  }
  const requestedSort = params.get("sort");
  const sortMode: SortMode =
    requestedSort === "alphabetical" || requestedSort === "most-used"
      ? requestedSort
      : family.manualOrdering === false
        ? "alphabetical"
        : "manual";
  const canReorder =
    family.manualOrdering !== false &&
    sortMode === "manual" &&
    !searchQuery.trim();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [actionItem, setActionItem] = useState<TaxonomyItemData | null>(null);
  const [mergeItemId, setMergeItemId] = useState<string | null>(null);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [familyDialog, setFamilyDialog] = useState<"edit" | "delete" | null>(
    null,
  );
  // Once the first item replaces the empty state, land on its name after
  // the dialog's own focus restoration has finished.
  const newItemButton = useRef<HTMLButtonElement>(null);
  const firstItem = useRef<string | null>(null);
  useEffect(() => {
    const id = firstItem.current;
    if (!id || createDialogOpen || !items.some((item) => item.id === id))
      return;
    const frame = requestAnimationFrame(() => {
      const name = document.querySelector<HTMLElement>(
        `[data-taxonomy-item-name="${id}"]`,
      );
      if (name) {
        firstItem.current = null;
        name.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [items, createDialogOpen]);
  const enabled = new Set<WorkKind>(getEnabledWorkKinds());
  const scopeLabels = family.applicability
    .filter((scope) => enabled.has(scope.kind))
    .map((scope) => taxonomyScopeLabel(scope.kind, scope.level));

  // Derived
  const mergeItem = mergeItemId
    ? (items.find((i) => i.id === mergeItemId) ??
      (actionItem?.id === mergeItemId ? actionItem : null))
    : null;
  const deleteItem = deleteItemId
    ? (items.find((i) => i.id === deleteItemId) ??
      (actionItem?.id === deleteItemId ? actionItem : null))
    : null;

  const withoutSearch = new URLSearchParams(params.toString());
  withoutSearch.delete("q");
  const clearSearchHref = firstPageHref(
    `/taxonomy/${family.slug}`,
    withoutSearch,
  );

  // Filter & sort items
  const processedItems = useMemo(() => {
    if (serverPaged) return items;
    let result = [...items];

    // Search filter
    // Accents, case and punctuation ignored, as every search (SLN-881)
    if (searchQuery.trim()) {
      result = result.filter(
        (item) => searchScore(searchQuery, item.name) >= 0,
      );
    }

    // Sort
    switch (sortMode) {
      case "alphabetical":
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "most-used":
        result.sort((a, b) => b.entityCount - a.entityCount);
        break;
      case "manual":
      default:
        // Keep original order (sortOrder from server)
        break;
    }

    return result;
  }, [items, searchQuery, sortMode, serverPaged]);

  // Refresh data after mutations
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  // ── Action handlers ──────────────────────────────────────────────────────

  const handleReorder = useCallback(
    async (ids: string[]) => {
      try {
        const { reorderTaxonomyItems } =
          await import("@/lib/actions/taxonomy-client");
        await reorderTaxonomyItems(family.slug, ids);
        refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to reorder items";
        toast.error(message);
      }
    },
    [family.slug, refresh],
  );

  const handleMove = useCallback(
    async (itemId: string, newParentId: string | null) => {
      try {
        const { moveTaxonomyItem } =
          await import("@/lib/actions/taxonomy-client");
        await moveTaxonomyItem(family.slug, itemId, newParentId);
        refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to move item";
        toast.error(message);
      }
    },
    [family.slug, refresh],
  );

  const handleColorChange = useCallback(
    async (id: string, color: string | null) => {
      try {
        const { updateTaxonomyItem } =
          await import("@/lib/actions/taxonomy-client");
        await updateTaxonomyItem(family.slug, id, { color });
        refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to update color";
        toast.error(message);
      }
    },
    [family.slug, refresh],
  );

  const handleRename = useCallback(
    async (id: string, name: string) => {
      try {
        const { updateTaxonomyItem } =
          await import("@/lib/actions/taxonomy-client");
        await updateTaxonomyItem(family.slug, id, { name });
        toast.success(`Renamed to "${name}"`);
        refresh();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to rename item";
        toast.error(message);
      }
    },
    [family.slug, refresh],
  );

  async function openEditor(action: () => void) {
    if (!serverPaged) {
      setChoices(items);
      action();
      return;
    }
    try {
      setChoices(await getTaxonomyEditorChoices(family.slug));
      action();
    } catch {
      toast.error("Could not load the family’s items. Try again.");
    }
  }
  const handleDelete = (id: string, item?: TaxonomyItemData) => {
    setActionItem(item ?? null);
    void openEditor(() => setDeleteItemId(id));
  };
  const handleMerge = (id: string, item?: TaxonomyItemData) => {
    setActionItem(item ?? null);
    void openEditor(() => setMergeItemId(id));
  };
  const loadChildren = useCallback(
    async (parent: string, offset: number) => {
      const result = await getTaxonomyBrowsePage(
        family.slug,
        { sort: sortMode, perPage: "48" },
        parent,
        offset,
      );
      return {
        items: (result?.items ?? []).map((i) => ({
          ...i,
          slug: i.slug ?? i.id,
        })),
        total: result?.total ?? 0,
      };
    },
    [family.slug, sortMode],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Back link */}
      <Link
        href="/taxonomy"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        Taxonomy
      </Link>

      {/* Family header */}
      <div className="mb-8">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div>
            {/* The badge and the dot follow the name's last word on its cap
                height, so the name never breaks to make room for them; with
                no room after it they take the next line, on the text's edge:
                the gap is a space, which a line start drops (SLN-879). An
                inline box holding only a float takes its bottom edge as its
                baseline, as CapAligned's does, and clips nothing */}
            <div className="type-page-title">
              <h1 className="type-page-title inline [overflow-wrap:anywhere]">
                {family.name}
              </h1>
              {family.isSystem && " "}
              {family.isSystem && (
                <span className="inline-block h-5 -my-2.5 align-[0.5cap]">
                  <span className="float-left flex h-5 items-center">
                    <Badge variant="muted">System</Badge>
                  </span>
                </span>
              )}
              {family.color && " "}
              {family.color && (
                <span className="inline-block h-3 -my-1.5 align-[0.5cap]">
                  <span
                    className="float-left block h-3 w-3 rounded-full"
                    style={{ backgroundColor: family.color }}
                  />
                </span>
              )}
            </div>
            {family.description && (
              <p className="mt-1.5 text-sm text-fg-secondary">
                {family.description}
              </p>
            )}
            <p className="mt-1 font-mono text-xs text-fg-secondary">
              {/* With no items, no count line over nothing (SLN-842) */}
              {(browse?.familyTotal ?? items.length) > 0 && (
                <>
                  {browse?.familyTotal ?? items.length} item
                  {(browse?.familyTotal ?? items.length) === 1 ? "" : "s"}
                  {" · "}
                </>
              )}
              {scopeLabels.join(", ")}
              {family.hierarchical ? " · hierarchical" : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFamilyDialog("edit")}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
              Edit
            </Button>
            {!family.isSystem && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFamilyDialog("delete")}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar: with no items, none over nothing; the empty state has the one Add (SLN-842) */}
      {(browse?.familyTotal ?? items.length) > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
              strokeWidth={1.5}
            />
            <input
              ref={searchRef}
              type="text"
              data-list-focus="search"
              data-shortcut-search=""
              aria-keyshortcuts="/"
              value={searchQuery}
              onChange={(e) => typeFilter(e.target.value)}
              placeholder="Filter items…"
              aria-label="Filter items"
              className="h-8 pointer-coarse:h-11 w-full rounded-sm border border-glass-border bg-bg-primary/80 pl-8 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-primary focus:outline-none"
            />
          </div>

          {/* Sort dropdown */}
          <select
            aria-label="Sort"
            value={sortMode}
            onChange={(e) => setFilter("sort", e.target.value)}
            className="h-8 pointer-coarse:h-11 rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-sm text-fg-secondary transition-colors focus:border-accent-primary focus:outline-none"
          >
            {family.manualOrdering !== false && (
              <option value="manual">Manual order</option>
            )}
            <option value="alphabetical">Alphabetical</option>
            <option value="most-used">Most used</option>
          </select>

          {/* New item button */}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void openEditor(() => setCreateDialogOpen(true))}
            ref={newItemButton}
            data-focus-empty="taxonomy-items"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
            New item
          </Button>
        </div>
      )}

      {/* Loading indicator for transitions */}
      {isPending && (
        <div className="mb-2 text-xs text-fg-secondary">Updating…</div>
      )}

      {/* Tree / list */}
      {processedItems.length === 0 ? (
        (browse?.familyTotal ?? items.length) === 0 ? (
          <EmptyState
            icon={Tags}
            heading="h2"
            title="No items yet"
            // Say what it applies to: a family can be for editions, perfumes or paintings, not only works
            description={
              scopeLabels.length > 0
                ? `Each item is one value of ${family.name} for ${scopeLabels.join(", ").toLowerCase()}. Add the first, then choose it when you edit one.`
                : `Each item is one value of ${family.name}. Add the first, then choose it when you edit a record.`
            }
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => void openEditor(() => setCreateDialogOpen(true))}
                data-focus-empty="taxonomy-items"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                New item
              </Button>
            }
          />
        ) : (
          <NoResults
            noun="items"
            search={searchQuery}
            hasFilters={false}
            clearHref={clearSearchHref}
            onClear={clearFilter}
          />
        )
      ) : (
        <div className="rounded-sm border border-glass-border bg-bg-secondary/40">
          <TaxonomyTree
            items={processedItems}
            familySlug={family.slug}
            hierarchical={family.hierarchical && !searchQuery.trim()}
            paging={
              serverPaged
                ? {
                    page: browse.page,
                    perPage: browse.perPage,
                    total: browse.total,
                  }
                : undefined
            }
            loadChildren={
              serverPaged && !searchQuery.trim() ? loadChildren : undefined
            }
            canReorder={canReorder}
            entityNoun={family.entityLevel === "edition" ? "edition" : "work"}
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            onReorder={handleReorder}
            onMove={handleMove}
            onColorChange={handleColorChange}
            onRename={handleRename}
            onDelete={handleDelete}
            onMerge={handleMerge}
          />
        </div>
      )}

      {/* Create item dialog */}
      <CreateItemDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        familySlug={family.slug}
        familyName={family.name}
        hierarchical={family.hierarchical}
        existingItems={choices.map((i) => ({ id: i.id, name: i.name }))}
        onCreated={(id) => {
          if (items.length === 0) firstItem.current = id;
          refresh();
        }}
      />

      {/* Merge dialog */}
      {mergeItem && (
        <MergeDialog
          open={!!mergeItemId}
          onClose={() => setMergeItemId(null)}
          entityNoun={family.entityLevel}
          sourceItem={{
            id: mergeItem.id,
            name: mergeItem.name,
            entityCount: mergeItem.entityCount,
          }}
          familySlug={family.slug}
          availableTargets={taxonomyMergeTargets(mergeItem, choices).map(
            (i) => ({ id: i.id, name: i.name }),
          )}
          onMerged={refresh}
        />
      )}

      {/* Delete dialog */}
      {deleteItem && (
        <DeleteItemDialog
          open={!!deleteItemId}
          onClose={() => setDeleteItemId(null)}
          item={{
            id: deleteItem.id,
            name: deleteItem.name,
            entityCount: deleteItem.linkCount ?? deleteItem.entityCount,
            childCount:
              deleteItem.childCount ??
              items.filter((i) => i.parentId === deleteItem.id).length,
          }}
          familySlug={family.slug}
          availableReassignTargets={taxonomyMergeTargets(
            deleteItem,
            choices,
          ).map((i) => ({ id: i.id, name: i.name }))}
          onDeleted={refresh}
        />
      )}

      {familyDialog === "edit" && (
        <EditFamilyDialog
          family={family}
          nested={browse?.nested ?? items.some((item) => !!item.parentId)}
          onClose={() => setFamilyDialog(null)}
          onSaved={() => {
            setFamilyDialog(null);
            toast.success("Family saved");
            refresh();
          }}
        />
      )}
      {familyDialog === "delete" && (
        <DeleteFamilyDialog
          family={family}
          onClose={() => setFamilyDialog(null)}
          onDeleted={() => {
            toast.success(`Deleted ${family.name}`);
            router.replace("/taxonomy");
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
