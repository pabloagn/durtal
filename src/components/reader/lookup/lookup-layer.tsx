"use client";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { BookA } from "lucide-react";
import { ReaderSlotFill, useReaderEvent, useReaderFeatureShortcut } from "@/components/reader/bridge";
import type { ReaderEngine, SelectionDetails } from "@/lib/reader/engine";
import { lookupCandidates, lookupSelection } from "@/lib/reader/lookup/candidates";
import { lookupLanguage } from "@/lib/reader/lookup/language";
import { lookupWiktionary } from "@/lib/reader/lookup/wiktionary";
import { lookupWikipedia } from "@/lib/reader/lookup/wikipedia";
import { LookupPacksClient } from "@/lib/reader/lookup/packs";
import { browserPackStore } from "@/lib/reader/lookup/pack-store";
import { BrowserLookupTranslator } from "@/lib/reader/lookup/browser-translator";
import { browserLookupHistoryStore, recordLookupHistory, type LookupHistoryStore } from "@/lib/reader/lookup/history";
import { LookupSessionCache } from "@/lib/reader/lookup/session-cache";
import { afterLookupFirstPaint, readLocalLookupSettings, writeLocalLookupSettings,
  LOOKUP_SETTINGS_CHANGED, LOOKUP_SETTINGS_KEY } from "@/lib/reader/lookup/preferences";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import { lookupSettingsSchema, type LookupSettings } from "@/lib/validations/reader-lookup";
import { getLookupSettings } from "@/lib/actions/reader-lookup";
import { LookupPopover, type LookupTab } from "./lookup-popover";
import type { DictionaryState } from "./dictionary-tab";
import type { WikipediaState } from "./wikipedia-tab";
type Model = { dictionary: DictionaryState; wikipedia: WikipediaState };
type OpenLookup = { id: number; details: SelectionDetails; language: string; guessed: boolean;
  word: string; passage: boolean; keyboard: boolean; reference?: HTMLElement;
  keyDocument?: Document;
  touch?: boolean;
  historyId: Promise<number | null> | null };
type Resources = { packs: LookupPacksClient; store: ReturnType<typeof browserPackStore>;
  translator: BrowserLookupTranslator; history: LookupHistoryStore; cache: LookupSessionCache<Model> };
function initialModel(): Model {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return { dictionary: { packs: [], entries: [], packsPending: true, packError: null,
    english: null, own: null, offline }, wikipedia: { value: null, pending: !offline, offline } };
}
const cacheKey = (language: string, text: string) =>
  language + ":" + text + ":" + (navigator.onLine ? "online" : "offline");
export function LookupLayer({ engine, ebook, toolbarRef, enabled = true }: {
  engine: ReaderEngine; ebook: { id: string; title: string; language?: string | null; editionLanguage?: string | null };
  toolbarRef: RefObject<HTMLDivElement | null>; enabled?: boolean;
}) {
  const [resources, setResources] = useState<Resources | null>(null);
  const [settings, setSettings] = useState<LookupSettings>(defaultLookupSettings);
  const [opened, setOpened] = useState<OpenLookup | null>(null);
  const [model, setModel] = useState<Model>(initialModel);
  const [active, setActive] = useState<LookupTab>("dictionary");
  const [target, setTarget] = useState("en");
  const generation = useRef(0), pending = useRef<AbortController | null>(null);
  const current = useRef(opened), currentSettings = useRef(settings), clients = useRef(resources);
  const chosenTab = useRef(false), historyAbort = useRef<AbortController | null>(null);
  useLayoutEffect(() => { current.current = opened; currentSettings.current = settings; clients.current = resources; });
  useEffect(() => {
    const value: Resources = { packs: new LookupPacksClient(), store: browserPackStore(),
      translator: new BrowserLookupTranslator(), history: browserLookupHistoryStore(), cache: new LookupSessionCache() };
    clients.current = value; setResources(value);
    const lifetime = new AbortController(); historyAbort.current = lifetime;
    return () => { lifetime.abort(); pending.current?.abort(); value.packs.close(); value.store.close();
      value.translator.close(); value.history.close(); value.cache.clear(); clients.current = null; };
  }, []);
  useEffect(() => {
    let alive = true, edited = false;
    const local = readLocalLookupSettings(); setSettings(local); setTarget(local.translateTo);
    const update = (event: Event) => {
      const parsed = lookupSettingsSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (parsed.success) { edited = true; setSettings(parsed.data); }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === LOOKUP_SETTINGS_KEY) { edited = true; setSettings(readLocalLookupSettings()); }
    };
    window.addEventListener(LOOKUP_SETTINGS_CHANGED, update); window.addEventListener("storage", storage);
    const cancel = afterLookupFirstPaint(() => {
      void getLookupSettings().then(value => {
        if (alive && !edited) { setSettings(value); setTarget(value.translateTo); writeLocalLookupSettings(value); }
      }).catch(() => {}); // Offline acquisition keeps the validated browser copy.
    });
    return () => { alive = false; cancel(); window.removeEventListener(LOOKUP_SETTINGS_CHANGED, update);
      window.removeEventListener("storage", storage); };
  }, []);
  const close = (reason?: "escape" | "outside" | "button") => {
    const previous = current.current;
    ++generation.current; pending.current?.abort(); pending.current = null;
    current.current = null; setOpened(null);
    if (reason === "escape" && previous?.keyboard) {
      if (previous.reference?.isConnected) previous.reference.focus({ preventScroll: true });
      else engine.focusBook?.();
    }
  };
  useReaderEvent("location", () => close());
  useEffect(() => {
    const clear = engine.on("selection", selected => { if (!selected) close(); });
    const relocate = engine.on("relocate", () => close());
    return () => { clear(); relocate(); };
    // Engine subscriptions keep the stable close path through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);
  useEffect(() => {
    if (!enabled) close();
    // Admission can be revoked while a model or dictionary is still running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  const open = (details: SelectionDetails, keyboard: boolean, reference?: HTMLElement, keyDocument?: Document, touch = false) => {
    const value = clients.current;
    if (!enabled || !value) return;
    const language = lookupLanguage({ passage: details.lang, ebook: ebook.language, edition: ebook.editionLanguage });
    const selection = lookupSelection(details.text, language.language);
    if (selection.kind === "empty") return;
    pending.current?.abort(); engine.closeNote?.(); chosenTab.current = false;
    const historyId = selection.kind === "word" && selection.text.length <= 4096
      ? recordLookupHistory(value.history, { word: selection.text, sentence: details.sentence,
        ebookId: ebook.id, ebookTitle: ebook.title.slice(0, 2000), language: language.language,
        at: new Date().toISOString() }, historyAbort.current?.signal).catch(() => null) : null;
    const lookup: OpenLookup = { id: ++generation.current, details, ...language, word: selection.text,
      passage: selection.kind === "passage", keyboard, reference, historyId, keyDocument, touch };
    const cache = value.cache.get(cacheKey(language.language, selection.text));
    performance.mark("reader:lookup-open");
    // The actual gesture synchronously mounts the surface/skeleton before providers start.
    flushSync(() => {
      current.current = lookup; setOpened(lookup); setTarget(currentSettings.current.translateTo);
      const hasDictionary = cache && (cache.dictionary.entries.length ||
        cache.dictionary.english?.status === "fulfilled" && cache.dictionary.english.value.found ||
        cache.dictionary.own?.status === "fulfilled" && cache.dictionary.own.value?.found);
      setActive(lookup.passage ? "translate" : cache && !hasDictionary && cache.wikipedia.value?.found ? "wikipedia" : "dictionary");
      setModel(cache ?? initialModel());
    });
  };
  useReaderFeatureShortcut("d", 15, event => {
    const source = event.currentTarget as Document;
    // The host toolbar/document deliberately uses the adapter's remembered source;
    // a key inside the book must resolve only that live document.
    const details = engine.selectionDetails(source === document ? undefined : source);
    if (details) open(details, true, undefined, source);
  }, enabled);
  useEffect(() => engine.on("word-gesture", ({ details, document, input }) => open(details, false, undefined, document, input === "touch")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, enabled]);
  useLayoutEffect(() => {
    if (opened) performance.mark("reader:lookup-skeleton");
  }, [opened]);
  useEffect(() => {
    if (!opened || !resources || opened.passage) return;
    const controller = new AbortController(); pending.current = controller;
    const id = opened.id, key = cacheKey(opened.language, opened.word);
    const existing = resources.cache.get(key);
    if (existing) { setModel(existing); return () => controller.abort(); }
    const result = initialModel();
    const publish = () => {
      if (controller.signal.aborted || current.current?.id !== id) return;
      const snapshot = { dictionary: { ...result.dictionary }, wikipedia: { ...result.wikipedia } };
      setModel(snapshot);
      const dictionaryDone = !snapshot.dictionary.packsPending && (snapshot.dictionary.offline ||
        !!snapshot.dictionary.english && !!snapshot.dictionary.own);
      const found = snapshot.dictionary.entries.length > 0 ||
        snapshot.dictionary.english?.status === "fulfilled" && snapshot.dictionary.english.value.found ||
        snapshot.dictionary.own?.status === "fulfilled" && snapshot.dictionary.own.value?.found;
      if (dictionaryDone && !found && snapshot.wikipedia.value?.found && !chosenTab.current) setActive("wikipedia");
    };
    const cancel = afterLookupFirstPaint(() => {
      const words = lookupCandidates(opened.word, opened.language);
      const pack = resources.store.list(controller.signal).then(async records => {
        if (controller.signal.aborted) return;
        result.dictionary.packs = records.filter(record => record.language === opened.language);
        if (result.dictionary.packs.length) {
          performance.mark("reader:lookup-pack");
          result.dictionary.entries = await resources.packs.lookup(result.dictionary.packs.map(pack => pack.id), words, controller.signal);
        }
      }).catch(error => {
        if (!controller.signal.aborted) result.dictionary.packError = error instanceof Error ? error.message : "Dictionaries could not be read";
      }).finally(() => { result.dictionary.packsPending = false; publish(); });
      const dictionary = result.dictionary.offline ? Promise.resolve() : lookupWiktionary(opened.language, words, controller.signal, undefined, {
        english: value => { result.dictionary.english = value; publish(); },
        own: value => { result.dictionary.own = value; publish(); },
      }).catch(error => {
        if (!controller.signal.aborted) {
          result.dictionary.english ??= { status: "rejected", reason: error };
          result.dictionary.own ??= { status: "rejected", reason: error }; publish();
        }
      });
      const wikipedia = result.wikipedia.offline ? Promise.resolve() : lookupWikipedia(opened.language, words[0], controller.signal).then(value => {
        result.wikipedia.value = value;
      }).catch(() => { result.wikipedia.offline = true; }).finally(() => { result.wikipedia.pending = false; publish(); });
      void Promise.allSettled([pack, dictionary, wikipedia]).then(() => {
        if (!controller.signal.aborted && current.current?.id === id) {
          publish();
          // Do not turn a temporary outage/worker failure into a session-long miss.
          if (!result.dictionary.packError && (result.dictionary.offline ||
            result.dictionary.english?.status === "fulfilled" && result.dictionary.own?.status === "fulfilled" &&
            !result.wikipedia.offline && !(result.wikipedia.value && !result.wikipedia.value.found && result.wikipedia.value.error)))
            resources.cache.put(key, { dictionary: { ...result.dictionary }, wikipedia: { ...result.wikipedia } });
        }
      });
    });
    return () => { cancel(); controller.abort(); };
  }, [opened, resources]);
  useEffect(() => {
    const invalidate = () => resources?.cache.clear();
    const storage = (event: StorageEvent) => { if (event.key === "durtal-lookup-packs-revision") invalidate(); };
    window.addEventListener("online", invalidate); window.addEventListener("offline", invalidate);
    window.addEventListener("durtal:lookup-packs", invalidate); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("online", invalidate); window.removeEventListener("offline", invalidate);
      window.removeEventListener("durtal:lookup-packs", invalidate); window.removeEventListener("storage", storage); };
  }, [resources]);
  useLayoutEffect(() => {
    if (opened && (model.dictionary.entries.length || model.dictionary.english?.status === "fulfilled" &&
      model.dictionary.english.value.found || model.dictionary.own?.status === "fulfilled" && model.dictionary.own.value?.found))
      performance.mark("reader:lookup-definition");
  }, [opened, model]);
  const override = (language: string) => {
    if (!opened || language === opened.language) return;
    const next = { ...opened, id: ++generation.current, language, guessed: false };
    pending.current?.abort(); current.current = next; setOpened(next); setModel(initialModel());
    const value = clients.current;
    if (value && opened.historyId) void opened.historyId.then(id => {
      if (id !== null) return value.history.updateLanguage(id, language, historyAbort.current?.signal);
    }).catch(() => {});
  };
  return <>
    <ReaderSlotFill slot="selection-actions" placement="last"><button type="button" aria-label="Look up"
      data-tooltip="Look up" data-tooltip-keys="d" disabled={!enabled || !resources}
      className="action-icon-sm" onClick={event => {
        const details = engine.selectionDetails();
        if (details) open(details, event.detail === 0, event.detail === 0 ? event.currentTarget : undefined);
      }}><BookA className="h-4 w-4" strokeWidth={1.5} /></button></ReaderSlotFill>
    {opened && resources && <LookupPopover key={opened.id} details={opened.details} language={opened.language}
      guessed={opened.guessed} word={opened.word} passage={opened.passage} keyboard={opened.keyboard}
      reference={opened.reference} avoid={toolbarRef.current?.getBoundingClientRect() ?? null} settings={settings}
      keyDocument={opened.keyDocument}
      touch={opened.touch}
      target={target} translator={resources.translator} dictionary={model.dictionary} wikipedia={model.wikipedia}
      active={active} onTab={tab => { chosenTab.current = true; setActive(tab); }} onLanguage={override}
      onTarget={setTarget} onClose={close} />}
  </>;
}
