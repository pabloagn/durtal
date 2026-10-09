"use client";

import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  SettingRow,
  SettingsGroup,
  SettingsIntro,
  settingLabelId,
} from "@/components/settings/settings-group";
import {
  READER_ALIGNMENTS,
  READER_FONTS,
  READER_FONT_SIZES,
  READER_FONT_STACKS,
  READER_LINE_HEIGHTS,
  READER_MARGINS,
  type ReaderThemeSettings,
} from "@/lib/reader/settings-cookie";
import { useReaderSettings } from "@/hooks/use-reader-settings";

const numbers = (values: number[], label: (value: number) => string) =>
  values.map((value) => ({ value: String(value), label: label(value) }));

/** One choice row: the reader's setting, its buttons under its name. */
function ChoiceRow({
  id,
  label,
  description,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SettingRow id={id} label={label} description={description} stacked labelFor={false}>
      <SegmentedControl
        options={options}
        value={value}
        onChange={onChange}
        ariaLabelledby={settingLabelId(id)}
      />
    </SettingRow>
  );
}

/**
 * The reader's page, in small: the reader's own colours and the chosen
 * font, size, spacing, margins and alignment. "Original" keeps each book's
 * own fonts, so the preview shows the interface font for it.
 */
function ReaderPreview({ settings }: { settings: ReaderThemeSettings }) {
  const fontFamily =
    settings.fontFamily === "sans" || settings.fontFamily === "publisher"
      ? "var(--font-sans)"
      : READER_FONT_STACKS[settings.fontFamily];
  return (
    <div
      aria-label="Preview of the reader"
      role="img"
      className="bg-bg-primary py-8"
      style={{ paddingInline: `${settings.margin}%` }}
    >
      <p
        className="text-fg-primary"
        style={{
          fontFamily,
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          textAlign: settings.textAlign,
          hyphens: settings.textAlign === "justify" ? "auto" : "manual",
        }}
      >
        The study was quiet. Rain moved over the windows, and the lamp threw a narrow circle of
        light across the desk, where a closed book waited beside a cup of cold tea. He opened it
        at the marked page and read until the street lamps came on outside, one after another,
        all the way down to the river.
      </p>
    </div>
  );
}

/** The reader's typography: a cookie in this browser, shared with the reader's own panel. */
export function ReaderDefaults() {
  const { settings, setSettings, resetSettings } = useReaderSettings();
  return (
    <>
      <SettingsIntro>
        Saved in this browser only. The reader changes the same settings.
      </SettingsIntro>

      <SettingsGroup
        title="Text"
        action={
          <Button variant="ghost" size="sm" onClick={resetSettings}>
            Reset to defaults
          </Button>
        }
      >
        <ChoiceRow
          id="reader-font"
          label="Font"
          description="Original keeps the fonts each book brings."
          options={READER_FONTS}
          value={settings.fontFamily}
          onChange={(value) =>
            setSettings({ fontFamily: value as ReaderThemeSettings["fontFamily"] })
          }
        />
        <ChoiceRow
          id="reader-font-size"
          label="Font size"
          options={numbers(READER_FONT_SIZES, (size) => `${size} px`)}
          value={String(settings.fontSize)}
          onChange={(value) => setSettings({ fontSize: Number(value) })}
        />
        <ChoiceRow
          id="reader-line-height"
          label="Line height"
          options={numbers(READER_LINE_HEIGHTS, (height) => height.toFixed(1))}
          value={String(settings.lineHeight)}
          onChange={(value) => setSettings({ lineHeight: Number(value) })}
        />
        <ChoiceRow
          id="reader-margins"
          label="Margins"
          description="Space on each side of the text, as a share of the page width."
          options={numbers(READER_MARGINS, (margin) => `${margin}%`)}
          value={String(settings.margin)}
          onChange={(value) => setSettings({ margin: Number(value) })}
        />
        <ChoiceRow
          id="reader-alignment"
          label="Alignment"
          options={READER_ALIGNMENTS}
          value={settings.textAlign}
          onChange={(value) =>
            setSettings({ textAlign: value as ReaderThemeSettings["textAlign"] })
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Preview">
        <ReaderPreview settings={settings} />
      </SettingsGroup>
    </>
  );
}
