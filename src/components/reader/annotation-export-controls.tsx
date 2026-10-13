"use client";
import { buttonClass } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
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
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => download("markdown")}
      >
        Export Markdown
      </button>
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => download("w3c")}
      >
        Export annotations
      </button>
      <button
        type="button"
        className={buttonClass("ghost", "sm")}
        onClick={() => {
          void navigator.clipboard
            .writeText(annotationsToMarkdown(input()))
            .then(
              () => setMessage("Copied"),
              () => setMessage("Copy failed"),
            );
        }}
      >
        Copy all as Markdown
      </button>
      {message && (
        <span role="status" className="text-xs text-fg-secondary">
          {message}
        </span>
      )}
    </div>
  );
}
