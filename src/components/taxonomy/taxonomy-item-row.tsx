"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  GripVertical,
  MoreHorizontal,
  Pencil,
  Merge,
  Trash2,
} from "lucide-react";
import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";

export interface TaxonomyItemData {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  entityCount: number;
  parentId?: string | null;
  sortOrder?: number;
}

interface TaxonomyItemRowProps {
  item: TaxonomyItemData;
  familySlug: string;
  depth: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMerge: (id: string) => void;
  /** Forwarded props from useSortable for drag handle */
  dragHandleProps?: {
    listeners?: DraggableSyntheticListeners;
    attributes?: DraggableAttributes;
    setActivatorNodeRef?: (node: HTMLElement | null) => void;
  };
}

export function TaxonomyItemRow({
  item,
  familySlug,
  depth,
  isSelected,
  onSelect,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
  dragHandleProps,
}: TaxonomyItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.name) {
      onRename(item.id, trimmed);
    }
    setEditing(false);
  }, [editName, item.id, item.name, onRename]);

  const cancelRename = useCallback(() => {
    setEditName(item.name);
    setEditing(false);
  }, [item.name]);

  const startRename = useCallback(() => {
    setEditName(item.name);
    setEditing(true);
  }, [item.name]);

  const trigger = (
    <button
      aria-label="Open action menu"
      className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted opacity-0 transition-all group-hover:opacity-100 hover:bg-bg-tertiary hover:text-fg-primary focus:opacity-100"
    >
      <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />
    </button>
  );

  return (
    <div
      className={`group flex h-9 items-center gap-1.5 border-b border-glass-border/40 px-2 transition-colors ${
        isSelected
          ? "bg-accent-rose/6 border-accent-rose/10"
          : "hover:bg-bg-tertiary/30"
      }`}
      onClick={() => onSelect(item.id)}
    >
      {/* Drag handle */}
      <div
        ref={dragHandleProps?.setActivatorNodeRef}
        className="flex h-6 w-4 flex-shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-0 transition-opacity group-hover:opacity-60 active:cursor-grabbing"
        {...dragHandleProps?.listeners}
        {...dragHandleProps?.attributes}
      >
        <GripVertical className="h-3 w-3" strokeWidth={1.5} />
      </div>

      {/* Indent */}
      {depth > 0 && (
        <div
          className="flex-shrink-0"
          style={{ width: `${depth * 20}px` }}
        />
      )}

      {/* Color dot */}
      <TaxonomyColorPicker
        value={item.color}
        onChange={(color) => onColorChange(item.id, color)}
      />

      {/* Name */}
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") cancelRename();
            }}
            className="h-6 w-full rounded-sm border border-accent-rose/40 bg-bg-primary/80 px-1.5 text-sm text-fg-primary outline-none"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <Link
            href={`/taxonomy/${familySlug}/${item.slug}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startRename();
            }}
            className="block truncate text-sm text-fg-primary transition-colors hover:text-accent-rose"
          >
            {item.name}
          </Link>
        )}
      </div>

      {/* Entity count */}
      <Badge variant="muted" className="flex-shrink-0">
        {item.entityCount}
      </Badge>

      {/* Action menu */}
      <DropdownMenu trigger={trigger} align="end">
        <DropdownMenuItem
          onClick={() => {
            startRename();
          }}
          icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onMerge(item.id)}
          icon={<Merge className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          Merge into...
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => onDelete(item.id)}
          variant="danger"
          icon={<Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenu>
    </div>
  );
}
