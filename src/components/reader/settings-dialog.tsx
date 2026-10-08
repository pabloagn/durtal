"use client";

import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  READER_ALIGNMENTS,
  READER_FONTS,
  READER_FONT_SIZES,
  READER_LINE_HEIGHTS,
  READER_MARGINS,
  type ReaderThemeSettings,
} from "@/lib/reader/settings-cookie";

const numbers = (values: number[], label: (value: number) => string) =>
  values.map((value) => ({ value: String(value), label: label(value) }));

function Choice({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div role="group" aria-labelledby={id}>
      <p id={id} className="type-label mb-2">
        {label}
      </p>
      <SegmentedControl options={options} value={value} onChange={onChange} ariaLabelledby={id} />
    </div>
  );
}

/**
 * The reader's five settings (eBooks sub-issue 3): font, size, line height,
 * margins and alignment, in the durtal-reader-settings cookie that Settings
 * › Reader edits too. Each change applies to the open book at once.
 */
export function SettingsDialog({
  open,
  onClose,
  settings,
  onChange,
  onReset,
}: {
  open: boolean;
  onClose: () => void;
  settings: ReaderThemeSettings;
  onChange: (update: Partial<ReaderThemeSettings>) => void;
  onReset: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title="Settings" className="max-w-lg" expandable={false}>
      <div className="flex flex-col gap-5">
        <Choice
          id="reader-setting-font"
          label="Font"
          options={READER_FONTS}
          value={settings.fontFamily}
          onChange={(value) => onChange({ fontFamily: value as ReaderThemeSettings["fontFamily"] })}
        />
        <Choice
          id="reader-setting-size"
          label="Font size"
          options={numbers(READER_FONT_SIZES, (size) => String(size))}
          value={String(settings.fontSize)}
          onChange={(value) => onChange({ fontSize: Number(value) })}
        />
        <Choice
          id="reader-setting-line-height"
          label="Line height"
          options={numbers(READER_LINE_HEIGHTS, (height) => height.toFixed(1))}
          value={String(settings.lineHeight)}
          onChange={(value) => onChange({ lineHeight: Number(value) })}
        />
        <Choice
          id="reader-setting-margins"
          label="Margins"
          options={numbers(READER_MARGINS, (margin) => `${margin}%`)}
          value={String(settings.margin)}
          onChange={(value) => onChange({ margin: Number(value) })}
        />
        <Choice
          id="reader-setting-alignment"
          label="Alignment"
          options={READER_ALIGNMENTS}
          value={settings.textAlign}
          onChange={(value) => onChange({ textAlign: value as ReaderThemeSettings["textAlign"] })}
        />
        <div>
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
