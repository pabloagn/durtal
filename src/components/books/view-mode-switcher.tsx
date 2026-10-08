"use client";

import { Grid2X2, Images, List, Table2, Map, GanttChart } from "lucide-react";
import { VIEW_MODE_LABELS } from "@/lib/preferences";

export type ViewMode = "grid" | "mosaic" | "list" | "detailed" | "map" | "timeline";

interface ViewModeSwitcherProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  availableModes?: ViewMode[];
}

const ALL_MODES: { value: ViewMode; icon: typeof Grid2X2; label: string }[] = [
  { value: "grid", icon: Grid2X2, label: VIEW_MODE_LABELS.grid },
  { value: "mosaic", icon: Images, label: VIEW_MODE_LABELS.mosaic },
  { value: "list", icon: List, label: VIEW_MODE_LABELS.list },
  { value: "detailed", icon: Table2, label: VIEW_MODE_LABELS.detailed },
  { value: "map", icon: Map, label: VIEW_MODE_LABELS.map },
  { value: "timeline", icon: GanttChart, label: VIEW_MODE_LABELS.timeline },
];

export function ViewModeSwitcher({ value, onChange, availableModes }: ViewModeSwitcherProps) {
  const MODES = availableModes
    ? ALL_MODES.filter((m) => availableModes.includes(m.value))
    : ALL_MODES.filter((m) => m.value === "grid" || m.value === "list" || m.value === "detailed");

  return (
    <div className="flex items-center rounded-sm border border-glass-border">
      {MODES.map((mode) => {
        const Icon = mode.icon;
        return (
          <button
            key={mode.value}
            onClick={() => onChange(mode.value)}
            aria-label={mode.label}
            data-tooltip={mode.label}
            className={`flex items-center justify-center px-2 py-1.5 transition-colors pointer-coarse:size-11 ${
              value === mode.value
                ? "bg-selection-bg text-fg-primary"
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
