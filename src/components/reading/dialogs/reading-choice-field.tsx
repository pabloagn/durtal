"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { DialogFocusScope } from "@/components/ui/dialog-focus-scope";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getReadingChoice, getReadingChoicePage } from "@/lib/actions/reading";
import { ordinalRead } from "@/lib/reading/labels";
import type { ReadingChoice, ReadingChoicePage } from "@/lib/reading/overview-types";

const STATUS: Record<string, string> = { reading: "reading now", paused: "paused", finished: "finished", abandoned: "abandoned" };
export const readingChoiceLabel = (row: ReadingChoice) => [ordinalRead(row.ordinal), row.editionLabel, STATUS[row.status]].filter(Boolean).join(" · ");

/** Only the first choice page and the selected off-page reading stay in the parent form. */
export function ReadingChoiceField({ workId, total, value, selected, initialChoices, editionNames, onHydrate, onChange }: {
  workId: string; total: number; value: string; selected: ReadingChoice | null; initialChoices: ReadingChoice[]; editionNames: Record<string, string>;
  onHydrate: (choice: ReadingChoice) => void; onChange: (choice: ReadingChoice | null) => void;
}) {
  const [first, setFirst] = useState<ReadingChoicePage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [choosing, setChoosing] = useState(false);
  const hydrate = useRef(onHydrate);
  hydrate.current = onHydrate;
  useEffect(() => {
    let live = true;
    getReadingChoicePage(workId).then(page => { if (live) { setFirst(page); setError(null); } }, () => { if (live) setError("Readings could not load."); });
    return () => { live = false; };
  }, [workId, retry]);
  const visible = first?.items ?? initialChoices;
  const label = (row: ReadingChoice) => readingChoiceLabel({ ...row, editionLabel: row.editionId ? editionNames[row.editionId] ?? row.editionLabel : null });
  const listed = visible.find(row => row.id === value);
  useEffect(() => {
    if (!value || selected?.id === value) return;
    if (listed) { hydrate.current(listed); return; }
    let live = true;
    getReadingChoice(workId, value).then(row => {
      if (!live) return;
      if (row) hydrate.current(row);
      else setError("The selected reading no longer exists. Choose another reading or None.");
    }, () => { if (live) setError("The selected reading could not load."); });
    return () => { live = false; };
  }, [workId, value, selected?.id, listed, retry]);
  const options = [...visible];
  if (value && !listed && selected?.id === value) options.push(selected);
  return <div className="space-y-1.5">
    <Select label="Reading" value={value} className="pointer-coarse:h-11" onChange={event => {
      const id = event.target.value;
      if (!id) return onChange(null);
      const choice = options.find(row => row.id === id);
      // A loading/unavailable selection is still the note's reading. Only
      // the explicit None option may detach it while metadata is absent.
      if (choice) onChange(choice);
    }} options={[
      { value: "", label: "None" },
      ...options.map(row => ({ value: row.id, label: label(row) })),
      ...(value && !options.some(row => row.id === value) ? [{ value, label: "Selected reading (loading…)", disabled: true }] : []),
    ]} />
    {!first && !error && <p role="status" className="text-xs text-fg-secondary">Loading readings…</p>}
    {error && <p role="alert" className="text-xs text-fg-secondary">{error} <button type="button" className="underline touch-hit" onClick={() => { setError(null); setRetry(n => n + 1); }}>Retry</button></p>}
    {total > 20 && <Button type="button" size="sm" variant="ghost" onClick={event => {
      // Safari pointer activation need not focus a button. Give the child
      // dialog the actual opener before it captures its focus origin.
      event.currentTarget.focus();
      setChoosing(true);
    }} className="pointer-coarse:h-11">Choose an older reading</Button>}
    {choosing && <DialogFocusScope.Provider value={null}>
      <OlderReadingChooser workId={workId} value={value} label={label} onClose={() => setChoosing(false)} onChoose={row => { onChange(row); setChoosing(false); }} />
    </DialogFocusScope.Provider>}
  </div>;
}

function OlderReadingChooser({ workId, value, label, onClose, onChoose }: { workId: string; value: string; label: (row: ReadingChoice) => string; onClose: () => void; onChoose: (row: ReadingChoice) => void }) {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<ReadingChoicePage | null>(null);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let live = true;
    getReadingChoicePage(workId, page, search).then(next => { if (live) { setResult(next); setPending(false); } }, () => { if (live) { setError(true); setPending(false); } });
    return () => { live = false; };
  }, [workId, page, search, retry]);
  const load = (next: number) => { setPending(true); setError(false); setPage(next); };
  const find = () => { setPending(true); setError(false); setPage(1); setSearch(draft.trim()); setRetry(n => n + 1); };
  return <Dialog open onClose={onClose} title="Choose a reading" className="max-w-lg">
    <div className="space-y-4">
      <div className="flex items-end gap-2"><Input label="Search readings" value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); find(); } }} placeholder="Read number, date, edition or status" className="pointer-coarse:h-11" /><Button type="button" onClick={find} className="pointer-coarse:h-11">Search</Button></div>
      {pending ? <p role="status" className="text-sm text-fg-secondary">Loading readings…</p> : error ? <p role="alert" className="text-sm text-fg-secondary">Readings could not load. <button type="button" className="underline touch-hit" onClick={() => { setPending(true); setError(false); setRetry(n => n + 1); }}>Retry</button></p> : <>
        <p className="text-xs text-fg-secondary">{result?.total ?? 0} readings</p>
        <ul className="divide-y divide-glass-border rounded-sm border border-glass-border">{result?.items.map(row => <li key={row.id}><button type="button" aria-pressed={row.id === value} onClick={() => onChoose(row)} className="w-full px-3 py-2 text-left text-sm text-fg-primary hover:bg-bg-tertiary touch-hit">{label(row)}</button></li>)}</ul>
        {result?.items.length === 0 && <p className="text-sm text-fg-secondary">No readings match this search.</p>}
        <div className="flex items-center justify-between gap-2"><Button type="button" size="sm" variant="ghost" disabled={page === 1} onClick={() => load(page - 1)}>Previous</Button><span className="text-xs text-fg-secondary">Page {page}</span><Button type="button" size="sm" variant="ghost" disabled={!result?.hasNext} onClick={() => load(page + 1)}>Next</Button></div>
      </>}
      <div className="flex justify-end"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
    </div>
  </Dialog>;
}
