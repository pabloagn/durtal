"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { settleDeviceId } from "@/lib/reader/device-handshake";
import { takeEarlyEscape } from "@/lib/reader/early-escape";
import { LeavePrompt } from "./leave-prompt";
import { OpenError } from "./open-error";

/** Back to the page the reader came from when it is the way back, as the reader leaves (SLN-683) */
function leave(target: URL) {
  let from: URL | null = null;
  try {
    from = document.referrer ? new URL(document.referrer) : null;
  } catch {
    from = null;
  }
  if (from && from.origin === target.origin && from.pathname === target.pathname && from.search === target.search
    && window.history.length > 1) window.history.back();
  else window.location.assign(target.href);
}

/**
 * The reader's first page in a browser with no device id (SLN-668): it gets
 * one under a lock shared with any other reader tab, then reloads to open the
 * book with it. Escape asks before leaving, as in the book (SLN-811); the
 * reload waits while the question is up.
 */
export function DeviceHandshake({ ebookId, backHref }: { ebookId: string; backHref: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  const readyRef = useRef(false);
  useEffect(() => {
    let live = true;
    settleDeviceId().then(
      (result) => {
        if (!live) return;
        if (result !== "ready")
          setFailure("This browser is not keeping cookies for Durtal, so the reader cannot remember your place. Allow cookies for this site, then retry.");
        else if (askingRef.current) readyRef.current = true;
        else window.location.reload();
      },
      () => { if (live) setFailure("Durtal could not be reached. Check the connection, then retry."); },
    );
    return () => { live = false; };
  }, [attempt]);

  const ask = useCallback(() => {
    // It opens once this key is done: a modal dialog open while the key's
    // default action runs would take it as its cancel
    setTimeout(() => {
      askingRef.current = true;
      setAsking(true);
    });
  }, []);
  useEffect(() => {
    if (failure) return;
    if (takeEarlyEscape()) ask();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.defaultPrevented || askingRef.current || document.querySelector("dialog[open]")) return;
      ask();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [failure, ask]);

  if (failure)
    return <OpenError message={failure} alternatives={[]} ebookId={ebookId} backHref={backHref}
      onRetry={() => { setFailure(null); setAttempt((n) => n + 1); }} />;
  return (
    <>
      <p role="status" className="p-6 text-sm text-fg-secondary">Opening the book</p>
      {asking && (
        <LeavePrompt
          onStay={() => {
            askingRef.current = false;
            setAsking(false);
            if (readyRef.current) window.location.reload();
          }}
          onLeave={() => leave(new URL(backHref, window.location.href))}
        />
      )}
    </>
  );
}
