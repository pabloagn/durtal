import { CONTAINER_LABELS, formatPrice, formatVolume, formulationName } from "./perfume-labels";
import { FILM_MEDIUM_LABELS, FILM_RELEASE_FORMAT_LABELS, releaseTerritory, versionName } from "./film-labels";
import { ART_OBJECT_KIND_LABELS, objectName } from "./painting-labels";
import type { PerfumeConcentration, PerfumeContainer } from "./perfume-labels";
import type { ArtObjectKind } from "./painting-labels";
// The order words live with the order constants (SLN-400); kept here for older imports
export { ORDER_STATUS_LABELS, ACQUISITION_METHOD_LABELS } from "@/lib/constants/orders";

/*
 * What a film, perfume or painting acquisition target names, in words
 * (SLN-374). A target is a wish for one thing: a formulation in a container
 * size, a version (and release) on a medium, or an object or a reproduction
 * of it. Its state is derived from its orders, as for a book.
 */

export type TargetState = "wanted" | "on_order" | "received" | "cancelled";

export const TARGET_STATE_LABELS: Record<TargetState, string> = {
  wanted: "Wanted",
  on_order: "On order",
  received: "Received",
  cancelled: "Removed",
};

export interface TargetDescription {
  perfume: {
    concentration: PerfumeConcentration | null;
    concentrationLabel: string | null;
    formulationLabel: string | null;
    container: PerfumeContainer;
    capacityValue: number;
    volumeUnit: "ml" | "l";
  } | null;
  film: {
    versionLabel: string | null;
    release: { format: string; countryName: string | null; territoryLabel: string | null } | null;
    medium: "physical" | "digital";
    formatLabel: string | null;
  } | null;
  painting: {
    reproduction: boolean;
    object: { kind: ArtObjectKind; label: string | null };
  } | null;
}

/**
 * "Eau de Parfum · Bottle · 50 ml", "Director's cut · France, Blu-ray ·
 * Physical, Blu-ray", "Reproduction of the original".
 */
export function targetTitle(t: TargetDescription) {
  if (t.perfume)
    return [
      formulationName(t.perfume),
      CONTAINER_LABELS[t.perfume.container].one,
      formatVolume(t.perfume.capacityValue, t.perfume.volumeUnit),
    ].join(" · ");
  if (t.film) {
    const release = t.film.release
      ? `${releaseTerritory(t.film.release)}, ${FILM_RELEASE_FORMAT_LABELS[t.film.release.format as keyof typeof FILM_RELEASE_FORMAT_LABELS] ?? t.film.release.format}`
      : null;
    const medium = [FILM_MEDIUM_LABELS[t.film.medium], t.film.formatLabel].filter(Boolean).join(", ");
    return [versionName({ label: t.film.versionLabel }), release, medium].filter(Boolean).join(" · ");
  }
  if (t.painting) {
    const { object } = t.painting;
    if (!t.painting.reproduction) return objectName(object);
    return object.label
      ? `Reproduction of ${object.label}`
      : `Reproduction of the ${ART_OBJECT_KIND_LABELS[object.kind].toLowerCase()}`;
  }
  return "Any edition";
}

/** "€120.00", or null for an order without a price */
export function orderCost(total: string | null, price: string | null, currency: string | null) {
  const amount = total ?? price;
  return amount !== null && currency ? formatPrice(Number(amount), currency) : null;
}

