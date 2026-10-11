import type { RunningTimer } from "@/lib/reading/timer-service";

/** Successful null means the database confirmed that no timer is running. */
export interface ReaderRuntimeV1 {
  version: 1;
  readingTimerCheckMinutes: number;
  runningTimer: RunningTimer | null;
  readingHome: string | null;
}

export type ReaderRuntime =
  | { status: "ready"; value: ReaderRuntimeV1 }
  | { status: "unavailable"; code: "reader_runtime_unavailable" };
