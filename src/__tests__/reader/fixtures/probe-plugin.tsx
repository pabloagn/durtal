"use client";
import { useReaderContext, useReaderEvent } from "@/components/reader/bridge";
import type { ReaderEvents } from "@/lib/reader/events";
/** Tests only: subscribes to every event without mounting a production tracker. */
export function ProbePlugin({ data }: { data: unknown }) {
  const report = (
    data as { report?: (name: keyof ReaderEvents, event: unknown) => void }
  )?.report;
  useReaderEvent("activity", (event) => report?.("activity", event));
  useReaderEvent("location", (event) => report?.("location", event));
  useReaderEvent("end", (event) => report?.("end", event));
  useReaderEvent("selection", (event) => report?.("selection", event));
  const context = useReaderContext();
  return <output data-reader-probe>{context.percent ?? "opening"}</output>;
}
