"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { readReviewUnlinkTargetUi } from "@/lib/actions/ebook-review-unlink-ui";
import { unlinkDialog, useUnlinkDialogTarget } from "./unlink-dialog-host";
/** Unlink and its confirmation, for a button or a menu item: `open` loads the link, and the layout's dialog asks */
export function useUnlinkEbook(ebookId: string): {
  open(): Promise<void>; loading: boolean; busy: boolean; error: string | null;
} {
  const lock = useRef(false), shown = useUnlinkDialogTarget();
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  async function open() {
    if (lock.current || shown) return;
    lock.current = true; setLoading(true); setError(null);
    const result = await readReviewUnlinkTargetUi({ ebookId }).catch(() => null);
    lock.current = false; setLoading(false);
    if (result?.ok) unlinkDialog.open(result.value);
    else setError(result && !result.ok ? result.error.message : "The current link could not be loaded. Try again.");
  }
  return { open, loading, busy: loading || shown?.id === ebookId, error };
}
export function UnlinkEbookButton({ ebookId }: { ebookId: string }) {
  const unlink = useUnlinkEbook(ebookId);
  return <>
    <Button size="sm" variant="ghost" disabled={unlink.busy} onClick={() => void unlink.open()}>{unlink.loading ? "Loading link…" : "Unlink…"}</Button>
    {unlink.error && <p role="alert" className="mt-1 text-xs text-accent-red-text">{unlink.error}</p>}
  </>;
}
