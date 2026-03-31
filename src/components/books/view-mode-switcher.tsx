"use client";

import { Grid2X2, List, Table2, Map, GanttChart } from "lucide-react";

export type ViewMode = "grid" | "list" | "detailed" | "map" | "timeline";

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  availableModes?: ViewMode[];
}

const ALL_MODES: { value: ViewMode; icon: typeof Grid2X2; label: string }[] = [
  { value: "grid", icon: Grid2X2, label: "Grid" },
  { value: "list", icon: List, label: "List" },
  { value: "detailed", icon: Table2, label: "Detailed" },
  { value: "map", icon: Map, label: "Map" },
  { value: "timeline", icon: GanttChart, label: "Timeline" },
];

export function ViewModeSwitcher({ value, onChange, availableModes }: ViewModeSwitcherProps) {
  const MODES = availableModes
    ? ALL_MODES.filter((m) => availableModes.includes(m.value))
    : ALL_MODES.filter((m) => m.value !== "map" && m.value !== "timeline");

  return (
    <div className="flex items-center rounded-sm border border-glass-border">
      {MODES.map((mode) => {
        const Icon = mode.icon;
        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            title={mode.label}
            className={`px-2 py-1.5 transition-colors ${
              value === mode.value
                ? "bg-accent-plum text-fg-primary"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        );
      })}
    </div>
  );
}
