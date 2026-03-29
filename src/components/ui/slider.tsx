"use client";

interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
}

export function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  formatValue,
}: SliderProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-fg-secondary">{label}</label>
        <span className="font-mono text-micro text-fg-muted">
          {formatValue ? formatValue(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="slider-track h-1 w-full cursor-pointer appearance-none rounded-sm bg-bg-tertiary accent-accent-rose"
      />
    </div>
  );
}
