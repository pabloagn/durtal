"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { X } from "lucide-react";

const PRESET_COLORS = [
  { name: "Rose", hex: "#7d3d52" },
  { name: "Gold", hex: "#c0a36e" },
  { name: "Sage", hex: "#5a8a6a" },
  { name: "Blue", hex: "#4a6d8a" },
  { name: "Plum", hex: "#6b4d7d" },
  { name: "Amber", hex: "#a68a5a" },
  { name: "Teal", hex: "#4a7d7d" },
  { name: "Coral", hex: "#a65a5a" },
  { name: "Lavender", hex: "#7d6ba6" },
  { name: "Slate", hex: "#6b7d7d" },
  { name: "Olive", hex: "#6b7d5a" },
  { name: "Copper", hex: "#8a6b5a" },
];

interface TaxonomyColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
}

export function TaxonomyColorPicker({
  value,
  onChange,
}: TaxonomyColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [customHex, setCustomHex] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const handlePresetClick = useCallback(
    (hex: string) => {
      onChange(hex);
      setOpen(false);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
    setOpen(false);
  }, [onChange]);

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customHex.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      onChange(trimmed.toLowerCase());
      setCustomHex("");
      setOpen(false);
    }
  }, [customHex, onChange]);

  return (
    <div ref={containerRef} className="relative inline-flex">
      {/* Trigger: color dot */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-5 w-5 items-center justify-center rounded-sm transition-colors hover:bg-bg-tertiary"
        aria-label="Pick color"
      >
        {value ? (
          <span
            className="block h-2 w-2 rounded-full"
            style={{ backgroundColor: value }}
          />
        ) : (
          <span className="block h-2 w-2 rounded-full border border-fg-muted/40" />
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-sm border border-glass-border bg-bg-secondary p-3 shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)]">
          {/* Preset grid: 4 columns x 3 rows */}
          <div className="grid grid-cols-4 gap-2">
            {PRESET_COLORS.map((preset) => {
              const isActive = value === preset.hex;
              return (
                <button
                  key={preset.hex}
                  type="button"
                  onClick={() => handlePresetClick(preset.hex)}
                  title={preset.name}
                  className={`flex h-8 w-full items-center justify-center rounded-sm transition-all ${
                    isActive
                      ? "ring-1 ring-fg-secondary ring-offset-1 ring-offset-bg-secondary"
                      : "hover:ring-1 hover:ring-fg-muted/30 hover:ring-offset-1 hover:ring-offset-bg-secondary"
                  }`}
                >
                  <span
                    className="block h-4 w-4 rounded-full"
                    style={{ backgroundColor: preset.hex }}
                  />
                </button>
              );
            })}
          </div>

          {/* Separator */}
          <div className="my-2.5 border-t border-glass-border" />

          {/* None option */}
          <button
            type="button"
            onClick={handleClear}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary"
          >
            <X className="h-3 w-3" strokeWidth={1.5} />
            <span>None</span>
          </button>

          {/* Separator */}
          <div className="my-2.5 border-t border-glass-border" />

          {/* Custom hex input */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={customHex}
              onChange={(e) => setCustomHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCustomSubmit();
                }
              }}
              placeholder="#a1b2c3"
              className="h-7 flex-1 rounded-sm border border-glass-border bg-bg-primary/80 px-2 font-mono text-xs text-fg-primary placeholder:text-fg-muted transition-colors focus:border-accent-rose focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCustomSubmit}
              disabled={!/^#[0-9a-fA-F]{6}$/.test(customHex.trim())}
              className="h-7 rounded-sm border border-glass-border bg-glass-highlight px-2 text-xs text-fg-secondary transition-colors hover:bg-bg-tertiary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
