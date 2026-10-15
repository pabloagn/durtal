"use client";

import { useEffect, useState } from "react";
import { settleDeviceId } from "@/lib/reader/device-handshake";
import { OpenError } from "./open-error";

/**
 * The reader's first page in a browser with no device id (SLN-668): it gets
 * one under a lock shared with any other reader tab, then reloads to open the
 * book with it.
 */
export function DeviceHandshake({ ebookId, backHref }: { ebookId: string; backHref: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    settleDeviceId().then(
      (result) => {
        if (!live) return;
        if (result === "ready") window.location.reload();
        else setFailure("This browser is not keeping cookies for Durtal, so the reader cannot remember your place. Allow cookies for this site, then retry.");
      },
      () => { if (live) setFailure("Durtal could not be reached. Check the connection, then retry."); },
    );
    return () => { live = false; };
  }, [attempt]);
  if (failure)
    return <OpenError message={failure} alternatives={[]} ebookId={ebookId} backHref={backHref}
      onRetry={() => { setFailure(null); setAttempt((n) => n + 1); }} />;
  return <p role="status" className="p-6 text-sm text-fg-secondary">Opening the book</p>;
}
