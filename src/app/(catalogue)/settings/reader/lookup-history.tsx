"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsGroup } from "@/components/settings/settings-group";
import { ConfirmDeleteDialog } from "@/components/catalogue/confirm-delete-dialog";
import { browserLookupHistoryStore, type LookupHistoryStore, type LookupHistoryEntry } from "@/lib/reader/lookup/history";
import { languageName } from "@/lib/utils/language";
export function LookupHistoryGroup() {
  const [entries, setEntries] = useState<LookupHistoryEntry[]>([]), [count, setCount] = useState(0);
  const [limit, setLimit] = useState(20), [refresh, setRefresh] = useState(0), [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const store = useRef<LookupHistoryStore | null>(null), scope = useRef<AbortController | null>(null);
  useEffect(() => {
    const value = browserLookupHistoryStore(); store.current = value;
    return () => { value.close(); store.current = null; };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    setBusy(true); setError(null);
    const value = store.current;
    if (value) void Promise.all([value.count(controller.signal), value.list(limit, 0, controller.signal)]).then(([total, rows]) => {
      if (!controller.signal.aborted) { setCount(total); setEntries(rows); }
    }).catch(() => { if (!controller.signal.aborted) setError("Lookup history could not be read in this browser."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [limit, refresh]);
  return <div id="lookup-history" className="scroll-mt-8"><SettingsGroup title="Lookup history"
    description="Kept only in this browser. Durtal’s server never sees it.">
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <p className="text-sm text-fg-secondary">{count.toLocaleString("en")} {count === 1 ? "lookup" : "lookups"}</p>
      <Button variant="ghost" size="sm" disabled={busy || count === 0} onClick={() => setConfirm(true)}><Trash2 aria-hidden strokeWidth={1.5} />Clear history</Button>
    </div>
    {entries.map(entry => <div key={entry.id} className="px-5 py-4">
      <p className="break-words text-sm">{entry.word} <span className="text-xs text-fg-secondary">· {languageName(entry.language)}</span></p>
      <p className="mt-1 text-xs text-fg-secondary"><Link className="text-command" href={"/ebooks/" + entry.ebookId}>{entry.ebookTitle || "Untitled book"}</Link> · <time className="font-mono" dateTime={entry.at}>{new Date(entry.at).toLocaleDateString()}</time></p>
      <p className="lines-2 mt-2 text-sm text-fg-secondary">{entry.sentence}</p>
    </div>)}
    {/* Loading, an error or Show more: a row only when there is one */}
    {(busy || error || entries.length < count) && <div className="px-5 py-4">
      {busy && <p role="status" className="text-sm text-fg-secondary">Loading lookup history</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      {/* Ghost buttons starting a line under text pull out by their padding, so their icons start on its edge */}
      {(entries.length < count || error) && <div className="-ml-3 flex flex-wrap gap-3">
        {entries.length < count && <Button variant="ghost" disabled={busy} onClick={() => setLimit(value => Math.min(5000, value + 50))}><ChevronDown aria-hidden strokeWidth={1.5} />Show 50 more</Button>}
        {error && <Button variant="ghost" onClick={() => setRefresh(value => value + 1)}><RefreshCw aria-hidden strokeWidth={1.5} />Try again</Button>}
      </div>}
    </div>}
    <ConfirmDeleteDialog open={confirm} onClose={() => setConfirm(false)} title="Clear lookup history"
      name="Lookup history on this device" description="Clear the lookup history on this device? This cannot be undone."
      onConfirm={async () => {
        if (!store.current) return;
        try { await store.current.clear(scope.current?.signal); setConfirm(false); setEntries([]); setCount(0); setLimit(20); setRefresh(value => value + 1); }
        catch { setConfirm(false); setError("Lookup history could not be cleared. Try again."); }
      }} />
  </SettingsGroup></div>;
}
