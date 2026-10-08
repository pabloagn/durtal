"use client";

import { useState, useMemo, type ReactNode } from "react";
import { ArrowUpDown, Settings2 } from "lucide-react";
import {
  ColumnConfigDialog,
  type ColumnDef,
} from "@/components/books/column-config-dialog";
import { withNewColumns } from "@/lib/utils/column-config";

export interface ColumnConfig {
  key: string;
  visible: boolean;
  order: number;
}

export type { ColumnDef };

interface DataTableProps<T> {
  items: T[];
  itemKey: (item: T) => string;
  allColumns: ColumnDef[];
  columns: ColumnConfig[];
  onColumnsChange: (cols: ColumnConfig[]) => void;
  renderCell: (item: T, columnKey: string) => ReactNode;
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  /** Keep the given (server) order until a column header is clicked */
  preserveOrder?: boolean;
  getSortValue?: (item: T, key: string) => string | number;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (id: string) => void;
}

export function DataTable<T>({
  items,
  itemKey,
  allColumns,
  columns,
  onColumnsChange,
  renderCell,
  defaultSortKey,
  defaultSortDir = "asc",
  preserveOrder = false,
  getSortValue,
  isSelecting = false,
  selectedIds,
  onSelect,
}: DataTableProps<T>) {
  const resolvedSortKey = preserveOrder
    ? ""
    : (defaultSortKey ?? allColumns[0]?.key ?? "");
  const [sortKey, setSortKey] = useState(resolvedSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [showConfig, setShowConfig] = useState(false);

  // A saved choice picks up the columns added since it was saved
  const allChosen = useMemo(() => withNewColumns(columns, allColumns), [columns, allColumns]);
  const visibleColumns = useMemo(
    () =>
      allChosen
        .filter((c) => c.visible)
        .sort((a, b) => a.order - b.order)
        .map((c) => allColumns.find((ac) => ac.key === c.key)!)
        .filter(Boolean),
    [allChosen, allColumns],
  );

  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a, b) => {
      const aVal = getSortValue
        ? getSortValue(a, sortKey)
        : ((a as Record<string, unknown>)[sortKey] ?? "");
      const bVal = getSortValue
        ? getSortValue(b, sortKey)
        : ((b as Record<string, unknown>)[sortKey] ?? "");
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [items, sortKey, sortDir, getSortValue]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-glass-border">
              {isSelecting && <th className="w-10 px-3 py-2" />}
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="cursor-pointer px-3 py-2 font-normal text-fg-secondary transition-colors hover:text-fg-primary"
                  onClick={() => toggleSort(col.key)}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <ArrowUpDown className="h-3 w-3" strokeWidth={1.5} />
                    )}
                  </div>
                </th>
              ))}
              {/* On touch the button itself is 44px: a press area drawn past it would be cut by the scrolling table */}
              <th className="px-2 py-2 pointer-coarse:p-0">
                <button
                  aria-label="Configure columns"
                  data-tooltip="Configure columns"
                  onClick={() => setShowConfig(true)}
                  className="text-fg-muted transition-colors hover:text-fg-secondary pointer-coarse:flex pointer-coarse:size-11 pointer-coarse:items-center pointer-coarse:justify-center"
                >
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => {
              const id = itemKey(item);
              const isSelected = selectedIds?.has(id) ?? false;

              return (
              <tr
                key={id}
                className={`border-b border-glass-border/50 transition-colors hover:bg-bg-secondary ${isSelecting ? "cursor-pointer" : ""} ${isSelected ? "bg-accent-primary/5" : ""}`}
                onClick={isSelecting && onSelect ? () => onSelect(id) : undefined}
              >
                {isSelecting && (
                  <td className="px-3 py-2">
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-sm border transition-colors ${
                        isSelected
                          ? "border-accent-primary bg-selection-bg text-fg-primary"
                          : "border-glass-border bg-overlay text-transparent"
                      }`}
                    >
                      {isSelected && (
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 12 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                  </td>
                )}
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-fg-secondary">
                    {renderCell(item, col.key)}
                  </td>
                ))}
                <td />
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showConfig && (
        <ColumnConfigDialog
          columns={allChosen}
          allColumns={allColumns}
          onChange={onColumnsChange}
          onClose={() => setShowConfig(false)}
        />
      )}
    </>
  );
}
