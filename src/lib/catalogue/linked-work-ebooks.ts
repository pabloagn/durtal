import { catalogueAvailability } from "@/lib/ebooks/catalogue-availability";
import type { WorkEbookDTO } from "@/lib/ebooks/catalogue-dto";
import type { WorkRelationView } from "@/lib/actions/work-relations";

/** The books among a work's links, each once */
export function linkedBookIds(relations: readonly WorkRelationView[]) {
  return [...new Set(relations.filter((r) => r.other.kind === "book").map((r) => r.other.id))];
}

/**
 * The e-book each linked book's card opens, as the related rows mark theirs
 * (SLN-637). A page with no linked books reads nothing.
 */
export async function linkedWorkEbooks(
  relations: readonly WorkRelationView[],
): Promise<Record<string, WorkEbookDTO | null>> {
  const ids = linkedBookIds(relations);
  const digital = await catalogueAvailability(ids);
  return Object.fromEntries(ids.map((id) => [id, digital.get(id)?.read ?? null]));
}
