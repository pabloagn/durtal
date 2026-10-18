"use client";
import { useEffect, useRef } from "react";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * When a book does not open (eBooks sub-issue 3): what went wrong in plain
 * words, Try again, the book's other readable files, and the way back. Never
 * an endless spinner. Try again is secondary and only where opening again can help;
 * a damaged or locked file offers its replacement instead (SLN-685).
 */
export function OpenError({
  title = "This eBook could not be opened",
  message,
  onRetry,
  alternatives,
  ebookId,
  backHref,
  replaceHref,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  /** Where to replace the file that did not open */
  replaceHref?: string;
  alternatives: { id: string; label: string }[];
  ebookId: string;
  backHref: string;
}) {
  // Focus starts on the first way out, never on the page body (SLN-864)
  const actions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (document.activeElement?.closest("dialog[open], [role=dialog]")) return;
    actions.current?.querySelector<HTMLElement>("a, button")?.focus({ preventScroll: true });
  }, []);
  return (
    <div role="alert" className="absolute inset-0 flex items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md">
        <SectionHeading title={title} description={message} />
        <div ref={actions} className="flex flex-wrap gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          )}
          {alternatives.map((file) => (
            <a key={file.id} href={`/reader/${ebookId}?file=${file.id}`} className={buttonClass("secondary")}>
              Open the {file.label} instead
            </a>
          ))}
          {/* Recovery leaves the failed reader through a fresh catalogue document */}
          {replaceHref && (
            <a href={replaceHref} className={buttonClass("secondary")}>
              Replace file…
            </a>
          )}
          {/* Alone in the row, it starts on the text's edge */}
          <a href={backHref} className={`${buttonClass("ghost")} first:-ml-3`}>
            Back
          </a>
        </div>
      </div>
    </div>
  );
}
