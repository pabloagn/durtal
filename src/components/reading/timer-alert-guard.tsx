"use client";
import { createContext } from "react";

/** The reader installs a guard before lazy timer controls can render. */
export const TimerAlertGuardContext = createContext<{
  current: ((kind: "conflict" | "discard" | "forgotten", close: () => void) => void) | null;
} | null>(null);
