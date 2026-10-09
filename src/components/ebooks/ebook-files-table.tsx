"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPreferredEbookFile } from "@/lib/actions/ebooks";
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
  readable: boolean;
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
export function EbookFilesTable({
  ebookId,
  files,
}: {
  ebookId: string;
  files: EbookFileData[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(
    columns.map((column, order) => ({ key: column.key, order, visible: true })),
  );
  return (
    <>
      {error && (
        <p className="mb-3 text-sm text-accent-red-text" role="alert">
          {error}
        </p>
      )}
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
                {[file.sourceHost, file.sourcePath]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
            );
          if (column === "added") return file.added.slice(0, 10);
          if (column === "actions")
            return (
              <div className="flex flex-wrap gap-2">
                {file.download ? (
                  <Link
                    href={`/api/ebooks/files/${file.id}?download=1`}
                    className="touch-hit text-accent-primary"
                  >
                    Download
                  </Link>
                ) : null}
                {file.readable && !file.preferred && (
                  <button
                    type="button"
                    disabled={pending}
                    className="touch-hit text-accent-primary disabled:opacity-40"
                    onClick={() => {
                      setError(null);
                      startTransition(async () => {
                        try {
                          await setPreferredEbookFile({
                            ebookId,
                            fileId: file.id,
                          });
                          router.refresh();
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : "The preferred file could not be changed.",
                          );
                        }
                      });
                    }}
                  >
                    Open first
                  </button>
                )}
                {!file.download && !file.readable ? "—" : null}
              </div>
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
    </>
  );
}
