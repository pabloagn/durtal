"use client";

interface GridSizeSliderProps {
  value: number;
  onChange: (cols: number) => void;
}

export function GridSizeSlider({ value, onChange }: GridSizeSliderProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-micro text-fg-muted">Size</span>
      <input
        type="range"
        min={2}
        max={8}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent-rose [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-rose"
      />
    </div>
  );
}
