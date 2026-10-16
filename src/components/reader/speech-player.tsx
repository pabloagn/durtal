"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import {
  AudioLines,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ReaderBarItem } from "./reader-bar-item";
import { SpeechOptionsMenu } from "./speech-options-menu";
import { SpeechVoiceMenu } from "./speech-voice-menu";
import { isNaturalVoice } from "@/lib/reader/speech/cloud-speaker";
import type {
  SpeechAction,
  SpeechPlayerState,
} from "@/lib/reader/speech/player";
import {
  choosePassageVoice,
  rememberSpeechVoice,
  speechLanguageLabel,
  SPEECH_RATES,
  type SpeechPreferences,
  type SpeechVoice,
} from "@/lib/reader/speech/voices";

type PlayerAction = Extract<
  SpeechAction,
  { kind: "play" | "pause" | "stop" | "skip" }
>;
function Control({
  label,
  keys,
  onClick,
  disabled,
  children,
}: {
  label: string;
  keys?: string;
  onClick(): void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tooltip={label}
      data-tooltip-keys={keys}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-sm text-fg-secondary hover:bg-bg-tertiary/50 disabled:opacity-40 pointer-coarse:size-11 focus-visible:outline-offset-[-2px]"
    >
      {children}
    </button>
  );
}
export function SpeechStartButton({
  ready,
  onStart,
}: {
  ready: boolean;
  onStart(): void;
}) {
  return (
    <ReaderBarItem
      label="Read aloud"
      keys="a"
      disabled={!ready}
      onSelect={onStart}
      icon={<AudioLines className="size-4" strokeWidth={1.5} aria-hidden="true" />}
    />
  );
}

/** Persistent reader speech controls; state and effects belong to the session coordinator. */
export function SpeechPlayer({
  open,
  state,
  voices,
  preferences,
  bookLanguage,
  bottomInset,
  voiceNotice = null,
  onAction,
  onPreferences,
  onHeightChange,
}: {
  open: boolean;
  state: SpeechPlayerState;
  voices: readonly SpeechVoice[];
  preferences: SpeechPreferences;
  bookLanguage: string | null;
  bottomInset: number;
  voiceNotice?: string | null;
  onAction(action: PlayerAction): void;
  onPreferences(preferences: SpeechPreferences): void;
  onHeightChange(height: number): void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const heightChanged = useRef(onHeightChange);
  useLayoutEffect(() => {
    heightChanged.current = onHeightChange;
  });
  useLayoutEffect(() => {
    if (!open || !bar.current) return;
    const element = bar.current;
    const measure = () =>
      heightChanged.current(element.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      heightChanged.current(0);
    };
  }, [open]);
  if (!open) return null;
  const choice = choosePassageVoice(
    voices,
    state.current?.lang ?? null,
    bookLanguage,
    preferences,
  );
  const selected = choice.kind === "available" ? choice.voice : null;
  const playing =
    state.phase === "starting" ||
    state.phase === "playing" ||
    (state.phase === "preparing" && state.autoPlay);
  const ready =
    !!state.current &&
    (state.phase === "ready" || state.phase === "paused") &&
    !!selected;
  const language = speechLanguageLabel(
    choice.kind === "missing" ? choice.language : bookLanguage,
  );
  return (
    <div
      ref={bar}
      data-reader-chrome
      data-speech-player
      className="glass-bar fixed inset-x-reader z-30 overflow-hidden border-t border-glass-border text-fg-primary motion-reduce:transition-none"
      style={{ bottom: bottomInset }}
    >
      <div
        role="toolbar"
        aria-label="Read aloud controls"
        className="flex min-h-11 items-center justify-center gap-1 px-2 py-1"
      >
        <Control
          label="Previous sentence"
          keys=","
          onClick={() => onAction({ kind: "skip", direction: "previous" })}
          disabled={!state.current}
        >
          <SkipBack className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </Control>
        <Control
          label={playing ? "Pause reading aloud" : "Play reading aloud"}
          keys="a"
          disabled={!playing && !ready}
          onClick={() => onAction({ kind: playing ? "pause" : "play" })}
        >
          {playing ? (
            <Pause className="size-4" strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Play className="size-4" strokeWidth={1.5} aria-hidden="true" />
          )}
        </Control>
        <Control
          label="Next sentence"
          keys="."
          onClick={() => onAction({ kind: "skip", direction: "next" })}
          disabled={!state.current}
        >
          <SkipForward
            className="size-4"
            strokeWidth={1.5}
            aria-hidden="true"
          />
        </Control>
        <SpeechOptionsMenu
          label="Read aloud speed"
          value={`${preferences.rate}×`}
        >
          {(close, sheet) =>
            SPEECH_RATES.map((rate) => {
              const content = (
                <>
                  {rate === preferences.rate && (
                    <span className="sr-only">Selected: </span>
                  )}
                  {rate}×
                </>
              );
              const choose = () => {
                onPreferences({ ...preferences, rate });
                close();
              };
              return sheet ? (
                <button
                  key={rate}
                  type="button"
                  aria-pressed={rate === preferences.rate}
                  onClick={choose}
                  className="block min-h-11 w-full rounded-sm px-3 py-2 text-left text-sm text-fg-secondary hover:bg-bg-tertiary"
                >
                  {content}
                </button>
              ) : (
                <DropdownMenuItem key={rate} onClick={choose}>
                  {content}
                </DropdownMenuItem>
              );
            })
          }
        </SpeechOptionsMenu>
        <div className="min-w-0 max-w-[35%]">
          <SpeechVoiceMenu
            voices={voices}
            bookLanguage={bookLanguage}
            selected={selected}
            onChoose={(voiceURI) =>
              onPreferences(
                rememberSpeechVoice(
                  preferences,
                  (state.current?.lang && state.current.lang !== "und"
                    ? state.current.lang
                    : bookLanguage) ?? "und",
                  voiceURI,
                  voices.some(isNaturalVoice),
                ),
              )
            }
          />
        </div>
        <Control
          label="Stop reading aloud"
          keys="esc"
          onClick={() => onAction({ kind: "stop" })}
        >
          <X className="size-4" strokeWidth={1.5} aria-hidden="true" />
        </Control>
      </div>
      {state.phase === "preparing" && !state.autoPlay && !state.message && (
        <p role="status" className="px-3 pb-2 text-sm text-fg-secondary">
          Preparing text to read aloud…
        </p>
      )}
      {(state.message || voiceNotice || !selected) && (
        <p className="px-3 pb-2 text-sm text-fg-secondary">
          {state.message ??
            voiceNotice ??
            (voices.length
              ? `No voice for ${language} on this device. Choose another voice.`
              : "No voices on this device.")}
        </p>
      )}
    </div>
  );
}
