"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/notifications/toast";
import type { EntityActionItem } from "@/components/shared/entity-action-menu";
import { exportFormatsFor, type ExportFormat } from "@/lib/export/formats";
import { countLabel } from "@/lib/utils/format";

export type { ExportFormat } from "@/lib/export/formats";

/** What can be exported: books, authors, one of the other collections, or reading (SLN-458) */
export type ExportEntity =
  | "works"
  | "authors"
  | "perfumes"
  | "films"
  | "paintings"
  | "readings"
  | "reading-sessions"
  | "reading-notes"
  | "goodreads";

/** Shared with the export route, so menus offer only supported entity formats. */
export function exportFormats(entity: ExportEntity): ExportFormat[] {
  return [...exportFormatsFor(entity)];
}

/** What a message calls one record and several (SLN-894): "Exported 1 book as CSV", "Exported 2 people as Parquet" */
export const EXPORT_NOUNS: Record<ExportEntity, readonly [one: string, many: string]> = {
  works: ["book", "books"],
  authors: ["person", "people"],
  perfumes: ["perfume", "perfumes"],
  films: ["film", "films"],
  paintings: ["painting", "paintings"],
  readings: ["reading", "readings"],
  "reading-sessions": ["reading session", "reading sessions"],
  "reading-notes": ["quote or note", "quotes and notes"],
  goodreads: ["book", "books"],
};

/** What to export: these records, every one, or what a page's filters show (its URL query) */
export type ExportSelection = string[] | "all" | { filters: string };

interface ExportMenuProps {
  entity: ExportEntity;
  /** The records, or the page's filters (the journal, the commonplace book) */
  ids: string[] | Set<string> | { filters: string };
  /** Button variant — defaults to "ghost" */
  variant?: "ghost" | "primary";
  /** Button size — defaults to "sm" */
  size?: "sm" | "md" | "lg";
  /** Alignment for the dropdown */
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV (.csv)",
  tsv: "TSV (.tsv)",
  parquet: "Parquet (.parquet)",
  md: "Markdown (export only)",
  json: "JSON (.json)",
};

/** A format's name, as the menu writes it: "CSV", "Parquet", "Markdown" */
export const exportFormatName = (format: ExportFormat) => EXPORT_FORMAT_LABELS[format].replace(/ \(.*\)$/, "");

/** The message once a file is made: "Exported 2 books as CSV", or "Exported readings as Markdown" for a page's filters */
export function exportedMessage(entity: ExportEntity, selection: ExportSelection, format: ExportFormat): string {
  const [one, many] = EXPORT_NOUNS[entity];
  const what = Array.isArray(selection) ? countLabel(selection.length, one, many) : many;
  return `Exported ${what} as ${exportFormatName(format)}`;
}

/**
 * One record's export as Actions menu entries, a format each ("Export as
 * CSV"): a detail header keeps Export in its menu (SLN-641).
 */
export function exportActionItems(entity: ExportEntity, ids: string[]): EntityActionItem[] {
  return exportFormats(entity).map((format) => ({
    label: `Export as ${exportFormatName(format)}${format === "md" ? " (export only)" : ""}`,
    icon: Download,
    onClick: () => {
      const progress = toast.pending(`Exporting as ${exportFormatName(format)}`);
      triggerExport(entity, ids, format).then(
        (result) => result.unresolvedIds ? progress.warning(goodreadsWarning(result.unresolvedIds)) : progress.success(exportedMessage(entity, ids, format)),
        (err) => progress.error(err instanceof Error ? err.message : "Export failed"),
      );
    },
  }));
}

/** The authoritative response reports blanks even when a courtesy preflight failed. */
export function goodreadsWarning(count: number): string {
  return `Exported with ${count} unresolved Goodreads IDs left blank.`;
}

/** Download an export: these records, every one ("all"), or what a page's filters show. */
export async function triggerExport(
  entity: ExportEntity,
  selection: ExportSelection,
  format: ExportFormat,
) {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      selection === "all"
        ? { entity, all: true, format }
        : Array.isArray(selection)
          ? { entity, ids: selection, format }
          : { entity, filters: selection.filters, format },
    ),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Export failed" }));
    throw new Error(err.error ?? "Export failed");
  }

  // Get filename from Content-Disposition header
  const disposition = res.headers.get("Content-Disposition");
  const filenameMatch = disposition?.match(/filename="(.+)"/);
  const filename = filenameMatch?.[1] ?? `export.${format}`;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  const count = Number(res.headers.get("X-Durtal-Goodreads-Unresolved"));
  return { unresolvedIds: entity === "goodreads" && Number.isSafeInteger(count) && count > 0 ? count : 0 };
}

export function ExportMenu({
  entity,
  ids,
  variant = "ghost",
  size = "sm",
  align = "center",
  side = "top",
}: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);

  const selection: ExportSelection = ids instanceof Set ? Array.from(ids) : ids;

  async function handleExport(format: ExportFormat) {
    setIsExporting(true);
    const progress = toast.pending(`Exporting as ${exportFormatName(format)}`);
    try {
      const result = await triggerExport(entity, selection, format);
      if (result.unresolvedIds) progress.warning(goodreadsWarning(result.unresolvedIds));
      else progress.success(exportedMessage(entity, selection, format));
    } catch (err) {
      progress.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <DropdownMenu
      align={align}
      side={side}
      trigger={
        // Busy, not disabled, so the focus stays on it while the file is made
        <Button variant={variant} size={size} busy={isExporting} aria-label={isExporting ? "Exporting…" : undefined}>
          <Download className="h-4 w-4" strokeWidth={1.5} />
          Export
        </Button>
      }
    >
      <DropdownMenuLabel>Export as</DropdownMenuLabel>
      {exportFormats(entity).map((fmt) => (
        <DropdownMenuItem
          key={fmt}
          onClick={() => handleExport(fmt)}
          disabled={isExporting}
        >
          {EXPORT_FORMAT_LABELS[fmt]}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
