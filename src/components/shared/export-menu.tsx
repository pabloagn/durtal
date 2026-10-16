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

/** What to export: these records, every one, or what a page's filters show (its URL query) */
export type ExportSelection = string[] | "all" | { filters: string };

interface ExportMenuProps {
  entity: ExportEntity;
  /** The records, or the page's filters (the journal, the commonplace book) */
  ids: string[] | Set<string> | { filters: string };
  /** What the toast calls the records ("readings") */
  noun?: string;
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
  md: "Markdown (.md)",
  json: "JSON (.json)",
};

/**
 * One record's export as Actions menu entries, a format each ("Export as
 * CSV"): a detail header keeps Export in its menu (SLN-641).
 */
export function exportActionItems(entity: ExportEntity, ids: string[], noun?: string): EntityActionItem[] {
  return exportFormats(entity).map((format) => ({
    label: `Export as ${EXPORT_FORMAT_LABELS[format].replace(/ \(.*\)$/, "")}`,
    icon: Download,
    onClick: () => {
      const progress = toast.pending(`Exporting as ${format.toUpperCase()}`);
      triggerExport(entity, ids, format).then(
        () => progress.success(`Exported ${ids.length} ${noun ?? entity} as ${format.toUpperCase()}`),
        (err) => progress.error(err instanceof Error ? err.message : "Export failed"),
      );
    },
  }));
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
}

export function ExportMenu({
  entity,
  ids,
  noun,
  variant = "ghost",
  size = "sm",
  align = "center",
  side = "top",
}: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);

  const selection: ExportSelection = ids instanceof Set ? Array.from(ids) : ids;

  async function handleExport(format: ExportFormat) {
    setIsExporting(true);
    const progress = toast.pending(`Exporting as ${format === "md" ? "Markdown" : format.toUpperCase()}`);
    try {
      await triggerExport(entity, selection, format);
      progress.success(
        Array.isArray(selection)
          ? `Exported ${selection.length} ${noun ?? entity} as ${format.toUpperCase()}`
          : `Exported ${noun ?? entity} as ${format === "md" ? "Markdown" : format.toUpperCase()}`,
      );
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
