"use client";

import { useEffect, useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { CapAligned } from "@/components/shared/cap-aligned";
import { clockText, durationSpoken, durationWords, isForgotten, shouldAsk, suggestedStop } from "@/lib/reading/timer";
import { Cover } from "./reading-tiles";
import { useReadingDialogs } from "./reading-dialogs-provider";
import { useOptionalTimer, useTimer } from "./timer-provider";
import type { ReadingDialogProps } from "./reading-provider";

/*
 * The timer chip (SLN-451): in the expanded sidebar, the icon rail and the
 * phone bar. Not glass itself (it sits in the sidebar or the glass bar); its
 * menus are. It renders nothing until a timer runs, and nothing on the
 * server, so no page gets heavier.
 */

const ICON_BUTTON =
  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary pointer-coarse:h-11 pointer-coarse:w-11";

/** Opens Log progress in stop mode for the running timer, at an end time when one is given */
export function useStopTimer() {
  const timer = useOptionalTimer()?.timer ?? null;
  const { open } = useReadingDialogs();
  return (endedAt?: Date) => {
    if (!timer) return;
    void open({
      kind: "progress",
      workId: timer.workId,
      readingId: timer.readingId,
      fingerprint: timer.fingerprint,
      timer: {
        sessionId: timer.sessionId,
        startedAt: timer.startedAt,
        pausedAt: timer.pausedAt,
        pausedSeconds: timer.pausedSeconds,
        ...(endedAt ? { endedAt: endedAt.toISOString() } : {}),
      },
    });
  };
}

export type TimerChipLayout = "expanded" | "rail" | "phone";

export function TimerChip({ layout }: { layout: TimerChipLayout }) {
  const { timer, elapsed, checkMinutes, pause, resume, setDiscarding } = useTimer();
  const stop = useStopTimer();
  if (!timer) return null;
  const paused = !!timer.pausedAt;
  const ask = !paused && shouldAsk(elapsed, checkMinutes);
  const name = `Timer for ${timer.title}, ${durationSpoken(elapsed)}${paused ? ", paused" : ""}`;
  const time = (
    <span className={`tabular-nums ${paused ? "text-fg-secondary" : "text-fg-primary"}`} aria-hidden>
      {clockText(elapsed)}
    </span>
  );
  const pauseButton = (
    <button
      type="button"
      onClick={() => void (paused ? resume() : pause())}
      aria-label={paused ? "Resume timer" : "Pause timer"}
      data-tooltip={paused ? "Resume timer" : "Pause timer"}
      className={ICON_BUTTON}
      data-timer-pause=""
    >
      {paused ? <Play className="h-4 w-4" strokeWidth={1.5} /> : <Pause className="h-4 w-4" strokeWidth={1.5} />}
    </button>
  );
  const stopIcon = <Square className="h-4 w-4" strokeWidth={1.5} />;
  const menu = (trigger: React.ReactElement<{ className?: string }>, side: "top" | "bottom", align: "start" | "end") => (
    // No menu label: the trigger keeps its own name ("Timer for Nadja, 12 minutes") and tooltip
    <DropdownMenu trigger={trigger as never} side={side} align={align}>
      <DropdownMenuLabel>{ask ? `Still reading ${timer.title}?` : timer.title}</DropdownMenuLabel>
      <DropdownMenuItem onClick={() => void (paused ? resume() : pause())}>{paused ? "Resume" : "Pause"}</DropdownMenuItem>
      <DropdownMenuItem onClick={() => setDiscarding(true)}>Discard</DropdownMenuItem>
    </DropdownMenu>
  );

  if (layout === "phone")
    return (
      <div className="flex" data-timer-chip="phone">
        <CapAligned height={44}>
          {menu(
            <button
              type="button"
              aria-label={name}
              data-tooltip={ask ? "Still reading?" : `Timer for ${timer.title}`}
              data-tooltip-side="bottom"
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-sm px-2 font-sans text-sm transition-colors hover:bg-bg-tertiary/50"
              data-timer-time=""
            >
              {time}
            </button>,
            "bottom",
            "end",
          )}
        </CapAligned>
        <CapAligned height={44}>
          <button
            type="button"
            onClick={() => stop()}
            aria-label="Stop timer"
            data-tooltip="Stop timer"
            data-tooltip-side="bottom"
            className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary"
            data-timer-stop=""
          >
            {stopIcon}
          </button>
        </CapAligned>
      </div>
    );

  if (layout === "rail")
    return (
      <div className="flex flex-col items-center gap-1 px-1.5 pb-2" data-timer-chip="rail">
        {menu(
          <button
            type="button"
            aria-label={name}
            data-tooltip={ask ? "Still reading?" : `Timer for ${timer.title}`}
            data-tooltip-side="right"
            className="inline-flex h-7 w-11 items-center justify-center rounded-sm text-xs transition-colors hover:bg-bg-tertiary/50"
            data-timer-time=""
          >
            {time}
          </button>,
          "top",
          "start",
        )}
        <button
          type="button"
          onClick={() => stop()}
          aria-label="Stop timer"
          data-tooltip="Stop timer"
          data-tooltip-side="right"
          className="inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-secondary transition-colors hover:bg-bg-tertiary/50 hover:text-fg-primary"
          data-timer-stop=""
        >
          {stopIcon}
        </button>
      </div>
    );

  return (
    <div className="px-3 pb-2" data-timer-chip="expanded">
      <div role="group" aria-label="Reading timer" className="flex items-start gap-2.5 rounded-sm border border-glass-border bg-bg-primary/50 px-2 py-1.5">
        {/* No icon on a blank thumb: at this size it reads as a misaligned icon beside the time */}
        <Cover s3Key={timer.cover} className="h-9 w-6" icon={false} />
        {/* The time and title open the menu with Discard, as the time does in the rail and the phone bar */}
        <div className="flex min-w-0 flex-1 [&>div]:min-w-0 [&>div]:flex-1">
          {menu(
            <button
              type="button"
              aria-label={name}
              data-tooltip={ask ? "Still reading?" : `Timer for ${timer.title}`}
              className="min-w-0 flex-1 rounded-sm text-left transition-colors hover:bg-bg-tertiary/50"
              data-timer-time=""
            >
              <span className="block text-sm leading-5">{time}</span>
              <span className="lines-1 text-xs text-fg-secondary" data-timer-title="">
                {ask ? "Still reading?" : timer.title}
              </span>
            </button>,
            "top",
            "start",
          )}
        </div>
        {/* On the cap-height center of the time */}
        <CapAligned height={28} coarseHeight={44} className="text-sm leading-5">
          {pauseButton}
        </CapAligned>
        <CapAligned height={28} coarseHeight={44} className="text-sm leading-5">
          <button type="button" onClick={() => stop()} aria-label="Stop timer" data-tooltip="Stop timer" className={ICON_BUTTON} data-timer-stop="">
            {stopIcon}
          </button>
        </CapAligned>
      </div>
    </div>
  );
}

/** Finish, Abandon or Delete while this reading's timer runs: Stop or Discard first */
export function TimerBlockDialog({ data, row, request, onClose, open }: ReadingDialogProps) {
  const { timer, elapsed, setDiscarding } = useTimer();
  if (!timer || !row) return null;
  const title = request.kind === "finish" ? "Finish" : request.kind === "abandon" ? "Abandon" : "Delete reading";
  return (
    <Dialog open onClose={onClose} title={title} description={data.workTitle} className="max-w-md" expandable={false}>
      <p className="text-sm text-fg-secondary" data-timer-block="">
        The timer for {timer.title} has run {durationWords(elapsed)}. Stop or discard it first.
      </p>
      <div className="flex justify-end gap-2 pt-4">
        <Button
          variant="ghost"
          className="pointer-coarse:h-11"
          onClick={() => {
            onClose();
            setDiscarding(true);
          }}
        >
          Discard
        </Button>
        <Button
          variant="primary"
          className="pointer-coarse:h-11"
          onClick={() =>
            open({
              kind: "progress",
              readingId: row.reading.id,
              timer: { sessionId: timer.sessionId, startedAt: timer.startedAt, pausedAt: timer.pausedAt, pausedSeconds: timer.pausedSeconds },
            })
          }
        >
          Stop timer
        </Button>
      </div>
    </Dialog>
  );
}

const STILL_KEY = "durtal-timer-still-reading";

/** "21:30" in the browser's zone */
const clockOf = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The forgotten-timer question, "Stop it and start this one", and the discard question */
export function TimerAlerts() {
  const { timer, elapsed, checkMinutes, conflict, setConflict, setPendingStart, discarding, setDiscarding, discard } = useTimer();
  const stop = useStopTimer();
  const [asking, setAsking] = useState(false);
  const [at, setAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  // On open, focus and a visible tab (each loads the timer again): ask about a forgotten timer
  useEffect(() => {
    if (!timer || timer.pausedAt) return setAsking(false);
    const seconds = elapsed;
    if (!isForgotten(seconds, checkMinutes)) return;
    let still: { sessionId: string; until: number } | null = null;
    try {
      still = JSON.parse(localStorage.getItem(STILL_KEY) ?? "null");
    } catch {
      still = null;
    }
    if (still && still.sessionId === timer.sessionId && seconds < still.until) return;
    setAsking(true);
    // Only when the timer loads again, not on every tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timer]);

  if (!timer) return null;
  const suggested = suggestedStop(timer, checkMinutes);

  function stillReading() {
    try {
      localStorage.setItem(STILL_KEY, JSON.stringify({ sessionId: timer!.sessionId, until: elapsed + checkMinutes * 60 }));
    } catch {}
    setAsking(false);
  }
  function stopAtField() {
    const m = at.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return setError("Enter a time such as 21:30");
    const end = new Date();
    end.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (end.getTime() > Date.now()) end.setDate(end.getDate() - 1);
    if (end.getTime() <= new Date(timer!.startedAt).getTime()) return setError("That is before the timer started");
    setAsking(false);
    stop(end);
  }

  return (
    <>
      {asking && (
        <Dialog
          open
          onClose={stillReading}
          title="Still reading?"
          description={`Your timer for ${timer.title} has been running for ${durationWords(elapsed)}. When did you stop?`}
          className="max-w-md"
          expandable={false}
        >
          <div className="space-y-4" data-timer-forgotten="">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                className="pointer-coarse:h-11"
                onClick={() => {
                  setAsking(false);
                  stop(suggested);
                }}
                data-timer-stopped-at=""
              >
                Stopped at {clockOf(suggested)}
              </Button>
              <Button variant="secondary" className="pointer-coarse:h-11" onClick={stillReading} data-timer-still="">
                Still reading
              </Button>
            </div>
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                stopAtField();
              }}
            >
              <Input label="Or stopped at" type="time" value={at} onChange={(e) => (setAt(e.target.value), setError(null))} error={error ?? undefined} />
              <Button type="submit" variant="secondary" className="pointer-coarse:h-11">
                Stop then
              </Button>
            </form>
            <Button
              variant="ghost"
              className="pointer-coarse:h-11"
              onClick={() => {
                setAsking(false);
                setDiscarding(true);
              }}
            >
              Discard
            </Button>
          </div>
        </Dialog>
      )}
      {conflict && (
        <Dialog
          open
          onClose={() => setConflict(null)}
          title={`A timer is running for ${timer.title}`}
          description={`Stop it to start one for ${conflict.title}.`}
          className="max-w-md"
          expandable={false}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="pointer-coarse:h-11" onClick={() => setConflict(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="pointer-coarse:h-11"
              data-timer-switch=""
              onClick={() => {
                setPendingStart(conflict);
                setConflict(null);
                stop();
              }}
            >
              Stop it and start this one
            </Button>
          </div>
        </Dialog>
      )}
      {discarding && (
        <Dialog
          open
          onClose={() => setDiscarding(false)}
          title={elapsed < 60 ? `Discard the timer for ${timer.title}?` : `Discard ${durationWords(elapsed)} of timing for ${timer.title}?`}
          className="max-w-md"
          expandable={false}
        >
          <p className="text-sm text-fg-secondary">The time is not saved. Where you are in the book does not change.</p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" className="pointer-coarse:h-11" onClick={() => setDiscarding(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="pointer-coarse:h-11"
              data-timer-discard=""
              onClick={() => {
                setDiscarding(false);
                void discard();
              }}
            >
              Discard
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
