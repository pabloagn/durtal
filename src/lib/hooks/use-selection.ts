"use client";

import { useState, useCallback, useEffect } from "react";

export interface Selection {
  selectedIds: Set<string>;
  isSelecting: boolean;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  deselectAll: () => void;
  enterSelectionMode: () => void;
  exitSelectionMode: () => void;
  isSelected: (id: string) => boolean;
  selectionCount: number;
}

/**
 * A list's selection mode: which records are chosen, and the mode itself.
 * Escape leaves the mode and clears the choice, once nothing above the list
 * takes it (one layer per Esc). One hook for every list.
 */
export function useSelection(): Selection {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    setIsSelecting(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setIsSelecting(false);
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  // Escape exits selection mode, unless an open dialog takes it or a menu has handled it.
  // On the window: it runs after the document's listeners, where the menus mark theirs.
  useEffect(() => {
    if (!isSelecting) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      setIsSelecting(false);
      setSelectedIds(new Set());
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isSelecting]);

  return {
    selectedIds,
    isSelecting,
    toggleSelection,
    selectAll,
    deselectAll,
    enterSelectionMode,
    exitSelectionMode,
    isSelected,
    selectionCount: selectedIds.size,
  };
}
