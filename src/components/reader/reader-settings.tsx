"use client";

import type { ReaderThemeSettings } from "./epub-theme";

interface ReaderSettingsProps {
  open: boolean;
  onClose: () => void;
  settings: ReaderThemeSettings;
  onSettingsChange: (update: Partial<ReaderThemeSettings>) => void;
  onReset: () => void;
}

export function ReaderSettings({
  open,
  onClose,
  settings,
  onSettingsChange,
  onReset,
}: ReaderSettingsProps) {
  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-bg-primary/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 z-50 flex h-dvh w-72 flex-col border-l border-glass-border bg-bg-secondary">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-glass-border px-4">
          <h2 className="font-serif text-sm text-fg-primary">
            Reader Settings
          </h2>
          <button
            onClick={onClose}
            className="text-micro text-fg-muted transition-colors hover:text-fg-primary"
          >
            ESC
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Font family */}
          <div>
            <label className="mb-2 block text-micro font-medium text-fg-muted uppercase tracking-wider">
              Font
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["sans", "Sans"],
                  ["serif", "Serif"],
                  ["system", "System"],
                  ["publisher", "Original"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onSettingsChange({ fontFamily: value })}
                  className={`rounded-sm border px-3 py-1.5 text-xs transition-colors ${
                    settings.fontFamily === value
                      ? "border-accent-rose/40 bg-accent-plum/60 text-fg-primary"
                      : "border-glass-border text-fg-secondary hover:border-fg-muted/20 hover:text-fg-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Font size */}
          <SettingSlider
            label="Font Size"
            value={settings.fontSize}
            min={14}
            max={28}
            step={2}
            unit="px"
            onChange={(v) => onSettingsChange({ fontSize: v })}
          />

          {/* Line height */}
          <SettingSlider
            label="Line Height"
            value={settings.lineHeight}
            min={1.4}
            max={2.4}
            step={0.2}
            unit=""
            onChange={(v) =>
              onSettingsChange({ lineHeight: Math.round(v * 10) / 10 })
            }
          />

          {/* Margins */}
          <SettingSlider
            label="Margins"
            value={settings.margin}
            min={4}
            max={20}
            step={4}
            unit="%"
            onChange={(v) => onSettingsChange({ margin: v })}
          />

          {/* Text alignment */}
          <div>
            <label className="mb-2 block text-micro font-medium text-fg-muted uppercase tracking-wider">
              Alignment
            </label>
            <div className="flex gap-1.5">
              {(["left", "justify"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => onSettingsChange({ textAlign: value })}
                  className={`flex-1 rounded-sm border px-3 py-1.5 text-xs capitalize transition-colors ${
                    settings.textAlign === value
                      ? "border-accent-rose/40 bg-accent-plum/60 text-fg-primary"
                      : "border-glass-border text-fg-secondary hover:border-fg-muted/20 hover:text-fg-primary"
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-glass-border p-4">
          <button
            onClick={onReset}
            className="w-full rounded-sm border border-glass-border px-3 py-1.5 text-xs text-fg-muted transition-colors hover:border-fg-muted/20 hover:text-fg-secondary"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </>
  );
}

// ── Slider ───────────────────────────────────────────────────────────────────

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="text-micro font-medium text-fg-muted uppercase tracking-wider">
          {label}
        </label>
        <span className="font-mono text-micro text-fg-secondary">
          {Number.isInteger(value) ? value : value.toFixed(1)}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent-rose"
      />
    </div>
  );
}
