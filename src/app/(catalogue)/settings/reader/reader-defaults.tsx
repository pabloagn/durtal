"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingsGroup, SettingsIntro } from "@/components/settings/settings-group";
import { PresentationSettingsDialog } from "@/components/reader/presentation-settings-dialog";
import { useReaderPreferences } from "@/hooks/use-reader-preferences";
import { effectivePresentation, type PresentationRow } from "@/lib/reader/presentation/defaults";
import { fontFaceCSS, readingFontStack } from "@/lib/reader/presentation/fonts";
import { themeColours } from "@/lib/reader/presentation/themes";
import type { DeviceClass } from "@/lib/validations/reader-preferences";
import type { ReaderPreferencesRead, getReaderBookOverrides } from "@/lib/ebooks/preferences";
import { listReaderBookOverrides, resetReaderPreferences } from "@/lib/actions/reader-preferences";
type Overrides = Awaited<ReturnType<typeof getReaderBookOverrides>>;
export function ReaderDefaults({ initial, initialOverrides }: { initial: ReaderPreferencesRead; initialOverrides: Overrides }) {
  if (!initial.ok) return <p role="alert" className="text-sm text-accent-red-text">{initial.error}</p>;
  return <SavedDefaults rows={initial.rows} initialOverrides={initialOverrides} />;
}
function SavedDefaults({ rows, initialOverrides }: { rows: readonly PresentationRow[]; initialOverrides: Overrides }) {
  const [deviceClass, setDeviceClass] = useState<DeviceClass>("desktop");
  return <><SettingsIntro>Choose defaults for each device size. Books can keep their own overrides.</SettingsIntro>
    <SegmentedControl ariaLabel="Reader device size" value={deviceClass} onChange={setDeviceClass} options={[{ value: "desktop", label: "Desktop" }, { value: "tablet", label: "Tablet" }, { value: "phone", label: "Phone" }]} />
    <DeviceDefaults key={deviceClass} deviceClass={deviceClass} rows={rows} initialOverrides={deviceClass === "desktop" ? initialOverrides : null} />
  </>;
}
function DeviceDefaults({ deviceClass, rows, initialOverrides }: { deviceClass: DeviceClass; rows: readonly PresentationRow[]; initialOverrides: Overrides | null }) {
  const preferences = useReaderPreferences({ deviceClass, ebookId: null, initialRows: rows });
  const p = useMemo(() => effectivePresentation(deviceClass, preferences.rows), [deviceClass, preferences.rows]);
  const colors = themeColours(p);
  useEffect(() => {
    const style = document.createElement("style"); style.textContent = fontFaceCSS(window.location.origin); document.head.append(style);
    return () => style.remove();
  }, []);
  const [open, setOpen] = useState(false), [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false);
  const [overrides, setOverrides] = useState<Overrides | null>(initialOverrides);
  const [clearing, setClearing] = useState<string | null>(null);
  const scope = useRef(0);
  useEffect(() => {
    const generation = ++scope.current; let active = true;
    const timer = setTimeout(() => { if (active && scope.current === generation) { active = false; setLoading(false); setError("Book overrides took too long to load. Try again."); } }, 10000);
    setLoading(true);
    void listReaderBookOverrides({ deviceClass, page }).then(result => { if (active && scope.current === generation) { setOverrides(result); setLoading(false); } }).catch(() => { if (active && scope.current === generation) { setError("Book overrides could not be loaded."); setLoading(false); } }).finally(() => clearTimeout(timer));
    return () => { active = false; clearTimeout(timer); scope.current++; };
  }, [deviceClass,page,refresh]);
  const clear = async (ebookId: string) => {
    const generation = scope.current; setClearing(ebookId); setError(null);
    try {
      const reply = await resetReaderPreferences({ deviceClass, ebookId });
      if (scope.current !== generation) return;
      if (!reply.ok) setError(reply.error); else setRefresh(value => value+1);
    } catch { if (scope.current === generation) setError("This book's override could not be cleared."); }
    finally { if (scope.current === generation) setClearing(null); }
  };
  return <>
    <SettingsGroup title="Reading defaults" action={<Button variant="ghost" size="sm" disabled={!preferences.ready} onClick={() => setOpen(true)}>Edit settings</Button>}>
      <p className="text-sm text-fg-secondary">These settings apply to books without their own {deviceClass} override.</p>
      {(preferences.error || preferences.recoveryError) && <p role="alert" className="text-sm text-accent-red-text">{preferences.error ?? preferences.recoveryError}</p>}
      <div aria-label="Reading preview" style={{ backgroundColor: colors.background, color: colors.text, padding: p.marginPx }}>
        <p style={{ fontFamily: readingFontStack(p.font) ?? undefined, fontSize: p.fontSizePx, fontWeight: p.fontWeight, lineHeight: p.lineHeight, textAlign: p.textAlign === "book" ? "start" : p.textAlign, letterSpacing: `${p.letterSpacingEm}em`, wordSpacing: `${p.wordSpacingEm}em` }}>The study was quiet. Rain moved over the windows, and the lamp threw a narrow circle of light across the desk, where a closed book waited beside a cup of cold tea.</p>
      </div>
    </SettingsGroup>
    <SettingsGroup title="Books with overrides">
      {loading && <p role="status" className="text-sm text-fg-secondary">Loading book overrides</p>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
      {overrides && !overrides.ok && <p role="alert" className="text-sm text-accent-red-text">{overrides.error}</p>}
      {overrides?.ok && <><p className="text-xs text-fg-secondary">{overrides.total} books with {deviceClass} overrides</p>
        <ul className="flex flex-col gap-3">{overrides.rows.map(item => <li key={item.ebookId} className="flex flex-wrap items-start justify-between gap-2"><Link href={`/reader/${item.ebookId}`} className="min-w-0 flex-1 break-words text-sm text-accent-primary hover:underline">{item.title || "Untitled book"}</Link><Button variant="ghost" size="sm" disabled={loading || clearing !== null} onClick={() => { void clear(item.ebookId); }}>Clear override</Button></li>)}</ul>
        {overrides.total > overrides.pageSize && <div className="flex gap-2"><Button variant="ghost" disabled={loading || clearing !== null || page === 1} onClick={() => setPage(value => value-1)}>Previous</Button><span className="self-center text-sm">Page {page}</span><Button variant="ghost" disabled={loading || clearing !== null || page*overrides.pageSize >= overrides.total} onClick={() => setPage(value => value+1)}>Next</Button></div>}
      </>}
      <Button variant="ghost" size="sm" disabled={loading || clearing !== null} onClick={() => { setError(null); setRefresh(value => value+1); }}>Refresh overrides</Button>
    </SettingsGroup>
    <PresentationSettingsDialog defaultsOnly open={open} onClose={() => setOpen(false)} presentation={p} deviceClass={deviceClass} error={preferences.error ?? error} saving={preferences.saving} pending={preferences.pending} recoveryError={preferences.recoveryError}
      onChange={patch => { try { preferences.update({ deviceClass, ebookId: null, presentation: patch }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be changed."); } }}
      onReset={() => { try { preferences.reset({ deviceClass, ebookId: null }); } catch (cause) { setError(cause instanceof Error ? cause.message : "Settings could not be reset."); } }} onRetry={() => { void preferences.flush(); }} />
  </>;
}
