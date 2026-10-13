"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BrowserLookupTranslator } from "@/lib/reader/lookup/browser-translator";
import { translationLinks, translationMode, type TranslatorAvailability } from "@/lib/reader/lookup/translate";
import { DEEPL_SOURCE_LANGUAGES, GOOGLE_LANGUAGES } from "@/lib/reader/lookup/provider-languages";
import { languageName } from "@/lib/utils/language";
import { MAX_TRANSLATION_CHARACTERS } from "@/lib/reader/lookup/candidates";
import { operationSignal } from "@/lib/reader/lookup/resources";
import { LookupSkeleton } from "./lookup-html";
export function TranslateTab({ source, target, text, translator }: {
  source: string; target: string; text: string; translator: BrowserLookupTranslator;
}) {
  const [availability, setAvailability] = useState<TranslatorAvailability | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const scope = useRef<ReturnType<typeof operationSignal> | null>(null);
  const current = useRef<AbortController | null>(null);
  const running = useRef(false);
  const valid = text.length <= MAX_TRANSLATION_CHARACTERS && !!text.trim();
  const run = (parent: AbortSignal) => {
    if (running.current || parent.aborted) return;
    running.current = true;
    scope.current?.dispose();
    const operation = operationSignal(parent, 120000); scope.current = operation;
    setPending(true); setError(null); setProgress(0);
    // create() begins in this synchronous click stack if a model is needed.
    void translator.translate(source, target, text, operation.signal, setProgress).then(value => {
      if (!operation.signal.aborted) { setResult(value); setAvailability("available"); }
    }).catch(() => { if (!parent.aborted) setError("Translation on this device is unavailable. Use a link below."); })
      .finally(() => {
        operation.dispose();
        if (scope.current === operation) running.current = false;
        if (!parent.aborted) setPending(false);
      });
  };
  useEffect(() => {
    const controller = new AbortController(); current.current = controller;
    const availabilityScope = operationSignal(controller.signal, 10000);
    setResult(null); setError(null); setProgress(null); setPending(false); setAvailability(null); setChecked(false);
    if (valid && source !== target) void translator.availability(source, target, availabilityScope.signal).then(value => {
      if (!controller.signal.aborted) {
        setAvailability(value);
        if (value === "available") run(controller.signal);
      }
    }).catch(() => {}).finally(() => {
      availabilityScope.dispose();
      if (!controller.signal.aborted) setChecked(true);
    });
    return () => { controller.abort(); running.current = false; availabilityScope.dispose(); scope.current?.dispose(); };
    // The session translator outlives a panel. Every text/language generation owns cancellation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, target, text, translator, valid]);
  const mode = translationMode(source, target, availability);
  const links = translationLinks({ source, target, text, deeplLanguages: DEEPL_SOURCE_LANGUAGES, googleLanguages: GOOGLE_LANGUAGES });
  if (!valid) return <p className="text-fg-secondary">Select at most 1,000 characters to translate</p>;
  return <div className="space-y-4">
    {mode === "same-language" ? <p className="text-fg-secondary">This passage is already in {languageName(target)}. Choose another translation target in the language menu.</p> :
      pending ? <><LookupSkeleton />{progress !== null && <p role="status" className="text-xs text-fg-secondary">{Math.round(progress * 100)}% downloaded</p>}</> :
      result ? <><p className="whitespace-pre-wrap">{result}</p><p className="text-xs text-fg-secondary">Translated on this device by Chrome</p></> :
      mode === "download" ? <Button className="h-auto py-2 text-left [white-space:normal]" onClick={() => current.current && run(current.current.signal)}>Download the {languageName(source)} to {languageName(target)} model (Chrome, on this device)</Button> :
      mode === "links" && checked && !error ? <p className="text-fg-secondary">This browser can&rsquo;t translate {languageName(source)} to {languageName(target)} on the device. Open the passage in:</p> :
      mode === "links" ? <LookupSkeleton /> : null}
    {error && <p role="status" className="text-fg-secondary">{error}</p>}
    <div className="flex flex-wrap gap-4 text-sm">
      {links.deepl && <a className="min-h-8 py-2 text-accent-primary underline pointer-coarse:min-h-11" href={links.deepl} target="_blank" rel="noopener noreferrer">Open in DeepL ↗</a>}
      {links.google && <a className="min-h-8 py-2 text-accent-primary underline pointer-coarse:min-h-11" href={links.google} target="_blank" rel="noopener noreferrer">Open in Google Translate ↗</a>}
    </div>
  </div>;
}
