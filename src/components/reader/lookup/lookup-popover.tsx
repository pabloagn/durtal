"use client";
import { useId, useRef, useState } from "react";
import { Select } from "@/components/ui/select";
import { AnchoredReaderPopover } from "@/components/reader/anchored-reader-popover";
import type { SelectionDetails } from "@/lib/reader/engine";
import type { LookupSettings } from "@/lib/validations/reader-lookup";
import type { BrowserLookupTranslator } from "@/lib/reader/lookup/browser-translator";
import type { LookupRect } from "@/lib/reader/lookup/placement";
import { languageName, languageOptions } from "@/lib/utils/language";
import { DictionaryTab, type DictionaryState } from "./dictionary-tab";
import { WikipediaTab, type WikipediaState } from "./wikipedia-tab";
import { SourcesTab } from "./sources-tab";
import { TranslateTab } from "./translate-tab";
export type LookupTab = "dictionary" | "wikipedia" | "sources" | "translate";
export function LookupPopover({ details, language, guessed, word, passage, keyboard, reference,
  avoid, settings, target, translator, dictionary, wikipedia, active, onTab, onLanguage, onTarget, onClose, keyDocument, touch }: {
  details: SelectionDetails; language: string; guessed: boolean; word: string; passage: boolean;
  keyboard: boolean; reference?: HTMLElement; avoid: LookupRect | null; settings: LookupSettings; target: string;
  translator: BrowserLookupTranslator; dictionary: DictionaryState; wikipedia: WikipediaState;
  active: LookupTab; onTab(tab: LookupTab): void; onLanguage(language: string): void; onTarget(language: string): void;
  onClose(reason?: "escape" | "outside" | "button"): void;
  keyDocument?: Document;
  touch?: boolean;
}) {
  const id = useId(), tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [languagesOpen, setLanguagesOpen] = useState(false);
  const choices: { id: LookupTab; label: string }[] = passage
    ? [{ id: "sources", label: "Your sources" }, { id: "translate", label: "Translate" }]
    : [{ id: "dictionary", label: "Dictionary" }, { id: "wikipedia", label: "Wikipedia" },
      { id: "sources", label: "Your sources" }, { id: "translate", label: "Translate" }];
  return <AnchoredReaderPopover title={word} anchor={details.rect} avoid={avoid} keyboard={keyboard}
    reference={reference} keyDocument={keyDocument} preferBelow={touch} variant="lookup" dialogLabel={"Look up " + word} closeLabel="Close lookup"
    initialFocusSelector='[role="tab"][aria-selected="true"]' onClose={onClose}
    action={<button type="button" className="h-8 max-w-48 truncate px-2 font-sans text-xs text-fg-secondary pointer-coarse:min-h-11"
      aria-label={"Lookup language: " + languageName(language) + (guessed ? " (guessed)" : "") + (language === target ? "" : ", translate into " + languageName(target))}
      aria-expanded={languagesOpen} aria-controls={id + "-languages"} data-tooltip="Change lookup language or translation target"
      onClick={() => setLanguagesOpen(value => !value)}>{languageName(language)}{guessed ? " (guessed)" : ""}{language === target ? "" : ` → ${languageName(target)}`}</button>}
    fixedContent={<>
      {languagesOpen && <div id={id + "-languages"} className="shrink-0 border-b border-glass-border px-4 py-3">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Lookup language" options={languageOptions(language)} value={language}
            onChange={event => { onLanguage(event.target.value); setLanguagesOpen(false); }} />
          <Select label="Translate into" options={languageOptions(target)} value={target}
            onChange={event => { onTarget(event.target.value); setLanguagesOpen(false); }} />
        </div>
      </div>}
      <div role="tablist" aria-label="Lookup sources" className="flex shrink-0 flex-wrap border-b border-glass-border px-2">
        {choices.map((tab, index) => <button key={tab.id} ref={element => { tabs.current[index] = element; }}
          type="button" role="tab" id={id + "-" + tab.id} aria-controls={id + "-panel-" + tab.id}
          aria-selected={active === tab.id} tabIndex={active === tab.id ? 0 : -1}
          className={"min-h-8 px-2 py-2 text-xs pointer-coarse:min-h-11 " + (active === tab.id ? "text-fg-primary underline underline-offset-8" : "text-fg-secondary")}
          onClick={() => onTab(tab.id)} onKeyDown={event => {
            const next = event.key === "ArrowRight" ? (index + 1) % choices.length :
              event.key === "ArrowLeft" ? (index + choices.length - 1) % choices.length :
              event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); event.stopPropagation(); onTab(choices[next].id); tabs.current[next]?.focus();
          }}>{tab.label}</button>)}
      </div>
    </>}>
      <div role="tabpanel" id={id + "-panel-" + active} aria-labelledby={id + "-" + active} tabIndex={0} className="outline-none">
        {active === "dictionary" && !passage && <DictionaryTab state={dictionary} language={language} word={word} />}
        {active === "wikipedia" && !passage && <WikipediaTab state={wikipedia} word={word} />}
        {active === "sources" && <SourcesTab settings={settings} language={language} word={word} />}
        {active === "translate" && <TranslateTab source={language} target={target} text={details.text} translator={translator} />}
      </div>
  </AnchoredReaderPopover>;
}
