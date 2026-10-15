"use client";
import { useId, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { readerFontCapabilityNote } from "@/lib/reader/presentation/fonts";
import { FontPicker } from "./font-picker";
import { ReaderSidePanel } from "./side-panel";
import type { DeviceClass, ReaderPresentation, PresentationOverride } from "@/lib/validations/reader-preferences";

/** What the open book is: its text reflows, or its pages are fixed (a PDF,
 * a comic or a fixed-layout book). The defaults page has no book and shows
 * every setting. */
export type PresentationKind = "reflowable" | "pdf" | "fixed";

type NumberKey = "fontSizePx" | "fontWeight" | "lineHeight" | "marginPx" | "publisherScale" | "brightness" | "warmth" | "letterSpacingEm" | "wordSpacingEm";
type BookValueKey = "paragraphSpacingEm" | "paragraphIndentEm";
type ToggleKey = "publisherStyles" | "hyphenate" | "dimImages" | "pdfThemePages" | "edgeTaps" | "pinBars";
type ChoiceKey = "textAlign" | "flow" | "spread" | "lineLength" | "pageTurn" | "fixedFit" | "cropMargins";

/** A titled group of settings; the first has no rule above it */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-glass-border pt-4 first:border-t-0 first:pt-0">
      <h3 className="type-label">{title}</h3>
      {children}
    </section>
  );
}

/** A number set by dragging or with the arrow keys, its value beside its name.
 * With `bookValue`, the first stop is the book's own value (none of ours). */
function RangeField({ label, value, min, max, step, unit, bookValue, onChange }: {
  label: string; value: number | null; min: number; max: number; step: number; unit: string;
  bookValue?: boolean; onChange(value: number | null): void;
}) {
  const id = useId();
  const floor = bookValue ? min - step : min;
  const shown = value === null ? "Book's value" : `${Number(value.toFixed(2))}${unit}`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="text-fg-secondary tabular-nums">{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        min={floor}
        max={max}
        step={step}
        value={value ?? floor}
        aria-valuetext={shown}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (!Number.isFinite(next)) return;
          // A whole number of steps, without the float's tail (1.2000000000000002)
          onChange(bookValue && next < min ? null : Number((Math.round(next / step) * step).toFixed(4)));
        }}
        // As the app's Slider: on touch the slider is 44px tall and its track stays a 4px line
        className="slider-track h-1 w-full cursor-pointer appearance-none rounded-sm bg-bg-tertiary accent-accent-primary pointer-coarse:h-11 pointer-coarse:rounded-none pointer-coarse:bg-transparent pointer-coarse:bg-[linear-gradient(var(--color-bg-tertiary),var(--color-bg-tertiary))] pointer-coarse:bg-[length:100%_4px] pointer-coarse:bg-center pointer-coarse:bg-no-repeat"
      />
    </div>
  );
}

export function PresentationSettingsDialog(props: {
  defaultsOnly?: boolean;
  /** In the reader: a sheet beside the text instead of a dialog over it */
  sheet?: boolean;
  /** The open book's kind: only the settings that change it show */
  kind?: PresentationKind;
  open: boolean; onClose(): void; presentation: ReaderPresentation; deviceClass: DeviceClass;
  error: string | null; saving: boolean; pending: number; recoveryError: string | null;
  onChange(patch: PresentationOverride, scope: "book" | "defaults"): void;
  onReset(scope: "book" | "defaults"): void; onRetry(): void;
}) {
  const [scope, setScope] = useState<"book" | "defaults">(props.defaultsOnly ? "defaults" : "book");
  const ids = useId();
  const p = props.presentation;
  const change = (patch: PresentationOverride) => props.onChange(patch, scope);
  const reflowable = props.kind === undefined || props.kind === "reflowable";
  const fixed = props.kind === undefined || props.kind === "pdf" || props.kind === "fixed";
  const pdf = props.kind === undefined || props.kind === "pdf";
  const paginated = props.kind !== "reflowable" || p.flow === "paginated";

  const choice = <K extends ChoiceKey>(key: K, label: string, options: readonly { value: ReaderPresentation[K] & string; label: string }[]) => (
    <div className="flex flex-col gap-2 text-sm" key={key}>
      <p id={`${ids}-${key}`}>{label}</p>
      <SegmentedControl ariaLabelledby={`${ids}-${key}`} value={p[key] as ReaderPresentation[K] & string}
        onChange={(value) => change({ [key]: value } as PresentationOverride)} options={options} />
    </div>
  );
  const range = (key: NumberKey, label: string, min: number, max: number, step: number, unit = "") => (
    <RangeField key={key} label={label} value={p[key]} min={min} max={max} step={step} unit={unit}
      onChange={(value) => { if (value !== null) change({ [key]: value }); }} />
  );
  const bookRange = (key: BookValueKey, label: string, max: number, step: number) => (
    <RangeField key={key} label={label} value={p[key]} min={0} max={max} step={step} unit=" em" bookValue
      onChange={(value) => change({ [key]: value })} />
  );
  // The app's switch rows: the switch, then its words, which toggle it too (a 44px row on touch)
  const toggle = (key: ToggleKey, label: string) => (
    <div className="flex items-center gap-2" key={key}>
      <Switch id={`${ids}-${key}`} checked={p[key]} onCheckedChange={(checked) => change({ [key]: checked })} aria-labelledby={`${ids}-${key}-label`} />
      <label id={`${ids}-${key}-label`} htmlFor={`${ids}-${key}`} className="flex cursor-pointer items-center text-sm pointer-coarse:min-h-11">{label}</label>
    </div>
  );
  const capability = readerFontCapabilityNote(p.font, p.fontWeight);
  const body =
    <div className={"flex flex-col gap-6" + (props.sheet ? " px-2" : "")} data-reader-widget>
      {!props.defaultsOnly && <div className="flex flex-col gap-2">
        <SegmentedControl ariaLabel="Save reading settings for" value={scope} onChange={setScope} options={[
          { value: "book", label: "This book" }, { value: "defaults", label: `All books on ${props.deviceClass}` },
        ]} />
        <p className="text-xs text-fg-secondary">Changes to all books also remove these fields from this book&apos;s overrides.</p>
      </div>}
      <Section title="Page">
        <div className="flex flex-col gap-2 text-sm">
          <p id="reader-page-colour">Page colour</p>
          <SegmentedControl ariaLabelledby="reader-page-colour" value={p.theme} onChange={theme => change({ theme })} options={[
            { value: "durtal-dark", label: "Dark" }, { value: "paper", label: "Light" }, { value: "sepia", label: "Sepia" },
          ]} />
        </div>
        {range("brightness", "Brightness", 70, 100, 5, "%")}
        {range("warmth", "Warmth", 0, 100, 10, "%")}
        {props.kind !== "pdf" && toggle("dimImages", "Dim images in the dark theme")}
        {pdf && toggle("pdfThemePages", props.kind === undefined ? "Apply the book theme to PDF pages" : "Apply the page colour to the PDF's pages")}
      </Section>
      {reflowable && <Section title="Text">
        <div className="flex flex-col gap-2 text-sm">
          <p id="reader-font">Font</p>
          <FontPicker labelledBy="reader-font" value={p.font} onChange={font => change({ font })} />
        </div>
        {capability && <p className="text-xs text-fg-secondary">{capability}</p>}
        {toggle("publisherStyles", "Use publisher typography")}
        {p.publisherStyles ? range("publisherScale", "Publisher text scale", 60, 250, 5, "%") : <>
          {range("fontSizePx", "Font size", 12, 40, 1, " px")}
          {range("fontWeight", "Weight", 300, 600, 50)}
          {range("lineHeight", "Line height", 1.2, 2.4, 0.05)}
          {choice("textAlign", "Alignment", [{ value: "book", label: "Book" }, { value: "start", label: "Start" }, { value: "justify", label: "Justified" }])}
          {toggle("hyphenate", "Hyphenate words")}
          {bookRange("paragraphSpacingEm", "Paragraph spacing", 2, 0.25)}
          {bookRange("paragraphIndentEm", "Paragraph indent", 3, 0.5)}
          {range("letterSpacingEm", "Letter spacing", 0, 0.1, 0.01, " em")}
          {range("wordSpacingEm", "Word spacing", 0, 0.3, 0.05, " em")}
        </>}
      </Section>}
      <Section title="Layout">
        {reflowable && choice("flow", "Flow", [{ value: "paginated", label: "Pages" }, { value: "scrolled", label: "Scroll" }])}
        {paginated && choice("spread", "Spreads", [{ value: "auto", label: "Automatic" }, { value: "none", label: "One page" }, { value: "both", label: "Two pages" }])}
        {reflowable && choice("lineLength", "Line length", [{ value: "narrow", label: "Narrow" }, { value: "medium", label: "Medium" }, { value: "wide", label: "Wide" }, { value: "full", label: "Full width" }])}
        {reflowable && range("marginPx", "Side margins", 8, 96, 8, " px")}
        {fixed && choice("fixedFit", props.kind === undefined ? "Fixed page fit (PDFs and comics)" : "Page fit", [{ value: "page", label: "Fit page" }, { value: "width", label: "Fit width" }])}
        {pdf && choice("cropMargins", props.kind === undefined ? "PDF page margins" : "Page margins", [{ value: "auto", label: "Automatic for scans" }, { value: "on", label: "Crop" }, { value: "off", label: "Full page" }])}
      </Section>
      <Section title="Turning pages">
        {paginated && choice("pageTurn", "Page turn", [{ value: "slide", label: "Slide" }, { value: "fade", label: "Fade" }, { value: "none", label: "Instant" }])}
        {toggle("edgeTaps", "Tap the edges to turn pages")}
        {toggle("pinBars", "Keep the toolbars visible")}
      </Section>
      <div className="flex flex-col gap-2">
        {(props.error || props.recoveryError) && <p role="alert" className="text-sm text-accent-red-text">{props.error ?? props.recoveryError}</p>}
        <p role="status" className="text-xs text-fg-secondary">{props.saving ? "Saving settings" : props.pending ? "Changes are waiting to save" : "Settings saved"}</p>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" size="sm" className="-ml-2.5" onClick={() => props.onReset(scope)}>Reset {scope === "book" ? "this book" : "defaults"}</Button>
          {(props.error || props.pending > 0) && <Button variant="ghost" size="sm" onClick={props.onRetry}>Try saving again</Button>}
        </div>
      </div>
    </div>;
  return props.sheet
    ? <ReaderSidePanel open={props.open} onClose={props.onClose} title="Reading settings" variant="settings">{body}</ReaderSidePanel>
    : <Dialog open={props.open} onClose={props.onClose} title="Reading settings" className="max-w-lg" expandable={false}>{body}</Dialog>;
}
