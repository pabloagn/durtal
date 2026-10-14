"use client";

import { useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readReviewUnlinkTargetUi } from "@/lib/actions/ebook-review-unlink-ui";
import type { ReviewUnlinkTarget } from "@/lib/ebooks/review-queue/unlink-types";
const UnlinkEbookDialog = dynamic(() => import("./unlink-ebook-dialog").then((module) => module.UnlinkEbookDialog), { ssr: false });
/** Unlink and its confirmation, for a button or a menu item: `open` loads the link, `dialog` asks */
export function useUnlinkEbook(ebookId: string): {
  open(): Promise<void>; loading: boolean; busy: boolean; error: string | null; dialog: ReactNode;
} {
  const router = useRouter(), lock = useRef(false);
  const [target, setTarget] = useState<ReviewUnlinkTarget | null>(null), [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open() {
    if (lock.current || target) return;
    lock.current = true; setLoading(true); setError(null);
    const result = await readReviewUnlinkTargetUi({ ebookId }).catch(() => null);
    lock.current = false; setLoading(false);
    if (result?.ok) setTarget(result.value);
    else setError(result && !result.ok ? result.error.message : "The current link could not be loaded. Try again.");
  }
  return {
    open, loading, busy: loading || target !== null, error,
    dialog: target && <UnlinkEbookDialog target={target} initialMode="unlink" onClose={() => setTarget(null)}
      onCommitted={(outcome) => { toast.success(outcome.message, { duration: 10_000 }); router.refresh(); }} />,
  };
}
export function UnlinkEbookButton({ ebookId }: { ebookId: string }) {
  const unlink = useUnlinkEbook(ebookId);
  return <>
    <Button size="sm" variant="ghost" disabled={unlink.busy} onClick={() => void unlink.open()}>{unlink.loading ? "Loading link…" : "Unlink…"}</Button>
    {unlink.error && <p role="alert" className="mt-1 text-xs text-accent-red-text">{unlink.error}</p>}
    {unlink.dialog}
  </>;
}
