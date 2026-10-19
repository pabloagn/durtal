"use client";

import { useEffect } from "react";
import { toast } from "@/lib/notifications/toast";
import { checkOfflineUpdate, takeOverWith } from "@/lib/reader/offline/install";

/** How often a page left open looks again, when it comes back into view */
const AGAIN_MS = 60 * 60 * 1000;

/**
 * Keeps a device's offline release up to date (SLN-1145). Once a book was made
 * available offline, the worker that serves the downloaded books never
 * updated: a new release went unseen, and the offline pages stayed the old
 * ones until the site's data was cleared.
 *
 * When Durtal opens online, comes back online, or comes back into view after
 * an hour, this asks the server which release it runs. A newer one installs
 * beside the running one. With `offer`, the page then says so and offers
 * Reload, which lets the new release take over at once; otherwise it takes
 * over when Durtal's pages next close. A device without downloads gets no
 * worker.
 */
export function OfflineUpdate({ offer = true }: { offer?: boolean }) {
  useEffect(() => {
    let stopped = false;
    let offered = false;
    let last = 0;
    const check = (always: boolean) => {
      if (!always && Date.now() - last < AGAIN_MS) return;
      last = Date.now();
      checkOfflineUpdate()
        .then((waiting) => {
          if (!waiting || !offer || offered || stopped) return;
          offered = true;
          toast.info("A newer version of Durtal is ready", {
            duration: Infinity,
            action: { label: "Reload", onClick: () => void takeOverWith(waiting).then(() => location.reload()) },
          });
        })
        .catch(() => {});
    };
    const online = () => check(true);
    const visible = () => {
      if (document.visibilityState === "visible") check(false);
    };
    check(true);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [offer]);
  return null;
}
