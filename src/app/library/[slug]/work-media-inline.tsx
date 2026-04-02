"use client";

import { useState } from "react";
import { Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MediaManagerDialog } from "@/components/books/media-manager-dialog";

interface WorkMediaInlineProps {
  workId: string;
  title: string;
  posterCount: number;
  backgroundCount: number;
  galleryCount: number;
  /**
   * When provided, the dialog is externally controlled and no trigger button is rendered.
   * Pass `false` to simply hide the button without external control.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Set to false to hide the built-in trigger button (e.g., when using an action menu) */
  showButton?: boolean;
}

export function WorkMediaInline({
  workId,
  title,
  posterCount,
  backgroundCount,
  galleryCount,
  open: controlledOpen,
  onOpenChange,
  showButton = true,
}: WorkMediaInlineProps) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const mediaOpen = isControlled ? controlledOpen : internalOpen;

  function setMediaOpen(next: boolean) {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  }

  const totalCount = posterCount + backgroundCount + galleryCount;

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-2xl text-fg-primary">
          Media
          {totalCount > 0 && (
            <span className="ml-1">({totalCount})</span>
          )}
        </h2>
        {showButton && !isControlled && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMediaOpen(true)}
          >
            <Image className="h-3.5 w-3.5" strokeWidth={1.5} />
            Manage media
          </Button>
        )}
      </div>

      <div className="flex gap-4 text-xs text-fg-muted">
        <span>
          <span className="font-mono text-fg-secondary">{posterCount}</span>{" "}
          {posterCount === 1 ? "poster" : "posters"}
        </span>
        <span>
          <span className="font-mono text-fg-secondary">{backgroundCount}</span>{" "}
          {backgroundCount === 1 ? "background" : "backgrounds"}
        </span>
        <span>
          <span className="font-mono text-fg-secondary">{galleryCount}</span>{" "}
          {galleryCount === 1 ? "gallery image" : "gallery images"}
        </span>
      </div>

      <MediaManagerDialog
        open={mediaOpen}
        onClose={() => setMediaOpen(false)}
        workId={workId}
        title={title}
      />
    </section>
  );
}
