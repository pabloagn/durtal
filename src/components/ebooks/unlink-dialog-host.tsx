"use client";

import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { ReviewUnlinkTarget } from "@/lib/ebooks/review-queue/unlink-types";

const UnlinkEbookDialog = dynamic(() => import("./unlink-ebook-dialog").then((module) => module.UnlinkEbookDialog), { ssr: false });

let current: ReviewUnlinkTarget | null = null;
/** "Change the book…": after the unlink, choose its new book */
let changing = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const read = () => current;

/** The eBook whose Unlink dialog is open, or none */
export const unlinkDialog = {
  open(target: ReviewUnlinkTarget, options: { change?: boolean } = {}) {
    current = target; changing = !!options.change; listeners.forEach((listener) => listener());
  },
  close() { current = null; changing = false; listeners.forEach((listener) => listener()); },
};

export function useUnlinkDialogTarget() {
  return useSyncExternalStore(subscribe, read, () => null);
}

/**
 * The Unlink dialog, hosted by the layout. Opened from inside what an unlink
 * removes (the eBook page's linked-book card, a book's copy), it would unmount
 * with it when the page refreshes, before its result or "Undo keep" shows; it
 * would also take that host's type (#247 review).
 */
export function UnlinkDialogHost() {
  const router = useRouter();
  const target = useUnlinkDialogTarget();
  if (!target) return null;
  return <UnlinkEbookDialog key={target.id} target={target} initialMode="unlink" change={changing}
    onClose={unlinkDialog.close} onCommitted={() => router.refresh()} />;
}
