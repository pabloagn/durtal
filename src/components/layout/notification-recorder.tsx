"use client";

import { useEffect } from "react";
import { useSonner } from "sonner";
import { record } from "@/lib/notifications/history";

/** Toast ids restart with each page load: this keeps them apart in the history */
const PAGE = Math.random().toString(36).slice(2, 10);

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Keeps every error and warning toast in the notification history (SLN-567),
 * whichever page or dialog showed it. A pending toast that ends in an error
 * is kept then; one that ends well is not.
 */
export function NotificationRecorder() {
  const { toasts } = useSonner();
  useEffect(() => {
    for (const toast of toasts) {
      if (toast.type !== "error" && toast.type !== "warning") continue;
      const title = text(toast.title);
      if (!title) continue;
      record({
        id: `${PAGE}:${toast.id}`,
        kind: toast.type,
        title,
        description: text(toast.description),
      });
    }
  }, [toasts]);
  return null;
}
