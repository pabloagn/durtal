import "server-only";
import { cache } from "react";
import { getRunningTimer } from "@/lib/actions/reading";
import { isUuid } from "@/lib/utils/uuid";
import { readReaderSettings } from "./settings-request";
import type { ReaderRuntime } from "./runtime";

export function readerHome(raw: string | null): string | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    return typeof value === "string" && (value === "none" || isUuid(value))
      ? value
      : null;
  } catch {
    return null;
  }
}

/** Page composition starts this alongside the book and plugin loaders. */
export const loadReaderRuntime = cache(async (rawHome: string | null): Promise<ReaderRuntime> => {
  const [settings, timer] = await Promise.allSettled([
    readReaderSettings(),
    getRunningTimer(),
  ]);
  if (settings.status === "rejected" || timer.status === "rejected") {
    if (settings.status === "rejected") console.error("[reader] Settings unavailable:", settings.reason);
    if (timer.status === "rejected") console.error("[reader] Timer unavailable:", timer.reason);
    return { status: "unavailable", code: "reader_runtime_unavailable" };
  }
  return {
    status: "ready",
    value: {
      version: 1,
      readingTimerCheckMinutes: settings.value.readingTimerCheckMinutes,
      runningTimer: timer.value,
      readingHome: readerHome(rawHome),
    },
  };
});
