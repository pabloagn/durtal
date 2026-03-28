"use client";

import { useState, useMemo, type ReactNode } from "react";
import { ArrowUpDown, Settings2 } from "lucide-react";
import {
  ColumnConfigDialog,
  type ColumnDef,
} from "@/components/books/column-config-dialog";

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
  getSortValue?: (item: T, key: string) => string | number;
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
  getSortValue,
}: DataTableProps<T>) {
  const resolvedSortKey = defaultSortKey ?? allColumns[0]?.key ?? "";
  const [sortKey, setSortKey] = useState(resolvedSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [showConfig, setShowConfig] = useState(false);

  const visibleColumns = useMemo(
    () =>
      columns
        .filter((c) => c.visible)
        .sort((a, b) => a.order - b.order)
        .map((c) => allColumns.find((ac) => ac.key === c.key)!)
        .filter(Boolean),
    [columns, allColumns],
  );

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const aVal = getSortValue
        ? getSortValue(a, sortKey)
        : ((a as any)[sortKey] ?? "");
      const bVal = getSortValue
        ? getSortValue(b, sortKey)
        : ((b as any)[sortKey] ?? "");
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
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  className="cursor-pointer px-3 py-2 font-normal text-fg-muted transition-colors hover:text-fg-secondary"
                  onClick={() => toggleSort(col.key)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <ArrowUpDown className="h-3 w-3" strokeWidth={1.5} />
                    )}
                  </div>
                </th>
              ))}
              <th className="px-2 py-2">
                <button
                  onClick={() => setShowConfig(true)}
                  className="text-fg-muted transition-colors hover:text-fg-secondary"
                >
                  <Settings2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedItems.map((item) => (
              <tr
                key={itemKey(item)}
                className="border-b border-glass-border/50 transition-colors hover:bg-bg-secondary"
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-fg-secondary">
                    {renderCell(item, col.key)}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showConfig && (
        <ColumnConfigDialog
          columns={columns}
          allColumns={allColumns}
          onChange={onColumnsChange}
          onClose={() => setShowConfig(false)}
        />
      )}
    </>
  );
}
