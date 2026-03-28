"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpDown, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ColumnConfigDialog, type ColumnDef } from "./column-config-dialog";

export interface DetailedBookItem {
  workId: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  publisher?: string | null;
  binding?: string | null;
  pages?: number | null;
  isbn?: string | null;
  locationName?: string | null;
  format?: string | null;
  condition?: string | null;
  addedDate?: string | null;
}

export const ALL_COLUMNS: ColumnDef[] = [
  { key: "title", label: "Title", defaultVisible: true, defaultOrder: 0 },
  { key: "authorName", label: "Author", defaultVisible: true, defaultOrder: 1 },
  { key: "publicationYear", label: "Year", defaultVisible: true, defaultOrder: 2 },
  { key: "publisher", label: "Publisher", defaultVisible: true, defaultOrder: 3 },
  { key: "language", label: "Language", defaultVisible: false, defaultOrder: 4 },
  { key: "binding", label: "Binding", defaultVisible: false, defaultOrder: 5 },
  { key: "pages", label: "Pages", defaultVisible: false, defaultOrder: 6 },
  { key: "rating", label: "Rating", defaultVisible: true, defaultOrder: 7 },
  { key: "locationName", label: "Location", defaultVisible: false, defaultOrder: 8 },
  { key: "format", label: "Format", defaultVisible: false, defaultOrder: 9 },
  { key: "condition", label: "Condition", defaultVisible: false, defaultOrder: 10 },
  { key: "isbn", label: "ISBN", defaultVisible: false, defaultOrder: 11 },
  { key: "instanceCount", label: "Copies", defaultVisible: true, defaultOrder: 12 },
  { key: "addedDate", label: "Added", defaultVisible: false, defaultOrder: 13 },
];

interface BookDataTableProps {
  books: DetailedBookItem[];
  columns: { key: string; visible: boolean; order: number }[];
  onColumnsChange: (cols: { key: string; visible: boolean; order: number }[]) => void;
}

export function BookDataTable({
  books,
  columns,
  onColumnsChange,
}: BookDataTableProps) {
  const [sortKey, setSortKey] = useState<string>("title");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showConfig, setShowConfig] = useState(false);

  const visibleColumns = useMemo(
    () =>
      columns
        .filter((c) => c.visible)
        .sort((a, b) => a.order - b.order)
        .map((c) => ALL_COLUMNS.find((ac) => ac.key === c.key)!)
        .filter(Boolean),
    [columns],
  );

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => {
      const aVal = (a as any)[sortKey] ?? "";
      const bVal = (b as any)[sortKey] ?? "";
      const cmp = typeof aVal === "number" ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [books, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const renderCell = (book: DetailedBookItem, key: string) => {
    const val = (book as any)[key];
    switch (key) {
      case "title":
        return (
          <Link
            href={`/library/${book.workId}`}
            className="flex items-center gap-2 hover:text-accent-rose"
          >
            <div className="relative h-6 w-4 flex-shrink-0 overflow-hidden rounded-[1px] bg-bg-tertiary">
              {book.coverUrl ? (
                <Image src={book.coverUrl} alt="" fill sizes="16px" className="object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="text-[6px] text-fg-muted/40">{book.title[0]}</span>
                </div>
              )}
            </div>
            <span className="truncate">{book.title}</span>
          </Link>
        );
      case "rating":
        return val ? <Badge variant="gold">{val}/5</Badge> : null;
      case "language":
        return val && val !== "en" ? <Badge variant="blue">{val}</Badge> : val;
      case "binding":
      case "format":
      case "condition":
        return val ? <Badge variant="muted">{val}</Badge> : null;
      default:
        return val ?? "";
    }
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-bg-tertiary">
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
            {sortedBooks.map((book) => (
              <tr
                key={book.workId}
                className="border-b border-bg-tertiary/50 transition-colors hover:bg-bg-secondary"
              >
                {visibleColumns.map((col) => (
                  <td key={col.key} className="px-3 py-2 text-fg-secondary">
                    {renderCell(book, col.key)}
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
          allColumns={ALL_COLUMNS}
          onChange={onColumnsChange}
          onClose={() => setShowConfig(false)}
        />
      )}
    </>
  );
}
