"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SettingsGroup } from "@/components/settings/settings-group";
import { LookupPacksClient } from "@/lib/reader/lookup/packs";
import type { PackRecord } from "@/lib/reader/lookup/pack-store";
import { languageName, languageOptions } from "@/lib/utils/language";
/** Free StarDict packs built from Wiktionary, one per language (SLN-687). */
const FREE_PACKS = "https://github.com/Vuizur/Wiktionary-Dictionaries";
type Inspected = Awaited<ReturnType<LookupPacksClient["inspect"]>>;
const size = (bytes: number) => bytes >= 1024 ** 2 ? (bytes / 1024 ** 2).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
function dictionariesChanged() {
  try { localStorage.setItem("durtal-lookup-packs-revision", crypto.randomUUID()); } catch {}
  window.dispatchEvent(new Event("durtal:lookup-packs"));
}
export function DictionariesGroup() {
  const [secure, setSecure] = useState<boolean | null>(null), [records, setRecords] = useState<PackRecord[]>([]);
  const [files, setFiles] = useState<File[]>([]), [metadata, setMetadata] = useState<Inspected | null>(null);
  const [language, setLanguage] = useState("en"), [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null), [persisted, setPersisted] = useState<boolean | null>(null);
  // The first read of this device's dictionaries says so only to screen readers: a status row
  // that came and went would move the groups below it (SLN-875)
  const [listing, setListing] = useState(false);
  const client = useRef<LookupPacksClient | null>(null), operation = useRef<AbortController | null>(null);
  const generation = useRef(0), picker = useRef<HTMLInputElement>(null);
  const perform = async (label: string, work: (value: LookupPacksClient, signal: AbortSignal) => Promise<void>) => {
    operation.current?.abort();
    const controller = new AbortController(), id = ++generation.current;
    operation.current = controller; setBusy(label); setError(null);
    try { if (client.current) await work(client.current, controller.signal); }
    catch (failure) {
      if (id === generation.current) setError(controller.signal.aborted ? "Dictionary operation canceled." :
        failure instanceof Error ? failure.message : "This dictionary could not be read.");
    } finally { if (id === generation.current) { setBusy(null); operation.current = null; } }
  };
  useEffect(() => {
    const supported = isSecureContext && !!navigator.storage?.getDirectory && typeof Worker !== "undefined";
    setSecure(supported);
    if (!supported) return;
    const value = new LookupPacksClient(); client.current = value;
    const controller = new AbortController(); operation.current = controller;
    let alive = true; setListing(true);
    void Promise.all([value.list(controller.signal), navigator.storage.persisted().catch(() => false)]).then(([rows, retained]) => {
      if (alive) { setRecords(rows); setPersisted(retained); }
    }).catch(failure => { if (alive) setError(failure instanceof Error ? failure.message : "Dictionaries could not be read."); })
      .finally(() => { if (alive) { setListing(false); operation.current = null; } });
    return () => { alive = false; ++generation.current; operation.current?.abort(); controller.abort(); value.close(); client.current = null; };
  }, []);
  return <div id="dictionaries" className="scroll-mt-8"><SettingsGroup title="Dictionaries on this device"
    description="Dictionary files stay on this device and work without a connection.">
    {secure === false ? <p className="px-5 py-4 text-sm text-fg-secondary">Offline dictionaries need Durtal’s secure (https) address and a browser with private file storage.</p> : <>
      <div className="px-5 py-4">
        <p className="mb-3 text-sm text-fg-secondary">Look up reads StarDict dictionaries: a&nbsp;.zip, or its&nbsp;.ifo,&nbsp;.idx and&nbsp;.dict files together. Free ones for many languages, made from Wiktionary: <a className="text-accent-primary underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center" href={FREE_PACKS} target="_blank" rel="noopener noreferrer">Wiktionary dictionaries ↗</a></p>
        <input ref={picker} type="file" multiple accept=".zip,.ifo,.idx,.gz,.dict,.dz,.syn" className="sr-only" tabIndex={-1}
          aria-label="Dictionary pack files" onChange={event => {
            const selected = Array.from(event.target.files ?? []); event.target.value = "";
            setMetadata(null); setFiles([]);
            if (selected.length) void perform("Checking dictionary", async (value, signal) => {
              const result = await value.inspect(selected, signal);
              signal.throwIfAborted(); setMetadata(result); setFiles(selected); setLanguage(result.language ?? "en");
            });
          }} />
        {listing && <p role="status" className="sr-only">Loading dictionaries</p>}
        <Button disabled={!secure || !!busy || listing || records.length >= 32} onClick={() => picker.current?.click()}
          data-tooltip={records.length >= 32 ? "Use at most 32 dictionaries" : undefined}>Add dictionary</Button>
        {metadata && <div className="mt-4 space-y-3">
          <p className="text-sm">{metadata.name} <span className="font-mono text-xs text-fg-secondary">{metadata.wordCount.toLocaleString()} words</span></p>
          <Select label="Dictionary language" options={languageOptions(language)} value={language}
            disabled={!!busy} onChange={event => setLanguage(event.target.value)} />
          <Button disabled={!!busy} onClick={() => { void perform("Adding dictionary", async (value, signal) => {
            const installed = await value.install(files, language, signal);
            signal.throwIfAborted(); setRecords(rows => [...rows, installed.record]); setPersisted(installed.persisted); setFiles([]); setMetadata(null); dictionariesChanged();
          }); }}>Add to this device</Button>
        </div>}
        {/* Under 640 Cancel goes under the status, pulled out by its padding so its icon starts on the text's edge.
            Beside it from 640 up, it sits on the status's cap height, as CapAligned (height 28, 44 on touch) does,
            here only from 640 (SLN-808) */}
        {busy && <div className="mt-3 flex flex-col items-start gap-3 text-sm sm:flex-row"><p role="status" className="text-sm text-fg-secondary">{busy}</p>
          <span className="shrink-0 sm:block sm:h-[1lh]"><span className="sm:cap-box sm:cap-touch" style={{ "--cap-box": "28px" } as CSSProperties}>
            <Button variant="ghost" size="sm" className="-ml-2.5 sm:ml-0" onClick={() => operation.current?.abort()}><X aria-hidden strokeWidth={1.5} />Cancel</Button>
          </span></span></div>}
        {error && <p role="alert" className="mt-3 text-sm text-accent-red-text">{error}</p>}
      </div>
      {records.map(record => <div key={record.id} className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0"><p className="break-words text-sm">{record.name}</p>
          <p className="mt-1 text-xs text-fg-secondary">{languageName(record.language)} · <span className="font-mono">{record.wordCount.toLocaleString()} words · {size(record.sizeBytes)}</span></p>
          <p className="mt-2 text-xs text-fg-secondary">{persisted ? "Kept until you remove it" : "The browser may clear this when space runs low"}</p>
        </div>
        <button type="button" className="action-icon-sm" disabled={!!busy} aria-label={"Remove dictionary " + record.name}
          data-tooltip="Remove" onClick={() => { void perform("Removing dictionary", async (value, signal) => {
            await value.remove(record.id, signal); signal.throwIfAborted(); setRecords(rows => rows.filter(row => row.id !== record.id)); dictionariesChanged();
          }); }}><Trash2 className="h-4 w-4" strokeWidth={1.5} /></button>
      </div>)}
    </>}
  </SettingsGroup></div>;
}
