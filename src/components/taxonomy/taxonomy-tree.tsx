"use client";

import { useSearchParams } from "next/navigation";
import { paginateItems } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CapAligned } from "@/components/shared/cap-aligned";
import { ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "@/lib/notifications/toast";
import { TaxonomyItemRow, type TaxonomyItemData } from "./taxonomy-item-row";

// ── Tree node type ──────────────────────────────────────────────────────────

interface TreeNode extends TaxonomyItemData {
  children: TreeNode[];
}

// ── Props ───────────────────────────────────────────────────────────────────

interface TaxonomyTreeProps {
  items: TaxonomyItemData[];
  familySlug: string;
  hierarchical: boolean;
  canReorder?: boolean;
  paging?: { page: number; perPage: number; total: number };
  loadChildren?: (
    parent: string,
    offset: number,
  ) => Promise<{ items: TaxonomyItemData[]; total: number }>;
  entityNoun?: string;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onReorder: (ids: string[]) => Promise<void>;
  onColorChange: (id: string, color: string | null) => Promise<void>;
  onRename: (id: string, name: string, item?: TaxonomyItemData) => Promise<void>;
  onDelete: (id: string, item?: TaxonomyItemData) => void;
  onMerge: (id: string, item?: TaxonomyItemData) => void;
  onEdit?: (id: string, item?: TaxonomyItemData) => void;
  onMoveTo?: (id: string, item?: TaxonomyItemData) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildTree(items: TaxonomyItemData[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Initialize all nodes
  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  // Build parent-child relationships
  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function flattenTree(
  nodes: TreeNode[],
  collapsedIds: Set<string>,
  depth = 0,
): { item: TaxonomyItemData; depth: number }[] {
  const result: { item: TaxonomyItemData; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ item: node, depth });
    if (node.children.length > 0 && !collapsedIds.has(node.id)) {
      result.push(...flattenTree(node.children, collapsedIds, depth + 1));
    }
  }
  return result;
}

// ── SortableRow wrapper ─────────────────────────────────────────────────────

interface SortableRowProps {
  item: TaxonomyItemData;
  familySlug: string;
  depth: number;
  isSelected: boolean;
  hasChildren: boolean;
  hierarchical: boolean;
  canReorder: boolean;
  entityNoun: string;
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string, item?: TaxonomyItemData) => void;
  onMerge: (id: string, item?: TaxonomyItemData) => void;
  onEdit?: (id: string) => void;
  onMoveTo?: (id: string) => void;
}

function SortableRow({
  item,
  familySlug,
  depth,
  isSelected,
  hasChildren,
  hierarchical,
  canReorder,
  entityNoun,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
  onEdit,
  onMoveTo,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, disabled: !canReorder });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} data-focus-row="">
      <div
        className="flex items-start text-sm leading-5 pointer-coarse:leading-11"
        style={{ paddingLeft: depth * 20 }}
      >
        {hierarchical && (
          <div className="w-5 shrink-0 pt-1.5 pointer-coarse:w-11 pointer-coarse:pt-0.5">
            {hasChildren ? (
              <CapAligned height={20} coarseHeight={44}>
                <button
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${item.name}`}
                  data-tooltip={isCollapsed ? "Expand" : "Collapse"}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse(item.id);
                  }}
                  className="flex h-5 w-5 items-center justify-center text-fg-muted hover:text-fg-secondary pointer-coarse:size-11"
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
                  ) : (
                    <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
                  )}
                </button>
              </CapAligned>
            ) : (
              <span
                aria-hidden="true"
                className="block h-5 pointer-coarse:h-11"
              />
            )}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <TaxonomyItemRow
            item={item}
            familySlug={familySlug}
            depth={0}
            entityNoun={entityNoun}
            isSelected={isSelected}
            onSelect={onSelect}
            onColorChange={onColorChange}
            onRename={onRename}
            onDelete={onDelete}
            onMerge={onMerge}
            onEdit={onEdit}
            onMoveTo={onMoveTo}
            dragHandleProps={
              canReorder
                ? { listeners, attributes, setActivatorNodeRef }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay row (non-interactive preview) ──────────────────────────────

function DragOverlayRow({ item }: { item: TaxonomyItemData }) {
  return (
    <div className="rounded-sm border border-accent-primary/30 bg-bg-secondary px-3 py-1.5 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2">
        {item.color && (
          <span
            className="block h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
        )}
        <span className="whitespace-normal break-words text-sm text-fg-primary">
          {item.name}
        </span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function TaxonomyTree({
  items,
  familySlug,
  hierarchical,
  paging: serverPaging,
  loadChildren,
  canReorder = true,
  entityNoun = "work",
  selectedIds,
  onSelectionChange,
  onReorder,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
  onEdit,
  onMoveTo,
}: TaxonomyTreeProps) {
  const searchParams = useSearchParams();
  const [branches, setBranches] = useState<
    Record<string, { items: TaxonomyItemData[]; total: number }>
  >({});
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setBranches({});
    setCollapsedIds(new Set());
    setLoading(null);
  }, [items]);
  const loadedItems = useMemo(
    () => [...items, ...Object.values(branches).flatMap((b) => b.items)],
    [items, branches],
  );
  async function fetchChildren(id: string, more = false) {
    if (!loadChildren || loading) return;
    const version = generation.current;
    setLoading(id);
    setError(null);
    try {
      const result = await loadChildren(
        id,
        more ? (branches[id]?.items.length ?? 0) : 0,
      );
      if (version !== generation.current) return;
      setBranches((prev) => ({
        ...prev,
        [id]: {
          items: more
            ? [...(prev[id]?.items ?? []), ...result.items]
            : result.items,
          total: result.total,
        },
      }));
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      setError("Could not load child items. Try expanding the item again.");
    } finally {
      if (version === generation.current) setLoading(null);
    }
  }
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Build the tree structure for hierarchical families
  const treeNodes = useMemo(
    () => (hierarchical ? buildTree(loadedItems) : []),
    [loadedItems, hierarchical],
  );

  // Map from id → TreeNode for checking children
  const treeNodeMap = useMemo(() => {
    const map = new Map<string, TreeNode>();
    function walk(nodes: TreeNode[]) {
      for (const n of nodes) {
        map.set(n.id, n);
        walk(n.children);
      }
    }
    walk(treeNodes);
    return map;
  }, [treeNodes]);

  // Flattened visible rows
  const visibleRows = useMemo(() => {
    if (!hierarchical) {
      // Flat mode: simple sortable list
      return loadedItems.map((item) => ({ item, depth: 0 }));
    }
    return flattenTree(
      treeNodes,
      new Set([
        ...collapsedIds,
        ...loadedItems
          .filter(
            (i) => loadChildren && (i.childCount ?? 0) > 0 && !branches[i.id],
          )
          .map((i) => i.id),
      ]),
    );
  }, [
    loadedItems,
    hierarchical,
    treeNodes,
    collapsedIds,
    branches,
    loadChildren,
  ]);

  const paging = serverPaging
    ? { ...serverPaging, items: visibleRows }
    : paginateItems(visibleRows, searchParams);

  const sortableIds = useMemo(
    () => visibleRows.map((r) => r.item.id),
    [visibleRows],
  );

  const toggleCollapse = (id: string) => {
    if (loadChildren && !branches[id]) {
      void fetchChildren(id);
      return;
    }
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (canReorder) setActiveId(event.active.id as string);
    },
    [canReorder],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!canReorder || !over || active.id === over.id) return;

      // A drag reorders an item among its siblings; a drop under another
      // parent is refused out loud, never a silent renumber (SLN-1158)
      const parentOf = new Map(visibleRows.map(({ item }) => [item.id, item.parentId ?? null]));
      const parent = parentOf.get(active.id as string);
      if (parent === undefined || !parentOf.has(over.id as string)) return;
      if (parentOf.get(over.id as string) !== parent) {
        toast.error(
          onMoveTo
            ? "A drag keeps an item among its siblings. Use Move to… to put it under another item."
            : "A drag keeps an item among its siblings.",
        );
        return;
      }
      const siblings = sortableIds.filter((id) => parentOf.get(id) === parent);
      const oldIndex = siblings.indexOf(active.id as string);
      const newIndex = siblings.indexOf(over.id as string);
      onReorder(arrayMove(siblings, oldIndex, newIndex));
    },
    [sortableIds, visibleRows, onReorder, onMoveTo, canReorder],
  );

  const activeItem = activeId
    ? (items.find((i) => i.id === activeId) ?? null)
    : null;

  if (visibleRows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-fg-secondary">
          No items in this family yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p role="alert" className="p-3 text-sm text-accent-red-text">
          {error}
        </p>
      )}
      <PaginatedSection {...paging} noun="items" hideSingleSummary>
        <DndContext
          // A fixed id: dnd-kit's own counter gives the server and the browser
          // different aria-describedby ids, a hydration mismatch on every row
          id="taxonomy-tree"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sortableIds}
            strategy={verticalListSortingStrategy}
          >
            {/* A merged or deleted row hands the focus to the same control of
            the next row, else New item (FocusKeeper, SLN-920) */}
            {/* The list's width decides, for every row at once, whether names
                keep their line beside the controls (taxonomy-item-row) */}
            <div className="@container/taxonomy-tree divide-y-0" data-focus-list="taxonomy-items">
              {paging.items.map(({ item, depth }) => {
                const treeNode = treeNodeMap.get(item.id);
                const hasChildren = treeNode
                  ? treeNode.children.length > 0 ||
                    (treeNode.childCount ?? 0) > 0
                  : false;
                return (
                  <div key={item.id}>
                    <SortableRow
                      key={item.id}
                      item={item}
                      familySlug={familySlug}
                      depth={depth}
                      isSelected={selectedIds.has(item.id)}
                      hasChildren={hasChildren}
                      hierarchical={hierarchical}
                      canReorder={canReorder}
                      entityNoun={entityNoun}
                      isCollapsed={
                        collapsedIds.has(item.id) ||
                        (!!loadChildren && !branches[item.id])
                      }
                      onToggleCollapse={toggleCollapse}
                      onSelect={handleSelect}
                      onColorChange={(id, color) => {
                        onColorChange(id, color);
                      }}
                      onRename={(id, name) => {
                        onRename(id, name, item);
                      }}
                      onDelete={(id) => onDelete(id, item)}
                      onMerge={(id) => onMerge(id, item)}
                      onEdit={onEdit && ((id) => onEdit(id, item))}
                      onMoveTo={
                        hierarchical && onMoveTo
                          ? (id) => onMoveTo(id, item)
                          : undefined
                      }
                    />
                    {loading === item.id && (
                      <p
                        role="status"
                        className="px-3 py-2 text-sm text-fg-secondary"
                      >
                        Loading child items…
                      </p>
                    )}
                    {branches[item.id] &&
                      !collapsedIds.has(item.id) &&
                      branches[item.id].items.length <
                        branches[item.id].total && (
                        <button
                          type="button"
                          className="px-3 py-2 text-sm text-command touch-hit"
                          onClick={() => void fetchChildren(item.id, true)}
                          disabled={!!loading}
                        >
                          More child items of {item.name}
                        </button>
                      )}
                  </div>
                );
              })}
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeItem ? <DragOverlayRow item={activeItem} /> : null}
          </DragOverlay>
        </DndContext>
      </PaginatedSection>
    </div>
  );
}
