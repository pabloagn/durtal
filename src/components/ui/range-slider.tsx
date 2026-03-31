"use client";

import { useEffect, useRef, useState } from "react";

interface RangeSliderProps {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  step?: number;
  label?: string;
}

export function RangeSlider({
  min,
  max,
  value,
  onChange,
  step = 1,
  label,
}: RangeSliderProps) {
  const [localValue, setLocalValue] = useState<[number, number]>(value);
  // Track whether the user is currently dragging either thumb
  const isDraggingRef = useRef(false);

  // Keep local value in sync when external value changes (but only when not dragging)
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalValue(value);
    }
  }, [value[0], value[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    const clamped = Math.min(raw, localValue[1] - step);
    setLocalValue([clamped, localValue[1]]);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    const clamped = Math.max(raw, localValue[0] + step);
    setLocalValue([localValue[0], clamped]);
  };

  const handlePointerDown = () => {
    isDraggingRef.current = true;
  };

  const handlePointerUp = (thumb: "min" | "max") => (e: React.PointerEvent<HTMLInputElement>) => {
    isDraggingRef.current = false;
    // Read the committed value directly from the element to avoid stale closure
    const raw = Number((e.target as HTMLInputElement).value);
    let next: [number, number];
    if (thumb === "min") {
      const clamped = Math.min(raw, localValue[1] - step);
      next = [clamped, localValue[1]];
    } else {
      const clamped = Math.max(raw, localValue[0] + step);
      next = [localValue[0], clamped];
    }
    setLocalValue(next);
    onChange(next);
  };

  const range = max - min;
  const leftPct = range > 0 ? ((localValue[0] - min) / range) * 100 : 0;
  const rightPct = range > 0 ? ((localValue[1] - min) / range) * 100 : 100;

  return (
    <div className="px-1.5 pb-3 pt-1">
      {label && (
        <div className="mb-2 px-0 text-[11px] font-medium uppercase tracking-wider text-fg-muted">
          {label}
        </div>
      )}

      {/* Year labels */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[11px] text-fg-secondary">{localValue[0]}</span>
        <span className="font-mono text-[11px] text-fg-secondary">{localValue[1]}</span>
      </div>

      {/* Track + thumbs */}
      <div className="relative h-4">
        {/* Base track */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-glass-border" />

        {/* Active range fill */}
        <div
          className="absolute top-1/2 h-px -translate-y-1/2 bg-accent-plum"
          style={{ left: `${leftPct}%`, right: `${100 - rightPct}%` }}
        />

        {/* Min thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[0]}
          onChange={handleMinChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp("min")}
          className="range-thumb-min pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-accent-plum [&::-webkit-slider-thumb]:bg-bg-secondary [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:hover:bg-accent-plum [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-accent-plum [&::-moz-range-thumb]:bg-bg-secondary"
        />

        {/* Max thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={localValue[1]}
          onChange={handleMaxChange}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp("max")}
          className="range-thumb-max pointer-events-none absolute inset-0 h-full w-full appearance-none bg-transparent [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-accent-plum [&::-webkit-slider-thumb]:bg-bg-secondary [&::-webkit-slider-thumb]:transition-colors [&::-webkit-slider-thumb]:hover:bg-accent-plum [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-none [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-accent-plum [&::-moz-range-thumb]:bg-bg-secondary"
        />
      </div>

      {/* Min / max labels */}
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[10px] text-fg-muted/60">{min}</span>
        <span className="font-mono text-[10px] text-fg-muted/60">{max}</span>
      </div>
    </div>
  );
}
