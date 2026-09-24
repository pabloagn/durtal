"use client";

import { useState, useMemo, useCallback, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Search, Tags } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  TaxonomyTree,
} from "@/components/taxonomy/taxonomy-tree";
import type { TaxonomyItemData } from "@/components/taxonomy/taxonomy-item-row";
import { CreateItemDialog } from "@/components/taxonomy/create-item-dialog";
import { MergeDialog } from "@/components/taxonomy/merge-dialog";
import { DeleteItemDialog } from "@/components/taxonomy/delete-item-dialog";

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
  sortOrder: number;
}

type SortMode = "manual" | "alphabetical" | "most-used";

// ── Props ──────────────────────────────────────────────────────────────────

interface TaxonomyFamilyShellProps {
  family: Family;
  items: TaxonomyItemData[];
}

// ── Component ──────────────────────────────────────────────────────────────

export function TaxonomyFamilyShell({
  family,
  items,
}: TaxonomyFamilyShellProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [mergeItemId, setMergeItemId] = useState<string | null>(null);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);

  // Derived
  const mergeItem = mergeItemId
    ? items.find((i) => i.id === mergeItemId) ?? null
    : null;
  const deleteItem = deleteItemId
    ? items.find((i) => i.id === deleteItemId) ?? null
    : null;

  // Filter & sort items
  const processedItems = useMemo(() => {
    let result = [...items];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => item.name.toLowerCase().includes(q));
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
  }, [items, searchQuery, sortMode]);

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
        const { reorderTaxonomyItems } = await import(
          "@/lib/actions/taxonomy-families"
        );
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
        const { moveTaxonomyItem } = await import(
          "@/lib/actions/taxonomy-families"
        );
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
        const { updateTaxonomyItem } = await import(
          "@/lib/actions/taxonomy-families"
        );
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
        const { updateTaxonomyItem } = await import(
          "@/lib/actions/taxonomy-families"
        );
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

  const handleDelete = useCallback((id: string) => {
    setDeleteItemId(id);
  }, []);

  const handleMerge = useCallback((id: string) => {
    setMergeItemId(id);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Back link */}
      <Link
        href="/taxonomy"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-fg-muted transition-colors hover:text-fg-secondary"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        Taxonomy
      </Link>

      {/* Family header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="font-serif text-4xl tracking-tight text-fg-primary">
                {family.name}
              </h1>
              {family.isSystem && <Badge variant="muted">System</Badge>}
              {family.color && (
                <span
                  className="block h-3 w-3 rounded-full"
                  style={{ backgroundColor: family.color }}
                />
              )}
            </div>
            {family.description && (
              <p className="mt-1.5 text-sm text-fg-secondary">
                {family.description}
              </p>
            )}
            <p className="mt-1 font-mono text-xs text-fg-muted">
              {items.length} item{items.length === 1 ? "" : "s"}
              {" · "}
              {family.entityLevel} level
              {family.hierarchical ? " · hierarchical" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
            strokeWidth={1.5}
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter items..."
            className="h-8 w-full rounded-sm border border-glass-border bg-bg-primary/80 pl-8 pr-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
          />
        </div>

        {/* Sort dropdown */}
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="h-8 rounded-sm border border-glass-border bg-bg-primary/80 px-2 text-sm text-fg-secondary transition-colors focus:border-accent-rose focus:outline-none"
        >
          <option value="manual">Manual order</option>
          <option value="alphabetical">Alphabetical</option>
          <option value="most-used">Most used</option>
        </select>

        {/* New item button */}
        <Button
          variant="primary"
          size="sm"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
          New item
        </Button>
      </div>

      {/* Loading indicator for transitions */}
      {isPending && (
        <div className="mb-2 text-xs text-fg-muted">Updating...</div>
      )}

      {/* Tree / list */}
      {processedItems.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            icon={Tags}
            title="No items yet"
            description={`Add items to the ${family.name} taxonomy to start classifying your ${family.entityLevel}s`}
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
                New item
              </Button>
            }
          />
        ) : (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-fg-muted">
              No items matching &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        )
      ) : (
        <div className="rounded-sm border border-glass-border bg-bg-secondary/40">
          <TaxonomyTree
            items={processedItems}
            familySlug={family.slug}
            hierarchical={family.hierarchical}
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
        existingItems={items.map((i) => ({ id: i.id, name: i.name }))}
        onCreated={refresh}
      />

      {/* Merge dialog */}
      {mergeItem && (
        <MergeDialog
          open={!!mergeItemId}
          onClose={() => setMergeItemId(null)}
          sourceItem={{
            id: mergeItem.id,
            name: mergeItem.name,
            entityCount: mergeItem.entityCount,
          }}
          familySlug={family.slug}
          availableTargets={items
            .filter((i) => i.id !== mergeItem.id)
            .map((i) => ({ id: i.id, name: i.name }))}
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
            entityCount: deleteItem.entityCount,
          }}
          familySlug={family.slug}
          availableReassignTargets={items
            .filter((i) => i.id !== deleteItem.id)
            .map((i) => ({ id: i.id, name: i.name }))}
          onDeleted={refresh}
        />
      )}
    </div>
  );
}
