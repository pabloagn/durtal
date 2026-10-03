import { HOLDING_STATUS_LABELS, type HoldingStatus } from "./holdings";
import type {
  NOTE_POSITIONS,
  PERFUME_CONCENTRATIONS,
  PERFUME_CONTAINERS,
} from "./perfumes";

export type PerfumeConcentration = (typeof PERFUME_CONCENTRATIONS)[number];
export type PerfumeContainer = (typeof PERFUME_CONTAINERS)[number];
export type NotePosition = (typeof NOTE_POSITIONS)[number];
// Shared by every collection; kept here for the perfume screens' imports
export { HOLDING_STATUS_LABELS };
export type { HoldingStatus };

/** The full name, and the short one for cards and chips */
export const CONCENTRATION_LABELS: Record<
  PerfumeConcentration,
  { label: string; short: string }
> = {
  extrait: { label: "Extrait de Parfum", short: "Extrait" },
  parfum: { label: "Parfum", short: "Parfum" },
  eau_de_parfum: { label: "Eau de Parfum", short: "EDP" },
  eau_de_toilette: { label: "Eau de Toilette", short: "EDT" },
  eau_de_cologne: { label: "Eau de Cologne", short: "EDC" },
  eau_fraiche: { label: "Eau Fraîche", short: "Eau Fraîche" },
  oil: { label: "Perfume oil", short: "Oil" },
  other: { label: "Other", short: "Other" },
};

export const CONTAINER_LABELS: Record<
  PerfumeContainer,
  { one: string; many: string }
> = {
  bottle: { one: "Bottle", many: "Bottles" },
  sample: { one: "Sample", many: "Samples" },
  decant: { one: "Decant", many: "Decants" },
};

export const NOTE_POSITION_LABELS: Record<NotePosition, string> = {
  top: "Top",
  heart: "Heart",
  base: "Base",
  unspecified: "Notes",
};

/**
 * A formulation as people name it: "Eau de Parfum Intense", "Parfum · 1925
 * formula". An "other" concentration is its own label; a formulation with no
 * known concentration says so.
 */
export function formulationName(
  v: {
    concentration: PerfumeConcentration | null;
    concentrationLabel: string | null;
    formulationLabel?: string | null;
  },
  { short = false }: { short?: boolean } = {},
) {
  const base =
    v.concentration === null || v.concentration === "other"
      ? (v.concentrationLabel ??
        (v.concentration === null ? "Unknown concentration" : "Other"))
      : [
          CONCENTRATION_LABELS[v.concentration][short ? "short" : "label"],
          v.concentrationLabel,
        ]
          .filter(Boolean)
          .join(" ");
  return v.formulationLabel ? `${base} · ${v.formulationLabel}` : base;
}

const volume = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

/** "75 ml", "1.5 l", "0.7 ml" */
export function formatVolume(value: number, unit: "ml" | "l" = "ml") {
  return `${volume.format(value)} ${unit}`;
}

/** "2 bottles, 1 sample"; null with nothing held */
export function holdingsSummary(counts: Record<PerfumeContainer, number>) {
  const parts = (["bottle", "sample", "decant"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) =>
      `${counts[kind]} ${(counts[kind] === 1 ? CONTAINER_LABELS[kind].one : CONTAINER_LABELS[kind].many).toLowerCase()}`,
    );
  return parts.length ? parts.join(", ") : null;
}

/** "€120.00": the currency's own symbol and decimals */
export function formatPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(
      amount,
    );
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

/** Notes by position, each in its stored order; empty positions are left out */
export function notesByPosition<T extends { position: NotePosition | null }>(
  notes: T[],
) {
  const positions: NotePosition[] = ["top", "heart", "base", "unspecified"];
  return positions
    .map((position) => ({
      position,
      notes: notes.filter((note) => (note.position ?? "unspecified") === position),
    }))
    .filter((group) => group.notes.length > 0);
}

/** What is left in a container, as a share of its capacity (0–1), when known */
export function remainingShare(remainingMl: number | null, capacityMl: number | null) {
  if (remainingMl === null || !capacityMl) return null;
  return Math.min(1, Math.max(0, remainingMl / capacityMl));
}
