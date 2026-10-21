"use client";

import { useEffect, useRef } from "react";
import { useSonner } from "sonner";
import { record } from "@/lib/notifications/history";
import { notificationContent } from "@/lib/notifications/content";

/** Toast ids restart with each page load: this keeps them apart in the history */
const PAGE = Math.random().toString(36).slice(2, 10);

/**
 * Keep every completed toast, including linked titles, until explicit removal.
 * Loading indicators are recorded when they settle into a result.
 */
export function NotificationRecorder() {
  const { toasts } = useSonner();
  // Sonner makes a new object each time a toast is shown or changed, and keeps
  // the others as they are: each one is recorded once, so a toast shown again
  // under the same id counts again (SLN-1460)
  const seen = useRef(new WeakSet<object>());
  useEffect(() => {
    for (const toast of toasts) {
      if (seen.current.has(toast)) continue;
      seen.current.add(toast);
      if (toast.delete || toast.type === "loading") continue;
      const kind = toast.type === "error" || toast.type === "warning" || toast.type === "success" ? toast.type : "info";
      const content = notificationContent(toast.title);
      const description = notificationContent(toast.description);
      const title = content.text.trim();
      if (!title) continue;
      record({
        id: `${PAGE}:${toast.id}`,
        kind,
        title,
        description: description.text.trim() || null,
        link: content.link ?? description.link,
      });
    }
  }, [toasts]);
  return null;
}
