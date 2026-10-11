"use client";
import { useCallback, useEffect, useRef } from "react";
import type { EngineEvents } from "@/lib/reader/engine";
import type { SpeechPhase } from "@/lib/reader/speech/player";

type Location = EngineEvents["relocate"];
const pageOrPercent = (location: Location, jump: boolean) => {
  const label = location.locator.pageLabel;
  if (label) return `${jump ? "page" : "Page"} ${label}`;
  return `${Math.round(Math.max(0, Math.min(1, location.locator.totalProgression)) * 100)}%`;
};
export function readerLocationAnnouncement(location: Location): string {
  if (location.origin === "speech" || location.origin === "layout") return "";
  if (location.reason !== "jump" && location.reason !== "turn") return "";
  const page = pageOrPercent(location, location.reason === "jump");
  return location.reason === "jump" && location.chapter
    ? `${location.chapter}, ${page}`
    : page;
}

/** One status region; no per-sentence announcements or animation-frame loop. */
export function ReaderAnnouncer({
  location,
  speechPhase,
}: {
  location: Location | null;
  speechPhase: SpeechPhase;
}) {
  const status = useRef<HTMLParagraphElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocation = useRef<string | null>(null);
  const lastSpeech = useRef<string | null>(null);
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const announce = useCallback((text: string) => {
    if (status.current) status.current.textContent = text;
  }, []);
  useEffect(() => {
    if (!location) return;
    const key = JSON.stringify([
      location.reason,
      location.chapter,
      location.locator.fileHash,
      location.locator.sectionIndex,
      location.locator.cfi,
      location.locator.pdf?.page,
      location.locator.pageLabel,
      location.locator.totalProgression,
    ]);
    if (key === lastLocation.current) return;
    lastLocation.current = key;
    const text = readerLocationAnnouncement(location);
    if (!text) return;
    clear();
    if (location.reason === "jump") announce(text);
    else
      timer.current = setTimeout(() => {
        timer.current = null;
        announce(text);
      }, 700);
  }, [location, clear, announce]);
  useEffect(() => {
    const text =
      speechPhase === "playing"
        ? "Reading aloud"
        : speechPhase === "paused"
          ? "Paused"
          : speechPhase === "stopped" && lastSpeech.current !== null
            ? "Stopped"
            : null;
    if (!text || text === lastSpeech.current) return;
    lastSpeech.current = text;
    clear();
    announce(text);
  }, [speechPhase, clear, announce]);
  useEffect(() => clear, [clear]);
  return (
    <p
      ref={status}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}
