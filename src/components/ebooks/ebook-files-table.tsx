"use client";
import Link from "next/link";
import { useState } from "react";
import { DataTable } from "@/components/shared/data-table";
import { formatBytes } from "@/lib/ebooks/run-text";
import { formatLabel } from "@/lib/ebooks/formats";
export interface EbookFileData {
  id: string;
  format: string;
  sizeBytes: number;
  status: string;
  checksum: string;
  sourceHost: string | null;
  sourcePath: string | null;
  added: string;
  preferred: boolean;
  download: boolean;
}
const columns = [
  { key: "format", label: "Format", defaultVisible: true },
  { key: "size", label: "Size", defaultVisible: true },
  { key: "status", label: "Status", defaultVisible: true },
  { key: "checksum", label: "Checksum", defaultVisible: true },
  { key: "source", label: "Source", defaultVisible: true },
  { key: "added", label: "Added", defaultVisible: true },
  { key: "actions", label: "Actions", defaultVisible: true },
].map((column, defaultOrder) => ({ ...column, defaultOrder }));
export function EbookFilesTable({ files }: { files: EbookFileData[] }) {
  const [visible, setVisible] = useState(
    columns.map((column, order) => ({ key: column.key, order, visible: true })),
  );
  return (
    <DataTable
      items={files}
      itemKey={(file) => file.id}
      allColumns={columns}
      columns={visible}
      onColumnsChange={setVisible}
      preserveOrder
      renderCell={(file, column) => {
        if (column === "format")
          return (
            <span>
              {formatLabel(file.format)}
              {file.preferred && (
                <span className="mt-1 block text-xs text-fg-secondary">
                  Opens first
                </span>
              )}
            </span>
          );
        if (column === "size") return formatBytes(file.sizeBytes);
        if (column === "status")
          return (
            <span className="block min-w-40 max-w-xs whitespace-normal">
              {file.status}
            </span>
          );
        if (column === "checksum")
          return (
            <span className="font-mono" data-tooltip={file.checksum}>
              {file.checksum.slice(0, 12)}
            </span>
          );
        if (column === "source")
          return (
            <span className="block max-w-xs whitespace-normal [overflow-wrap:anywhere]">
              {[file.sourceHost, file.sourcePath].filter(Boolean).join(" · ") ||
                "—"}
            </span>
          );
        if (column === "added") return file.added.slice(0, 10);
        if (column === "actions")
          return file.download ? (
            <Link
              href={`/api/ebooks/files/${file.id}?download=1`}
              className="touch-hit text-accent-primary"
            >
              Download
            </Link>
          ) : (
            "—"
          );
        return null;
      }}
      getSortValue={(file, key) =>
        key === "size"
          ? file.sizeBytes
          : key === "format"
            ? file.format
            : key === "added"
              ? file.added
              : key === "status"
                ? file.status
                : key === "checksum"
                  ? file.checksum
                  : ""
      }
    />
  );
}
