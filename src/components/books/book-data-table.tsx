"use client";

import Link from "next/link";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/data-table";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import type { CatalogueStatus } from "@/lib/types";

const STATUS_CONFIG: Record<CatalogueStatus, { label: string; variant: "muted" | "blue" | "gold" | "rose" | "sage" | "red" }> = {
  tracked: { label: "Tracked", variant: "muted" },
  shortlisted: { label: "Shortlisted", variant: "blue" },
  wanted: { label: "Wanted", variant: "gold" },
  on_order: { label: "On Order", variant: "rose" },
  accessioned: { label: "Accessioned", variant: "sage" },
  deaccessioned: { label: "Deaccessioned", variant: "red" },
};

export interface DetailedBookItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  coverUrl?: string | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
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
  { key: "catalogueStatus", label: "Status", defaultVisible: true, defaultOrder: 2 },
  { key: "publicationYear", label: "Year", defaultVisible: true, defaultOrder: 3 },
  { key: "publisher", label: "Publisher", defaultVisible: true, defaultOrder: 4 },
  { key: "language", label: "Language", defaultVisible: false, defaultOrder: 5 },
  { key: "binding", label: "Binding", defaultVisible: false, defaultOrder: 6 },
  { key: "pages", label: "Pages", defaultVisible: false, defaultOrder: 7 },
  { key: "rating", label: "Rating", defaultVisible: true, defaultOrder: 8 },
  { key: "locationName", label: "Location", defaultVisible: false, defaultOrder: 9 },
  { key: "format", label: "Format", defaultVisible: false, defaultOrder: 10 },
  { key: "condition", label: "Condition", defaultVisible: false, defaultOrder: 11 },
  { key: "isbn", label: "ISBN", defaultVisible: false, defaultOrder: 12 },
  { key: "instanceCount", label: "Copies", defaultVisible: true, defaultOrder: 13 },
  { key: "addedDate", label: "Added", defaultVisible: false, defaultOrder: 14 },
];

function renderBookCell(book: DetailedBookItem, key: string) {
  const val = (book as any)[key];
  switch (key) {
    case "title":
      return (
        <Link
          href={`/library/${book.slug}`}
          className="flex items-center gap-2 hover:text-accent-rose"
        >
          <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            {book.coverUrl ? (
              <Image src={book.coverUrl} alt="" fill sizes="56px" className="object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-xs text-fg-muted/40">{book.title[0]}</span>
              </div>
            )}
          </div>
          <span className="truncate">{book.title}</span>
        </Link>
      );
    case "catalogueStatus": {
      const statusInfo = val ? STATUS_CONFIG[val as CatalogueStatus] : null;
      return statusInfo ? <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge> : null;
    }
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
}

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
  return (
    <DataTable
      items={books}
      itemKey={(b) => b.workId}
      allColumns={ALL_COLUMNS}
      columns={columns}
      onColumnsChange={onColumnsChange}
      renderCell={renderBookCell}
    />
  );
}
