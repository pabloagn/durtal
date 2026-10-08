"use client";

interface GridSizeSliderProps {
  value: number;
  onChange: (cols: number) => void;
}

export function GridSizeSlider({ value, onChange }: GridSizeSliderProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-micro text-fg-secondary">Size</span>
      <input
        type="range"
        aria-label="Grid size: cards per row"
        min={2}
        max={8}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        // On touch the slider is 44px tall: its track stays a 4px line drawn by the background
        className="h-1 w-20 cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary pointer-coarse:h-11 pointer-coarse:rounded-none pointer-coarse:bg-transparent pointer-coarse:bg-[linear-gradient(var(--color-bg-tertiary),var(--color-bg-tertiary))] pointer-coarse:bg-[length:100%_4px] pointer-coarse:bg-center pointer-coarse:bg-no-repeat"
      />
    </div>
  );
}
