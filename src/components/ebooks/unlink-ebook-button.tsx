"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { readReviewUnlinkTargetUi } from "@/lib/actions/ebook-review-unlink-ui";
import type { ReviewUnlinkTarget } from "@/lib/ebooks/review-queue/unlink-types";
const UnlinkEbookDialog = dynamic(() => import("./unlink-ebook-dialog").then((module) => module.UnlinkEbookDialog), { ssr: false });
export function UnlinkEbookButton({ ebookId }: { ebookId: string }) {
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
  return <>
    <Button size="sm" variant="ghost" disabled={loading || target !== null} onClick={() => void open()}>{loading ? "Loading link…" : "Unlink…"}</Button>
    {error && <p role="alert" className="mt-1 text-xs text-accent-red-text">{error}</p>}
    {target && <UnlinkEbookDialog target={target} initialMode="unlink" onClose={() => setTarget(null)}
      onCommitted={(outcome) => { toast.success(outcome.message, { duration: 10_000 }); router.refresh(); }} />}
  </>;
}
