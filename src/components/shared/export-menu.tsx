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

type ExportFormat = "csv" | "tsv" | "parquet";

interface ExportMenuProps {
  entity: "works" | "authors";
  ids: string[] | Set<string>;
  /** Button variant — defaults to "ghost" */
  variant?: "ghost" | "primary";
  /** Button size — defaults to "sm" */
  size?: "sm" | "md" | "lg";
  /** Alignment for the dropdown */
  align?: "start" | "center" | "end";
  side?: "top" | "bottom";
}

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV (.csv)",
  tsv: "TSV (.tsv)",
  parquet: "Parquet (.parquet)",
};

async function triggerExport(
  entity: "works" | "authors",
  ids: string[],
  format: ExportFormat,
) {
  const res = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity, ids, format }),
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
  variant = "ghost",
  size = "sm",
  align = "center",
  side = "top",
}: ExportMenuProps) {
  const [isExporting, setIsExporting] = useState(false);

  const idArray = ids instanceof Set ? Array.from(ids) : ids;

  async function handleExport(format: ExportFormat) {
    setIsExporting(true);
    try {
      await triggerExport(entity, idArray, format);
      toast.success(`Exported ${idArray.length} ${entity} as ${format.toUpperCase()}`);
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
          {isExporting ? "Exporting..." : "Export"}
        </Button>
      }
    >
      <DropdownMenuLabel>Export as</DropdownMenuLabel>
      {(Object.keys(FORMAT_LABELS) as ExportFormat[]).map((fmt) => (
        <DropdownMenuItem
          key={fmt}
          onClick={() => handleExport(fmt)}
          disabled={isExporting}
        >
          {FORMAT_LABELS[fmt]}
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );
}
