"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export type ExportFormat = "csv" | "tsv" | "parquet" | "md";

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

/** The formats an export offers: Markdown is the commonplace book only, the Goodreads file is CSV */
export function exportFormats(entity: ExportEntity): ExportFormat[] {
  if (entity === "reading-notes") return ["csv", "tsv", "parquet", "md"];
  if (entity === "goodreads") return ["csv"];
  return ["csv", "tsv", "parquet"];
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
};

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
    try {
      await triggerExport(entity, selection, format);
      toast.success(
        Array.isArray(selection)
          ? `Exported ${selection.length} ${noun ?? entity} as ${format.toUpperCase()}`
          : `Exported ${noun ?? entity} as ${format === "md" ? "Markdown" : format.toUpperCase()}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <DropdownMenu
      align={align}
      side={side}
      trigger={
        <Button variant={variant} size={size} disabled={isExporting}>
          <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
          {isExporting ? "Exporting…" : "Export"}
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
