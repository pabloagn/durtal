import type { getCatalogueProvenance } from "@/lib/actions/catalogue-provenance";
import type { SourceView } from "@/components/catalogue/sources-section";
import { catalogueDateText } from "./dates";

type Provenance = Awaited<ReturnType<typeof getCatalogueProvenance>>;

/**
 * A record's sources as its Sources section lists them. A source the
 * reader cited by hand can be removed while nothing on the record (`cited`)
 * names it.
 */
export function sourceViews(provenance: Provenance, cited: Set<string>): SourceView[] {
  return provenance.observations.map((o) => {
    const payload = o.payload as { entry?: string; note?: string };
    const manual = payload.entry === "manual" && !o.locked;
    return {
      id: o.id,
      attribution: o.attribution,
      url: o.url,
      provider: o.provider,
      consulted: `Consulted ${catalogueDateText({
        precision: "day",
        start: {
          year: o.retrievedAt.getUTCFullYear(),
          month: o.retrievedAt.getUTCMonth() + 1,
          day: o.retrievedAt.getUTCDate(),
        },
        end: null,
        approximate: false,
        label: null,
      })}`,
      note: typeof payload.note === "string" ? payload.note : null,
      removable: manual && !cited.has(o.id),
      kept: cited.has(o.id) ? "Cited here" : null,
    };
  });
}

/** The sources a form can cite for a fact, by name */
export function sourceChoices(provenance: Provenance) {
  return provenance.observations.map((o) => ({
    id: o.id,
    label: o.attribution ?? o.provider,
  }));
}
