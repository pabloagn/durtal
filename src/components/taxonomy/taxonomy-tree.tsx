"use client";

import { useSearchParams } from "next/navigation";
import { paginateItems } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { useState, useMemo, useCallback } from "react";
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
import { ChevronRight, ChevronDown } from "lucide-react";
import {
  TaxonomyItemRow,
  type TaxonomyItemData,
} from "./taxonomy-item-row";

// ── Tree node type ──────────────────────────────────────────────────────────

interface TreeNode extends TaxonomyItemData {
  children: TreeNode[];
}

// ── Props ───────────────────────────────────────────────────────────────────

interface TaxonomyTreeProps {
  items: TaxonomyItemData[];
  familySlug: string;
  hierarchical: boolean;
  selectedIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  onReorder: (ids: string[]) => Promise<void>;
  onMove: (itemId: string, newParentId: string | null) => Promise<void>;
  onColorChange: (id: string, color: string | null) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => void;
  onMerge: (id: string) => void;
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

  // Sort children by sortOrder
  function sortChildren(nodes: TreeNode[]) {
    nodes.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

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
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  onSelect: (id: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMerge: (id: string) => void;
}

function SortableRow({
  item,
  familySlug,
  depth,
  isSelected,
  hasChildren,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="flex items-center">
        {/* Collapse toggle for hierarchical items */}
        {depth >= 0 && hasChildren && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(item.id);
            }}
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-fg-muted transition-colors hover:text-fg-secondary"
            style={{ marginLeft: `${depth * 20}px` }}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" strokeWidth={1.5} />
            ) : (
              <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
            )}
          </button>
        )}
        <div className="min-w-0 flex-1">
          <TaxonomyItemRow
            item={item}
            familySlug={familySlug}
            depth={hasChildren ? 0 : depth}
            isSelected={isSelected}
            onSelect={onSelect}
            onColorChange={onColorChange}
            onRename={onRename}
            onDelete={onDelete}
            onMerge={onMerge}
            dragHandleProps={{
              listeners,
              attributes,
              setActivatorNodeRef,
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Drag overlay row (non-interactive preview) ──────────────────────────────

function DragOverlayRow({ item }: { item: TaxonomyItemData }) {
  return (
    <div className="rounded-sm border border-accent-rose/30 bg-bg-secondary px-3 py-1.5 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2">
        {item.color && (
          <span
            className="block h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
        )}
        <span className="truncate text-sm text-fg-primary">{item.name}</span>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function TaxonomyTree({
  items,
  familySlug,
  hierarchical,
  selectedIds,
  onSelectionChange,
  onReorder,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
}: TaxonomyTreeProps) {
  const searchParams = useSearchParams();
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
    () => (hierarchical ? buildTree(items) : []),
    [items, hierarchical],
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
      const sorted = [...items].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
      );
      return sorted.map((item) => ({ item, depth: 0 }));
    }
    return flattenTree(treeNodes, collapsedIds);
  }, [items, hierarchical, treeNodes, collapsedIds]);

  const paging = paginateItems(visibleRows, searchParams);

  const sortableIds = useMemo(
    () => visibleRows.map((r) => r.item.id),
    [visibleRows],
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback(
    (id: string) => {
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [selectedIds, onSelectionChange],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortableIds.indexOf(active.id as string);
      const newIndex = sortableIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(sortableIds, oldIndex, newIndex);
      onReorder(reordered);
    },
    [sortableIds, onReorder],
  );

  const activeItem = activeId
    ? items.find((i) => i.id === activeId) ?? null
    : null;

  if (visibleRows.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-sm text-fg-muted">No items in this family yet.</p>
      </div>
    );
  }

  return (
    <PaginatedSection {...paging} noun="items">
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortableIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="divide-y-0">
          {paging.items.map(({ item, depth }) => {
            const treeNode = treeNodeMap.get(item.id);
            const hasChildren = treeNode
              ? treeNode.children.length > 0
              : false;
            return (
              <SortableRow
                key={item.id}
                item={item}
                familySlug={familySlug}
                depth={depth}
                isSelected={selectedIds.has(item.id)}
                hasChildren={hasChildren}
                isCollapsed={collapsedIds.has(item.id)}
                onToggleCollapse={toggleCollapse}
                onSelect={handleSelect}
                onColorChange={(id, color) => {
                  onColorChange(id, color);
                }}
                onRename={(id, name) => {
                  onRename(id, name);
                }}
                onDelete={onDelete}
                onMerge={onMerge}
              />
            );
          })}
        </div>
      </SortableContext>

      <DragOverlay dropAnimation={null}>
        {activeItem ? <DragOverlayRow item={activeItem} /> : null}
      </DragOverlay>
    </DndContext>
    </PaginatedSection>
  );
}
