"use client";
import { useEffect, useState } from "react";
import { PanelsTopLeft } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CapAligned } from "@/components/shared/cap-aligned";
import { useReaderFeatureShortcut } from "./bridge";
import type { ReaderEngine } from "@/lib/reader/engine";
export function FixedLayoutControls({ engine, fit, onFit, onPick, onHeldChange, enabled }: { engine: ReaderEngine; fit: "page" | "width"; onFit(fit: "page" | "width"): void; onPick(href: string): Promise<boolean>; onHeldChange(held: boolean): void; enabled: boolean }) {
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), [zoom, setZoom] = useState(engine.fixedZoom?.() ?? null);
  const pages = engine.fixedPages?.() ?? [];
  useEffect(() => { onHeldChange(open); return () => onHeldChange(false); }, [open, onHeldChange]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => engine.on("fixed-controls", state => setZoom(state.zoom)), [engine]);
  useReaderFeatureShortcut("w", 13, () => { engine.setFixedZoom?.(null); onFit(fit === "page" ? "width" : "page"); }, enabled);
  useReaderFeatureShortcut("p", 13, () => setOpen(value => !value), enabled);
  return <><CapAligned height={32} coarseHeight={44}><button type="button" className="block rounded-sm p-2 text-fg-secondary hover:bg-bg-tertiary/50 pointer-coarse:p-3.5" aria-label="Page controls" data-tooltip="Page controls" data-tooltip-keys="p" onClick={() => setOpen(true)}><PanelsTopLeft className="h-4 w-4" strokeWidth={1.5} /></button></CapAligned>
    <Dialog open={open} onClose={() => setOpen(false)} title="Page controls" expandable={false} className="max-w-lg"><div data-reader-widget className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={() => engine.adjustFixedZoom?.(-1)} aria-label="Zoom out">−</Button><span role="status" className="self-center text-sm">{zoom === null ? fit === "page" ? "Fit page" : "Fit width" : `${zoom}%`}</span><Button variant="ghost" onClick={() => engine.adjustFixedZoom?.(1)} aria-label="Zoom in">+</Button><Button variant="ghost" onClick={() => engine.setFixedZoom?.(null)}>Reset zoom</Button></div>
      <div className="flex gap-2"><Button variant="ghost" onClick={() => { engine.setFixedZoom?.(null); onFit("page"); }} aria-pressed={fit === "page"}>Fit page</Button><Button variant="ghost" onClick={() => { engine.setFixedZoom?.(null); onFit("width"); }} aria-pressed={fit === "width"}>Fit width</Button></div>
      <p className="text-xs text-fg-secondary">Zoom lasts for this reading session. Page fit is saved in reading settings.</p>
      <nav aria-label="Book pages" className="grid grid-cols-4 gap-2">{pages.slice(page*40,(page+1)*40).map((item, index) => <button type="button" key={`${item.href}:${index}`} className="min-h-11 rounded-sm border border-border-primary px-2 text-sm hover:bg-bg-tertiary" onClick={() => { void onPick(item.href).then(ok => { if (ok) setOpen(false); else setError("That page could not be opened."); }).catch(() => setError("That page could not be opened.")); }}>{item.label}</button>)}</nav>
      {pages.length > 40 && <div className="flex gap-2"><Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value-1)}>Previous pages</Button><Button variant="ghost" disabled={(page+1)*40 >= pages.length} onClick={() => setPage(value => value+1)}>More pages</Button></div>}
      {error && <p role="alert" className="text-sm text-accent-red-text">{error}</p>}
    </div></Dialog></>;
}
