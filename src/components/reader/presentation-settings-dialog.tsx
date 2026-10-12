"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { readerFontCapabilityNote } from "@/lib/reader/presentation/fonts";
import { FontPicker } from "./font-picker";
import type { DeviceClass, ReaderPresentation, PresentationOverride } from "@/lib/validations/reader-preferences";

export function PresentationSettingsDialog(props: {
  defaultsOnly?: boolean;
  open: boolean; onClose(): void; presentation: ReaderPresentation; deviceClass: DeviceClass;
  error: string | null; saving: boolean; pending: number; recoveryError: string | null;
  onChange(patch: PresentationOverride, scope: "book" | "defaults"): void;
  onReset(scope: "book" | "defaults"): void; onRetry(): void;
}) {
  const [scope, setScope] = useState<"book" | "defaults">(props.defaultsOnly ? "defaults" : "book");
  const p = props.presentation;
  const change = (patch: PresentationOverride) => props.onChange(patch, scope);
  const select = <K extends keyof ReaderPresentation>(key: K, label: string, choices: readonly { value: ReaderPresentation[K]; label: string }[]) => (
    <label className="flex flex-col gap-2 text-sm" key={key}>{label}
      <select className="h-10 rounded-sm border border-border-primary bg-bg-secondary px-3 pointer-coarse:h-11" value={String(p[key])}
        onChange={event => { const choice = choices.find(item => String(item.value) === event.currentTarget.value); if (choice) change({ [key]: choice.value }); }}>
        {choices.map(item => <option key={String(item.value)} value={String(item.value)}>{item.label}</option>)}
      </select>
    </label>
  );
  const number = (key: "fontSizePx" | "fontWeight" | "lineHeight" | "marginPx" | "publisherScale" | "brightness" | "warmth" | "paragraphSpacingEm" | "paragraphIndentEm" | "letterSpacingEm" | "wordSpacingEm", label: string, min: number, max: number, step: number) => (
    <label key={key} className="flex flex-col gap-2 text-sm">{label}
      <input type="number" min={min} max={max} step={step} value={p[key] ?? ""} placeholder="Book's value"
        className="h-10 rounded-sm border border-border-primary bg-bg-secondary px-3 pointer-coarse:h-11"
        onChange={event => {
          if (event.currentTarget.value === "" && (key === "paragraphSpacingEm" || key === "paragraphIndentEm")) change({ [key]: null });
          else if (event.currentTarget.validity.valid && Number.isFinite(event.currentTarget.valueAsNumber)) change({ [key]: event.currentTarget.valueAsNumber });
        }} />
    </label>
  );
  const toggle = (key: "publisherStyles" | "hyphenate" | "dimImages" | "pdfThemePages", label: string) => (
    <label className="flex min-h-11 items-center gap-3 text-sm" key={key}><input type="checkbox" checked={p[key]} onChange={event => change({ [key]: event.currentTarget.checked })} />{label}</label>
  );
  const capability = readerFontCapabilityNote(p.font, p.fontWeight);
  return <Dialog open={props.open} onClose={props.onClose} title="Reading settings" className="max-w-lg" expandable={false}>
    <div className="flex flex-col gap-4" data-reader-widget>
      {!props.defaultsOnly && <SegmentedControl ariaLabel="Save reading settings for" value={scope} onChange={setScope} options={[
        { value: "book", label: "This book" }, { value: "defaults", label: `All books on ${props.deviceClass}` },
      ]} />}
      {!props.defaultsOnly && <p className="text-xs text-fg-secondary">Changes to all books also remove these fields from this book's overrides.</p>}
      <div className="flex flex-col gap-2 text-sm">
        <p id="reader-page-colour">Page colour</p>
        <SegmentedControl ariaLabelledby="reader-page-colour" value={p.theme} onChange={theme => change({ theme })} options={[
          { value: "durtal-dark", label: "Dark" }, { value: "paper", label: "Light" }, { value: "sepia", label: "Sepia" },
        ]} />
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <p id="reader-font">Font</p>
        <FontPicker labelledBy="reader-font" value={p.font} onChange={font => change({ font })} />
      </div>
      {capability && <p className="text-xs text-fg-secondary">{capability}</p>}
      {toggle("publisherStyles", "Use publisher typography")}
      {p.publisherStyles ? number("publisherScale", "Publisher text scale (%)", 60, 250, 5) : <>
        {number("fontSizePx", "Font size", 12, 40, 1)}{number("fontWeight", "Weight", 300, 600, 50)}
        {number("lineHeight", "Line height", 1.2, 2.4, 0.05)}
        {number("paragraphSpacingEm", "Paragraph spacing (em)", 0, 2, 0.25)}
        {number("paragraphIndentEm", "Paragraph indent (em)", 0, 3, 0.5)}
        {number("letterSpacingEm", "Letter spacing (em)", 0, 0.1, 0.01)}{number("wordSpacingEm", "Word spacing (em)", 0, 0.3, 0.05)}
        {select("textAlign", "Alignment", [{ value: "book", label: "Book" }, { value: "start", label: "Start" }, { value: "justify", label: "Justified" }])}
        {toggle("hyphenate", "Hyphenate words")}
      </>}
      {select("flow", "Flow", [{ value: "paginated", label: "Pages" }, { value: "scrolled", label: "Scroll" }])}
      {select("spread", "Spreads", [{ value: "auto", label: "Automatic" }, { value: "none", label: "One page" }, { value: "both", label: "Two pages" }])}
      {number("marginPx", "Side margins (px)", 8, 96, 8)}
      {select("lineLength", "Line length", [{ value: "narrow", label: "Narrow" }, { value: "medium", label: "Medium" }, { value: "wide", label: "Wide" }, { value: "full", label: "Full width" }])}
      {select("pageTurn", "Page turn", [{ value: "none", label: "Instant" }, { value: "slide", label: "Slide" }])}
      {number("brightness", "Brightness (%)", 70, 100, 5)}{number("warmth", "Warmth (%)", 0, 100, 10)}{toggle("dimImages", "Dim images in the dark theme")}
      {select("fixedFit", "Fixed page fit", [{ value: "page", label: "Fit page" }, { value: "width", label: "Fit width" }])}
      {select("cropMargins", "PDF page margins", [{ value: "auto", label: "Automatic for scans" }, { value: "on", label: "Crop margins" }, { value: "off", label: "Full page" }])}
      {toggle("pdfThemePages", "Apply the book theme to PDF pages")}
      {(props.error || props.recoveryError) && <p role="alert" className="text-sm text-accent-red-text">{props.error ?? props.recoveryError}</p>}
      <p role="status" className="text-xs text-fg-secondary">{props.saving ? "Saving settings" : props.pending ? "Changes are waiting to save" : "Settings saved"}</p>
      <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" onClick={() => props.onReset(scope)}>Reset {scope === "book" ? "this book" : "defaults"}</Button>
        {(props.error || props.pending > 0) && <Button variant="ghost" size="sm" onClick={props.onRetry}>Try saving again</Button>}
      </div>
    </div>
  </Dialog>;
}
