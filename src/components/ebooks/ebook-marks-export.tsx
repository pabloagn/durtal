"use client";
import { useState } from "react";
import { buttonClass } from "@/components/ui/button";
import {
  downloadAnnotationExport,
  type AnnotationExportFormat,
} from "@/components/reader/annotation-export-controls";
import type { AnnotationExportBook } from "@/lib/reader/export";
import { annotationPullSchema } from "@/lib/validations/annotations";

/**
 * Export on an e-book's page (SLN-500): the marks are fetched from the
 * reader's annotation route when asked for, not sent with the page, then saved
 * exactly as the reader's panel saves them.
 */
export function EbookMarksExport({ book }: { book: AnnotationExportBook }) {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  async function save(format: AnnotationExportFormat) {
    setState("busy");
    try {
      const res = await fetch(`/api/reader/${book.id}/annotations`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Annotations answered ${res.status}`);
      const pull = annotationPullSchema.parse(await res.json());
      downloadAnnotationExport(
        {
          book,
          annotations: pull.annotations,
          exportedAt: new Date().toISOString(),
        },
        format,
      );
      setState("idle");
    } catch {
      setState("failed");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        disabled={state === "busy"}
        onClick={() => void save("markdown")}
      >
        Export Markdown
      </button>
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        disabled={state === "busy"}
        onClick={() => void save("w3c")}
      >
        Export annotations
      </button>
      {state === "failed" && (
        <span role="status" className="text-xs text-accent-red-text">
          Could not load the marks. Try again.
        </span>
      )}
    </div>
  );
}
