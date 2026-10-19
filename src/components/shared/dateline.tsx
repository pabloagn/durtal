"use client";

import { useSyncExternalStore } from "react";
import { formatDateline } from "@/lib/utils/dateline";

const noChange = () => () => {};

/**
 * Today as a dateline in the reader's own time zone (SLN-932). The server
 * writes its own day; the browser puts its own in after hydration, so a reader
 * in Los Angeles on Thursday evening is not told it is Friday.
 */
export function Dateline({ initial }: { initial: string }) {
  const text = useSyncExternalStore(noChange, () => formatDateline(new Date()), () => initial);
  return <>{text}</>;
}
