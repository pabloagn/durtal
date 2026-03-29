import type { CatalogueStatus, AcquisitionPriority } from "@/lib/types";

// ── Status configuration ────────────────────────────────────────────────────

export const STATUS_CONFIG: Record<
  CatalogueStatus,
  {
    label: string;
    shortLabel: string;
    variant: "muted" | "blue" | "gold" | "rose" | "sage" | "red";
  }
> = {
  accessioned: { label: "Accessioned", shortLabel: "A", variant: "sage" },
  wanted: { label: "Wanted", shortLabel: "W", variant: "gold" },
  tracked: { label: "Tracked", shortLabel: "T", variant: "muted" },
  shortlisted: { label: "Shortlisted", shortLabel: "S", variant: "blue" },
  on_order: { label: "On Order", shortLabel: "O", variant: "rose" },
  deaccessioned: { label: "Deaccessioned", shortLabel: "D", variant: "red" },
};

// ── Priority configuration ──────────────────────────────────────────────────

export const PRIORITY_CONFIG: Record<
  AcquisitionPriority,
  {
    label: string;
    variant: "red" | "gold" | "blue" | "muted";
    dotColor: string;
    glowColor: string;
  }
> = {
  urgent: { label: "Urgent", variant: "red", dotColor: "bg-accent-red", glowColor: "shadow-[0_0_6px_#bb3e4199]" },
  high: { label: "High", variant: "gold", dotColor: "bg-accent-gold", glowColor: "shadow-[0_0_6px_#c0a36e99]" },
  medium: { label: "Medium", variant: "blue", dotColor: "bg-accent-blue", glowColor: "shadow-[0_0_6px_#64849399]" },
  low: { label: "Low", variant: "muted", dotColor: "bg-fg-muted", glowColor: "shadow-[0_0_5px_#4a4f4d66]" },
  none: { label: "None", variant: "muted", dotColor: "bg-fg-muted", glowColor: "" },
};

// ── Helper functions ────────────────────────────────────────────────────────

export function priorityVariant(
  priority: string,
): "red" | "gold" | "blue" | "muted" {
  const config = PRIORITY_CONFIG[priority as AcquisitionPriority];
  return config?.variant ?? "muted";
}
