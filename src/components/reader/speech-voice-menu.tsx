"use client";
import { Fragment } from "react";
import { Check } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { SpeechOptionsMenu } from "./speech-options-menu";
import {
  groupSpeechVoices,
  speechLanguageLabel,
  type SpeechVoice,
} from "@/lib/reader/speech/voices";

export function SpeechVoiceMenu({
  voices,
  bookLanguage,
  selected,
  onChoose,
}: {
  voices: readonly SpeechVoice[];
  bookLanguage: string | null;
  selected: SpeechVoice | null;
  onChoose(voiceURI: string): void;
}) {
  const groups = groupSpeechVoices(voices, bookLanguage);
  return (
    <SpeechOptionsMenu
      label="Read aloud voice"
      value={selected?.name ?? "Choose voice"}
    >
      {(close, sheet) => (
        <>
          {!groups.length && (
            <p className="px-3 py-2 text-sm text-fg-secondary">
              No voices available on this device.
            </p>
          )}
          {groups.map((group) => (
            <Fragment key={group.language}>
              <DropdownMenuLabel>
                {speechLanguageLabel(group.language)}
              </DropdownMenuLabel>
              {group.voices.map((voice) => {
                const chosen = selected?.voiceURI === voice.voiceURI;
                const label = (
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="sr-only">
                      {speechLanguageLabel(group.language)},{" "}
                    </span>
                    {chosen && <span className="sr-only">Selected: </span>}
                    <span className="min-w-0 flex-1">
                      <span className="lines-1">{voice.name}</span>
                      {voice.description && (
                        <span className="lines-1 text-xs text-fg-secondary">
                          {voice.description}
                        </span>
                      )}
                    </span>
                    {chosen && (
                      <Check
                        aria-hidden="true"
                        className="size-4 shrink-0"
                        strokeWidth={1.5}
                      />
                    )}
                  </span>
                );
                const choose = () => {
                  onChoose(voice.voiceURI);
                  close();
                };
                return sheet ? (
                  <button
                    key={voice.voiceURI}
                    type="button"
                    aria-pressed={chosen}
                    onClick={choose}
                    className="block min-h-11 w-full rounded-sm px-3 py-2 text-left text-sm text-fg-secondary hover:bg-bg-tertiary"
                  >
                    {label}
                  </button>
                ) : (
                  <DropdownMenuItem key={voice.voiceURI} onClick={choose}>
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </Fragment>
          ))}
        </>
      )}
    </SpeechOptionsMenu>
  );
}
