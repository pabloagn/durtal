"use client";

import { useState, useCallback, useEffect } from "react";

interface UseLibrarySelectionReturn {
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

export function useLibrarySelection(): UseLibrarySelectionReturn {
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

  // Escape exits selection mode
  useEffect(() => {
    if (!isSelecting) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsSelecting(false);
        setSelectedIds(new Set());
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
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
