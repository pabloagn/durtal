"use client";

import { CopyBookButton } from "./copy-book-button";

import Link from "next/link";
import Image from "next/image";
import { HuntBadge } from "./hunt-badge";
import { PoisonBadge } from "./poison-badge";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/shared/data-table";
import { STATUS_CONFIG } from "@/lib/constants/catalogue";
import type { ColumnDef } from "@/components/books/column-config-dialog";
import type { CatalogueStatus } from "@/lib/types";
import type { CoverCrop } from "./book-card";
import { mediaImageStyle } from "@/lib/utils/media-style";
import { formatRating } from "@/lib/utils/rating";
import { languageName } from "@/lib/utils/language";
import { formatReadingDate } from "@/lib/reading/dates";
import { readingBadge, type CardReadingValue, type ReadingSummaryValue } from "@/lib/reading/card";

export interface DetailedBookItem {
  workId: string;
  slug: string;
  title: string;
  authorName: string;
  authorNames?: string[];
  coverUrl?: string | null;
  coverCrop?: CoverCrop | null;
  publicationYear?: number | null;
  language?: string | null;
  instanceCount: number;
  rating?: number | null;
  catalogueStatus?: string | null;
  isRare?: boolean;
  huntAssessedOn?: string | null;
  isPoison?: boolean;
  publisher?: string | null;
  binding?: string | null;
  pages?: number | null;
  isbn?: string | null;
  locationName?: string | null;
  format?: string | null;
  condition?: string | null;
  addedDate?: string | null;
  /** An open reading, until the summaries load */
  reading?: CardReadingValue;
  /** Reading state, times read, last read and progress (SLN-449) */
  readingSummary?: ReadingSummaryValue;
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
  // Reading (SLN-449): a saved column choice gets them hidden, in the column dialog
  { key: "readingState", label: "Reading", defaultVisible: false, defaultOrder: 15 },
  { key: "lastReadAt", label: "Last read", defaultVisible: false, defaultOrder: 16 },
  { key: "timesRead", label: "Times read", defaultVisible: false, defaultOrder: 17 },
  { key: "readingPercent", label: "Progress", defaultVisible: false, defaultOrder: 18 },
];

const STATE_ORDER: Record<string, number> = { reading: 0, paused: 1, read: 2, abandoned: 3, unread: 4 };

/** The reading columns' values for a header click's sort */
function readingSortValue(book: DetailedBookItem, key: string): string | number {
  const r = book.readingSummary;
  if (key === "readingState") return STATE_ORDER[r?.state ?? book.reading?.state ?? "unread"] ?? 4;
  if (key === "lastReadAt") return r?.lastReadAt ?? "";
  if (key === "timesRead") return r?.timesRead ?? 0;
  if (key === "readingPercent") return r?.percent ?? book.reading?.percent ?? -1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((book as any)[key] ?? "") as string | number;
}

function renderBookCell(book: DetailedBookItem, key: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const val = (book as any)[key];
  switch (key) {
    case "title":
      return (
        <div className="flex items-center gap-2">
        <Link
          href={`/library/${book.slug}`}
          className="flex items-center gap-2 hover:text-accent-rose-text"
        >
          <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
            {book.coverUrl ? (
              <Image
                src={book.coverUrl}
                alt=""
                fill
                sizes="56px"
                className="object-cover"
                style={mediaImageStyle(book.coverCrop)}
              unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <span className="font-serif text-xs text-fg-muted/40">{book.title[0]}</span>
              </div>
            )}
          </div>
          <span className="min-w-0"><span className="block truncate">{book.title}</span><HuntBadge {...book} /><PoisonBadge isPoison={book.isPoison} /></span>
        </Link>
        <CopyBookButton {...book} />
        </div>
      );
    case "catalogueStatus": {
      const statusInfo = val ? STATUS_CONFIG[val as CatalogueStatus] : null;
      return statusInfo ? <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge> : null;
    }
    case "rating":
      return val != null && val !== "" ? <Badge variant="gold">{formatRating(val as number)}/5</Badge> : null;
    case "language":
      return val && val !== "en" ? <Badge variant="blue">{languageName(val)}</Badge> : languageName(val);
    case "binding":
    case "format":
    case "condition":
      return val ? <Badge variant="muted">{val}</Badge> : null;
    // Reading (SLN-449): empty until the summaries load
    case "readingState": {
      const badge = readingBadge(book.readingSummary, book.reading);
      return badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null;
    }
    case "lastReadAt":
      return book.readingSummary?.lastReadAt ? formatReadingDate(book.readingSummary.lastReadAt.slice(0, 10), "day") : null;
    case "timesRead":
      return book.readingSummary?.timesRead ? String(book.readingSummary.timesRead) : null;
    case "readingPercent": {
      const percent = book.readingSummary ? book.readingSummary.percent : (book.reading?.percent ?? null);
      return percent === null ? null : `${Math.round(percent)}%`;
    }
    default:
      return val ?? "";
  }
}

interface BookDataTableProps {
  books: DetailedBookItem[];
  columns: { key: string; visible: boolean; order: number }[];
  onColumnsChange: (cols: { key: string; visible: boolean; order: number }[]) => void;
  isSelecting?: boolean;
  selectedIds?: Set<string>;
  onSelect?: (workId: string) => void;
}

export function BookDataTable({
  books,
  columns,
  onColumnsChange,
  isSelecting,
  selectedIds,
  onSelect,
}: BookDataTableProps) {
  return (
    <DataTable
      items={books}
      itemKey={(b) => b.workId}
      allColumns={ALL_COLUMNS}
      columns={columns}
      onColumnsChange={onColumnsChange}
      renderCell={renderBookCell}
      getSortValue={readingSortValue}
      // The server's sort holds until a header is clicked
      preserveOrder
      isSelecting={isSelecting}
      selectedIds={selectedIds}
      onSelect={onSelect}
    />
  );
}
