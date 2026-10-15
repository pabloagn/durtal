"use client";
import { buttonClass } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Download } from "lucide-react";
import { DropdownMenu, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { ReaderAnnotation } from "@/lib/reader/annotations";
import {
  annotationsToMarkdown,
  annotationsToW3C,
  annotationExportFilename,
  type AnnotationExportBook,
  type AnnotationExportInput,
} from "@/lib/reader/export";
export type AnnotationExportFormat = "markdown" | "w3c";

/**
 * Saves the marks as a Markdown or W3C Web Annotation file, built here in the
 * browser so it works offline. Returns the object URL, revoked after 30s.
 */
export function downloadAnnotationExport(
  value: AnnotationExportInput,
  format: AnnotationExportFormat,
): string {
  const text =
    format === "markdown"
      ? annotationsToMarkdown(value)
      : JSON.stringify(annotationsToW3C(value), null, 2) + "\n";
  const url = URL.createObjectURL(
    new Blob([text], {
      type:
        format === "markdown"
          ? "text/markdown;charset=utf-8"
          : "application/ld+json;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = annotationExportFilename(value.book.title, format);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return url;
}

export function AnnotationExportControls({
  book,
  annotations,
}: {
  book: AnnotationExportBook;
  annotations: readonly ReaderAnnotation[];
}) {
  const [message, setMessage] = useState<string | null>(null);
  const urls = useRef(new Set<string>());
  useEffect(() => {
    const current = urls.current;
    return () => {
      current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  const input = () => ({
    book,
    annotations,
    exportedAt: new Date().toISOString(),
  });
  const download = (format: AnnotationExportFormat) => {
    const url = downloadAnnotationExport(input(), format);
    urls.current.add(url);
    setTimeout(() => urls.current.delete(url), 30_000);
  };
  // One quiet menu for the three ways out, not three buttons (SLN-726)
  return (
    <div className="flex items-center gap-2">
      <DropdownMenu
        align="start"
        side="top"
        trigger={
          <button type="button" className={buttonClass("ghost", "sm") + " -ml-2.5"}>
            Export
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        }
      >
        <DropdownMenuItem onClick={() => download("markdown")} icon={<Download className="h-4 w-4" strokeWidth={1.5} />}>
          Markdown file
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => download("w3c")} icon={<Download className="h-4 w-4" strokeWidth={1.5} />}>
          Web Annotation file
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Copy className="h-4 w-4" strokeWidth={1.5} />}
          onClick={() => {
            void navigator.clipboard
              .writeText(annotationsToMarkdown(input()))
              .then(
                () => setMessage("Copied"),
                () => setMessage("Copy failed"),
              );
          }}
        >
          Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenu>
      {message && (
        <span role="status" className="text-xs text-fg-secondary">
          {message}
        </span>
      )}
    </div>
  );
}
