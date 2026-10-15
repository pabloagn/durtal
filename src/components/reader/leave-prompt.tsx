"use client";
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/shortcuts/kbd";

/**
 * The question before Esc leaves the book (SLN-744). Leave holds the focus,
 * so Esc then Enter leaves and Esc twice stays. Neither button carries a
 * tooltip: a focused control's tooltip would take the second Esc. Mounted
 * only while it is up.
 */
export function LeavePrompt({
  onStay,
  onLeave,
}: {
  onStay(): void;
  /** Saves the place, then goes; the prompt stays up, busy, until the page goes */
  onLeave(): void;
}) {
  const leaveRef = useRef<HTMLButtonElement>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    leaveRef.current?.focus();
  }, []);
  // Back to the reader from the browser's page cache: the book is open again
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) onStay();
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, [onStay]);
  const stay = () => {
    if (!leaving) onStay();
  };
  return (
    <Dialog
      open
      onClose={stay}
      title="Leave the book?"
      description="Your place is saved."
      className="max-w-sm"
      expandable={false}
    >
      <div data-reader-leave-prompt className="flex flex-wrap items-center justify-end gap-2">
        <p className="mr-auto flex items-center gap-3 text-micro text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            stay
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            leave
          </span>
        </p>
        <Button type="button" variant="ghost" onClick={stay} disabled={leaving}>
          Stay
        </Button>
        <Button
          type="button"
          ref={leaveRef}
          variant="primary"
          busy={leaving}
          onClick={() => {
            if (leaving) return;
            setLeaving(true);
            onLeave();
          }}
        >
          Leave
        </Button>
      </div>
    </Dialog>
  );
}
