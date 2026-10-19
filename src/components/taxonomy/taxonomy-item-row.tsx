"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  GripVertical,
  MoreHorizontal,
  Pencil,
  Merge,
  Trash2,
  SlidersHorizontal,
  FolderInput,
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
import { CapAligned, CapAlignedControls } from "@/components/shared/cap-aligned";
import { Badge } from "@/components/ui/badge";
import { TaxonomyColorPicker } from "./taxonomy-color-picker";

export interface TaxonomyItemData {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  entityCount: number;
  linkCount?: number;
  childCount?: number;
  parentId?: string | null;
  sortOrder?: number;
}

interface TaxonomyItemRowProps {
  item: TaxonomyItemData;
  familySlug: string;
  depth: number;
  entityNoun?: string;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onColorChange: (id: string, color: string | null) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMerge: (id: string) => void;
  /** Opens Edit item: name, colour, description, parent (SLN-1158) */
  onEdit?: (id: string) => void;
  /** Opens Move to…; only in a family with a hierarchy */
  onMoveTo?: (id: string) => void;
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
  entityNoun = "work",
  isSelected,
  onSelect,
  onColorChange,
  onRename,
  onDelete,
  onMerge,
  onEdit,
  onMoveTo,
  dragHandleProps,
}: TaxonomyItemRowProps) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(item.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLAnchorElement>(null);
  // Enter or Esc ends a rename on its name, not on the page
  const refocus = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else if (!editing && refocus.current) {
      refocus.current = false;
      nameRef.current?.focus();
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
      className="action-icon-sm opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100"
    >
      <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
    </button>
  );

  return (
    <div
      className={`group flex min-h-9 flex-wrap items-start gap-1.5 py-1.5 text-sm leading-5 border-b border-glass-border/40 px-2 transition-colors pointer-coarse:min-h-12 pointer-coarse:py-0.5 pointer-coarse:leading-11 ${
        isSelected
          ? "bg-accent-primary/6 border-accent-primary/10"
          : "hover:bg-bg-tertiary/30"
      }`}
      onClick={() => onSelect(item.id)}
    >
      {/* Drag handle */}
      <CapAligned height={24} coarseHeight={44}>
      {dragHandleProps ? <div
        ref={dragHandleProps?.setActivatorNodeRef}
        className="flex h-6 w-4 flex-shrink-0 cursor-grab items-center justify-center text-fg-muted opacity-0 transition-opacity group-hover:opacity-60 focus-visible:opacity-100 active:cursor-grabbing pointer-coarse:size-11 pointer-coarse:opacity-60"
        {...dragHandleProps?.listeners}
        {...dragHandleProps?.attributes}
        aria-label={`Reorder ${item.name}`}
      >
        <GripVertical className="h-3 w-3" strokeWidth={1.5} />
      </div> : <span aria-hidden="true" className="block h-6 w-4 pointer-coarse:size-11" />}
      </CapAligned>

      {/* Indent */}
      {depth > 0 && (
        <div
          className="flex-shrink-0"
          style={{ width: `${depth * 20}px` }}
        />
      )}

      {/* Color dot */}
      <CapAlignedControls height={20} coarseHeight={44}>
        <TaxonomyColorPicker
          label={`Pick color for ${item.name}`}
          value={item.color}
          onChange={(color) => onColorChange(item.id, color)}
        />
      </CapAlignedControls>

      {/* Name. In a list too narrow to keep it room beside its controls (a
          phone, where each control is 44px), every name takes its own line
          above them, so words never break letter by letter; the whole list
          switches together, so a child never starts left of its parent */}
      <div className="min-w-0 flex-1 pointer-coarse:@max-[26rem]/taxonomy-tree:order-first pointer-coarse:@max-[26rem]/taxonomy-tree:basis-full not-pointer-coarse:@max-[20rem]/taxonomy-tree:order-first not-pointer-coarse:@max-[20rem]/taxonomy-tree:basis-full">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                refocus.current = true;
                commitRename();
              }
              if (e.key === "Escape") {
                // One layer per Esc: the rename only
                e.preventDefault();
                refocus.current = true;
                cancelRename();
              }
            }}
            className="h-6 w-full rounded-sm border border-accent-primary/40 bg-bg-primary/80 px-1.5 text-sm text-fg-primary outline-none pointer-coarse:h-11"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <Link
            ref={nameRef}
            data-taxonomy-item-name={item.id}
            href={`/taxonomy/${familySlug}/${item.slug}`}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startRename();
            }}
            // The text command's colour and underline (SLN-1195), without its touch growth: the row gives the 44px
            className="block whitespace-normal break-words text-sm leading-5 text-accent-primary underline decoration-current/45 decoration-1 underline-offset-[0.2em] transition-colors hover:text-fg-primary hover:decoration-current pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:py-3"
          >
            {item.name}
          </Link>
        )}
      </div>

      {/* Entity count: it and the menu keep the row's end when the name
          takes its own line */}
      <CapAligned height={20} coarseHeight={44} className="ml-auto">
        <span className="flex h-5 items-center pointer-coarse:h-11">
        <Badge variant="muted" className="flex-shrink-0" aria-label={`${item.entityCount} ${entityNoun}${item.entityCount === 1 ? "" : "s"}`}>
          {item.entityCount}
        </Badge>
        </span>
      </CapAligned>

      {/* Action menu */}
      <CapAlignedControls height={24} coarseHeight={44}>
      <DropdownMenu trigger={trigger} label={`Actions for ${item.name}`} align="end">
        <DropdownMenuItem
          onClick={() => {
            startRename();
          }}
          icon={<Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          Rename
        </DropdownMenuItem>
        {onEdit && (
          <DropdownMenuItem
            onClick={() => onEdit(item.id)}
            icon={<SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />}
          >
            Edit…
          </DropdownMenuItem>
        )}
        {onMoveTo && (
          <DropdownMenuItem
            onClick={() => onMoveTo(item.id)}
            icon={<FolderInput className="h-3.5 w-3.5" strokeWidth={1.5} />}
          >
            Move to…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => onMerge(item.id)}
          icon={<Merge className="h-3.5 w-3.5" strokeWidth={1.5} />}
        >
          Merge into…
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
      </CapAlignedControls>
    </div>
  );
}
