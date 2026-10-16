"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-group";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { useEscapeToCancel } from "@/components/shared/escape-to-cancel";
import { languageName, languageOptions } from "@/lib/utils/language";
import { getLookupSettings, updateLookupSettings } from "@/lib/actions/reader-lookup";
import { lookupSettingsSchema, type LookupSettings, type LookupSource } from "@/lib/validations/reader-lookup";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import { afterLookupFirstPaint, readLocalLookupSettings, writeLocalLookupSettings } from "@/lib/reader/lookup/preferences";
type Draft = { v: LookupSettings["v"]; sources: (LookupSource & { key: string })[]; translateTo: string };
/** Keys are random, except for the settings the page came with, which the server renders too */
const draftOf = (value: LookupSettings, stable = false): Draft =>
  ({ ...value, sources: value.sources.map((source, index) => ({ ...source, key: stable ? "source-" + index : crypto.randomUUID() })) });
/** The site a source opens, for its row: "merriam-webster.com". */
const siteOf = (url: string) => {
  try { return new URL(url.replaceAll("{word}", "word")).hostname.replace(/^www\./, ""); } catch { return "No address yet"; }
};
/** A host name that may wrap only after a dot: "logeion. / uchicago.edu", never "uchicago.e / du" */
export const hostBreaks = (host: string) =>
  host.split(".").map((part, index) => index ? <Fragment key={index}>.<wbr />{part}</Fragment> : part);
const valueOf = (draft: Draft) => ({ v: draft.v, sources: draft.sources.map(({ key: _key, ...source }) => source), translateTo: draft.translateTo });
/** `initial` is the server's copy, read with the page. Without it (it could not be read) the
 * group starts from this browser's copy and asks the server after the first paint. */
export function LookupSettingsGroup({ initial = null }: { initial?: LookupSettings | null }) {
  const [draft, setDraft] = useState<Draft | null>(() => initial ? draftOf(initial, true) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const form = useRef<HTMLDivElement>(null), before = useRef<Draft | null>(null);
  const current = useRef<Draft | null>(draft), revision = useRef(0), alive = useRef(false);
  const queued = useRef<{ value: LookupSettings | null; revision: number } | null>(null), busy = useRef(false);
  const served = useRef(initial ? { draft: draft!, settings: initial } : null);
  useEffect(() => {
    alive.current = true;
    if (served.current) {
      writeLocalLookupSettings(served.current.settings);
      return () => { alive.current = false; queued.current = null; };
    }
    const local = draftOf(readLocalLookupSettings()); current.current = local; setDraft(local);
    const initial = revision.current;
    const cancel = afterLookupFirstPaint(() => {
      void getLookupSettings().then(value => {
        if (!alive.current || revision.current !== initial) return;
        const next = draftOf(value); current.current = next; setDraft(next); writeLocalLookupSettings(value);
      }).catch(() => { if (alive.current) setNotice("Showing the settings saved in this browser."); });
    });
    return () => { alive.current = false; cancel(); queued.current = null; };
  }, []);
  const edit = (next: Draft) => { ++revision.current; current.current = next; setDraft(next); };
  const drain = async () => {
    if (busy.current) return;
    busy.current = true; setSaving(true);
    try {
      while (queued.current && alive.current) {
        const item = queued.current; queued.current = null;
        try {
          const reply = await updateLookupSettings(item.value);
          if (!alive.current) return;
          if (item.revision !== revision.current) continue;
          if (reply.ok) { writeLocalLookupSettings(reply.settings); setNotice("Saved"); }
          else setNotice(reply.error);
        } catch { if (alive.current && item.revision === revision.current) setNotice("Lookup settings could not be saved. Try again."); }
      }
    } finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  const save = (value: Draft = current.current!): boolean => {
    if (!value) return false;
    const parsed = lookupSettingsSchema.safeParse(valueOf(value));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".")] ??= issue.message;
      setErrors(fields); setNotice("Check the highlighted fields.");
      const first = parsed.error.issues.find(issue => issue.path[0] === "sources" && typeof issue.path[1] === "number");
      if (first) setEditing(value.sources[first.path[1] as number]?.key ?? null);
      return false;
    }
    setErrors({}); queued.current = { value: parsed.data, revision: revision.current }; void drain(); return true;
  };
  const focusRow = (key: string) => requestAnimationFrame(() =>
    (document.getElementById("lookup-source-edit-" + key) ?? document.getElementById("lookup-source-add"))?.focus());
  const open = (key: string) => { before.current = current.current; setEditing(key); };
  /** Done closes the form once the sources are valid, and gives focus back to the row's Edit. */
  const done = (key: string) => {
    if (!save()) return;
    setEditing(null); before.current = null; focusRow(key);
  };
  /** Cancel (or Esc) puts the sources back as they were before Edit, so a new source goes away. */
  const cancel = () => {
    const key = editing;
    if (before.current) edit(before.current);
    before.current = null; setErrors({}); setEditing(null); setNotice(null);
    if (key) focusRow(key);
  };
  const question = useEscapeToCancel({ root: form, cancel, enabled: editing !== null, track: true, within: true,
    save: () => { if (editing) done(editing); } });
  const remove = (key: string) => {
    const next = { ...current.current!, sources: current.current!.sources.filter(value => value.key !== key) };
    edit(next); save(next);
  };
  const source = (index: number, patch: Partial<LookupSource>) => {
    if (!current.current) return;
    edit({ ...current.current, sources: current.current.sources.map((value, at) => at === index ? { ...value, ...patch } : value) });
  };
  return <div id="lookup-sources" className="scroll-mt-8" data-focus-list="lookup-sources"><SettingsGroup title="Lookup"
    description="Sources and the translation target are shared across your devices.">
    {!draft ? <p role="status" className="px-5 py-4 text-sm text-fg-secondary">Loading lookup settings</p> : <>
      <SettingRow id="lookup-translate-to" label="Translate into" description="Look up translates a selected passage into this language.">
        <Select id="lookup-translate-to" options={languageOptions(draft.translateTo)} value={draft.translateTo}
          onChange={event => { const next = { ...current.current!, translateTo: event.target.value }; edit(next); save(next); }}
          error={errors.translateTo} />
      </SettingRow>
      <div className="px-5 py-4 text-sm">
        <p className="text-fg-primary">Sources</p>
        <p className="mt-1 text-xs text-fg-secondary">Sites that open a word, for books in their language.</p>
      </div>
      {draft.sources.map((item, index) => editing === item.key ? <div key={item.key} ref={form} className="px-5 py-4" data-shortcut-scope data-focus-row="">
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <Select label="Language" options={[{ value: "*", label: "Any language" }, ...languageOptions(item.language === "*" ? null : item.language)]}
            value={item.language} error={errors["sources." + index + ".language"]} onChange={event => source(index, { language: event.target.value })} />
          <Input label="Name" maxLength={40} value={item.name} error={errors["sources." + index + ".name"]} autoFocus
            onChange={event => source(index, { name: event.target.value })} />
          <div className="sm:col-span-2"><Input label="URL template" maxLength={500} value={item.url}
            placeholder="https://example.org/{word}" error={errors["sources." + index + ".url"]}
            onChange={event => source(index, { url: event.target.value })} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="primary" onClick={() => done(item.key)}>Done</Button>
          <Button variant="ghost" data-dismiss onClick={cancel}>Cancel</Button>
        </div>
      </div> : <div key={item.key} className="flex items-start justify-between gap-3 px-5 py-3 text-sm" data-focus-row="">
        <div className="min-w-0">
          <p className="break-words text-fg-primary">{item.name || "Unnamed source"}</p>
          <p className="mt-1 break-words text-xs text-fg-secondary">{item.language === "*" ? "Any language" : languageName(item.language)} · {hostBreaks(siteOf(item.url))}</p>
        </div>
        <CapAlignedControls height={28} coarseHeight={44}>
          <button type="button" id={"lookup-source-edit-" + item.key} className="action-icon-sm" disabled={editing !== null}
            aria-label={"Edit source " + (item.name || "unnamed")} data-tooltip="Edit" onClick={() => open(item.key)}>
            <Pencil className="h-4 w-4" strokeWidth={1.5} /></button>
          <button type="button" className="action-icon-sm" disabled={editing !== null}
            aria-label={"Remove source " + (item.name || "unnamed")} data-tooltip="Remove" onClick={() => remove(item.key)}>
            <Trash2 className="h-4 w-4" strokeWidth={1.5} /></button>
        </CapAlignedControls>
      </div>)}
      {/* The last row: the source buttons, then the save status under them only while it says something
          (the live region stays for screen readers, and a row of its own would end the panel in an empty band) */}
      <div className="px-5 py-4">
      <div className="flex flex-wrap gap-3">
        <Button id="lookup-source-add" data-focus-empty="lookup-sources" disabled={draft.sources.length >= 50 || editing !== null} data-tooltip={draft.sources.length >= 50 ? "Use at most 50 sources" : undefined}
          onClick={() => {
            const key = crypto.randomUUID(); before.current = current.current;
            edit({ ...current.current!, sources: [...current.current!.sources, { key, language: "*", name: "", url: "" }] }); setEditing(key);
          }}>Add a source</Button>
        <Button variant="ghost" disabled={editing !== null} onClick={() => {
          const next = draftOf(defaultLookupSettings()); edit(next); setErrors({});
          queued.current = { value: null, revision: revision.current }; void drain();
        }}><RotateCcw aria-hidden strokeWidth={1.5} />Restore the default sources</Button>
      </div>
      <div className={saving || notice ? "mt-3 flex flex-wrap items-start gap-3" : "sr-only"}>
        <p role="status" className="text-xs text-fg-secondary">{saving ? "Saving" : notice}</p>
        {notice && notice !== "Saved" && <Button variant="ghost" size="sm" onClick={() => save()}><RefreshCw aria-hidden strokeWidth={1.5} />Try saving again</Button>}
      </div>
      </div>
    </>}
  </SettingsGroup>{question}</div>;
}
