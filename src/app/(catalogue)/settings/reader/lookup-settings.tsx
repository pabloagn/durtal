"use client";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-group";
import { languageOptions } from "@/lib/utils/language";
import { getLookupSettings, updateLookupSettings } from "@/lib/actions/reader-lookup";
import { lookupSettingsSchema, type LookupSettings, type LookupSource } from "@/lib/validations/reader-lookup";
import { defaultLookupSettings } from "@/lib/reader/lookup/sources";
import { afterLookupFirstPaint, readLocalLookupSettings, writeLocalLookupSettings } from "@/lib/reader/lookup/preferences";
type Draft = { v: 1; sources: (LookupSource & { key: string })[]; translateTo: string };
const draftOf = (value: LookupSettings): Draft => ({ ...value, sources: value.sources.map(source => ({ ...source, key: crypto.randomUUID() })) });
const valueOf = (draft: Draft) => ({ v: draft.v, sources: draft.sources.map(({ key: _key, ...source }) => source), translateTo: draft.translateTo });
export function LookupSettingsGroup() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = useRef<Draft | null>(null), revision = useRef(0), alive = useRef(false);
  const queued = useRef<{ value: LookupSettings | null; revision: number } | null>(null), busy = useRef(false);
  useEffect(() => {
    alive.current = true;
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
  const save = (value: Draft = current.current!) => {
    if (!value) return;
    const parsed = lookupSettingsSchema.safeParse(valueOf(value));
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join(".")] ??= issue.message;
      setErrors(fields); setNotice("Check the highlighted fields."); return;
    }
    setErrors({}); queued.current = { value: parsed.data, revision: revision.current }; void drain();
  };
  const source = (index: number, patch: Partial<LookupSource>, persist = false) => {
    if (!current.current) return;
    const next = { ...current.current, sources: current.current.sources.map((value, at) => at === index ? { ...value, ...patch } : value) };
    edit(next); if (persist) save(next);
  };
  return <div id="lookup-sources" className="scroll-mt-8"><SettingsGroup title="Lookup"
    description="Sources and the translation target are shared across your devices.">
    {!draft ? <p role="status" className="px-5 py-4 text-sm text-fg-secondary">Loading lookup settings</p> : <>
      {draft.sources.map((item, index) => <div key={item.key} className="px-5 py-4">
        <div className="grid grid-cols-[1fr_auto] items-start gap-3">
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <Select label="Language" options={[{ value: "*", label: "Any language" }, ...languageOptions(item.language === "*" ? null : item.language)]}
              value={item.language} error={errors["sources." + index + ".language"]} onChange={event => source(index, { language: event.target.value }, true)} />
            <Input label="Name" maxLength={40} value={item.name} error={errors["sources." + index + ".name"]}
              onChange={event => source(index, { name: event.target.value })} onBlur={() => save()} />
            <div className="sm:col-span-2"><Input label="URL template" maxLength={500} value={item.url}
              placeholder="https://example.org/{word}" error={errors["sources." + index + ".url"]}
              onChange={event => source(index, { url: event.target.value })} onBlur={() => save()} /></div>
          </div>
          <button type="button" className="action-icon-sm mt-6" aria-label={"Remove source " + (item.name || "unnamed")}
            data-tooltip="Remove" onClick={() => {
              const next = { ...current.current!, sources: current.current!.sources.filter(value => value.key !== item.key) };
              edit(next); save(next);
            }}><Trash2 className="h-4 w-4" strokeWidth={1.5} /></button>
        </div>
      </div>)}
      <div className="flex flex-wrap gap-3 px-5 py-4">
        <Button disabled={draft.sources.length >= 50} data-tooltip={draft.sources.length >= 50 ? "Use at most 50 sources" : undefined}
          onClick={() => edit({ ...current.current!, sources: [...current.current!.sources,
            { key: crypto.randomUUID(), language: "*", name: "", url: "" }] })}>Add source</Button>
        <Button variant="ghost" onClick={() => {
          const next = draftOf(defaultLookupSettings()); edit(next); setErrors({});
          queued.current = { value: null, revision: revision.current }; void drain();
        }}>Restore the default sources</Button>
      </div>
      <SettingRow id="lookup-translate-to" label="Translate into">
        <Select id="lookup-translate-to" options={languageOptions(draft.translateTo)} value={draft.translateTo}
          onChange={event => { const next = { ...current.current!, translateTo: event.target.value }; edit(next); save(next); }}
          error={errors.translateTo} />
      </SettingRow>
      <div className="flex flex-wrap items-start gap-3 px-5 py-3">
        <p role="status" className="text-xs text-fg-secondary">{saving ? "Saving" : notice}</p>
        {notice && notice !== "Saved" && <Button variant="ghost" size="sm" onClick={() => save()}>Try saving again</Button>}
      </div>
    </>}
  </SettingsGroup></div>;
}
