"use client";

import { useRef, useState } from "react";
import { Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readReviewUnlinkTargetUi } from "@/lib/actions/ebook-review-unlink-ui";
import { unlinkDialog, useUnlinkDialogTarget } from "./unlink-dialog-host";
/** Unlink and its confirmation, for a button or a menu item: `open` loads the link, and the layout's dialog asks */
export function useUnlinkEbook(ebookId: string): {
  /** `change`: the dialog offers to choose its new book next ("Change the book…") */
  open(options?: { change?: boolean }): Promise<void>; loading: boolean; busy: boolean; error: string | null;
} {
  const lock = useRef(false), shown = useUnlinkDialogTarget();
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  async function open(options: { change?: boolean } = {}) {
    if (lock.current || shown) return;
    lock.current = true; setLoading(true); setError(null);
    const result = await readReviewUnlinkTargetUi({ ebookId }).catch(() => null);
    lock.current = false; setLoading(false);
    if (result?.ok) unlinkDialog.open(result.value, options);
    else setError(result && !result.ok ? result.error.message : "The current link could not be loaded. Try again.");
  }
  return { open, loading, busy: loading || shown?.id === ebookId, error };
}
/** `inline`: a command among the facts of a book's eBook copy, on their line rather than a button above it */
export function UnlinkEbookButton({ ebookId, inline = false }: { ebookId: string; inline?: boolean }) {
  const unlink = useUnlinkEbook(ebookId);
  // A busy command keeps its words and width (contract section 8, SLN-713).
  // It is aria-disabled, never disabled, so it keeps the focus; `open` ignores
  // presses while the link loads or its dialog is up
  return <>
    {inline
      ? <button type="button" aria-disabled={unlink.busy || undefined} aria-busy={unlink.loading || undefined} onClick={() => void unlink.open()} className="whitespace-nowrap text-command aria-disabled:opacity-40">Unlink…</button>
      : <Button size="sm" variant="ghost" busy={unlink.loading} aria-disabled={unlink.busy || undefined} onClick={() => void unlink.open()}><Unlink aria-hidden strokeWidth={1.5} />Unlink…</Button>}
    {unlink.error && <p role="alert" className="mt-1 w-full text-xs text-accent-red-text">{unlink.error}</p>}
  </>;
}
