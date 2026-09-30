import { z } from "zod";
import {
  computeOwnershipSummary,
  computeDerivedStatus,
  type InstanceWithLocation,
  type CatalogueStatusValue,
} from "@/lib/utils/ownership";

/** Book adapters preserve all legacy lifecycle and partial-holdings semantics. */
export function bookHoldings(
  status: CatalogueStatusValue,
  instances: InstanceWithLocation[],
) {
  const ownership = computeOwnershipSummary(instances);
  return {
    kind: "book" as const,
    personallyOwned: ownership.totalActive > 0,
    ...ownership,
    lifecycle: computeDerivedStatus(status, ownership),
  };
}

export const PERSONAL_HOLDING_STATUSES = [
  "held",
  "lent_out",
  "in_storage",
  "missing",
  "disposed",
] as const;
export const personalHoldingStatusSchema = z.enum(PERSONAL_HOLDING_STATUSES);
const holder = z.object({ id: z.uuid(), status: personalHoldingStatusSchema });
export const perfumeHoldingSchema = holder.extend({
  container: z.enum(["bottle", "sample", "decant"]),
  remainingMl: z.number().finite().nonnegative().nullable(),
});
export const filmHoldingSchema = holder.extend({
  medium: z.enum(["physical", "digital"]),
});
export const artOwnershipSchema = z.discriminatedUnion("ownership", [
  holder.extend({
    ownership: z.literal("personal"),
    objectKind: z.enum(["original", "version", "reproduction"]),
  }),
  z.object({
    id: z.uuid(),
    ownership: z.enum(["institutional", "private", "unknown"]),
    objectKind: z.enum(["original", "version", "reproduction"]),
  }),
]);
export type PerfumeHolding = z.input<typeof perfumeHoldingSchema>;
export type FilmHolding = z.input<typeof filmHoldingSchema>;
export type ArtOwnership = z.input<typeof artOwnershipSchema>;

function assertUnique(rows: { id: string }[]) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error("A personal holding cannot be counted more than once");
}
function summarize<
  T extends { id: string; status: z.infer<typeof personalHoldingStatusSchema> },
>(rows: T[]) {
  assertUnique(rows);
  const active = rows.filter((row) => row.status !== "disposed");
  return {
    active,
    personallyOwned: active.length > 0,
    activeCount: active.length,
    disposedCount: rows.length - active.length,
  };
}
export function perfumeHoldings(input: PerfumeHolding[]) {
  const { active, ...summary } = summarize(
    z.array(perfumeHoldingSchema).parse(input),
  );
  return {
    kind: "perfume" as const,
    ...summary,
    bottles: active.filter((r) => r.container === "bottle").length,
    samples: active.filter((r) => r.container === "sample").length,
    decants: active.filter((r) => r.container === "decant").length,
    knownRemainingMl: active.reduce((sum, r) => sum + (r.remainingMl ?? 0), 0),
    unknownRemainingCount: active.filter((r) => r.remainingMl === null).length,
  };
}
/** Viewings, wishlists and streaming availability are deliberately absent. */
export function filmHoldings(input: FilmHolding[]) {
  const { active, ...summary } = summarize(
    z.array(filmHoldingSchema).parse(input),
  );
  return {
    kind: "film" as const,
    ...summary,
    physicalCount: active.filter((r) => r.medium === "physical").length,
    digitalCount: active.filter((r) => r.medium === "digital").length,
  };
}
/** Custody at a museum and ownership by an institution never imply personal ownership. */
export function paintingHoldings(input: ArtOwnership[]) {
  const rows = z.array(artOwnershipSchema).parse(input);
  assertUnique(rows);
  const { active, ...summary } = summarize(
    rows.filter((r) => r.ownership === "personal"),
  );
  return {
    kind: "painting" as const,
    ...summary,
    originals: active.filter((r) => r.objectKind === "original").length,
    versions: active.filter((r) => r.objectKind === "version").length,
    reproductions: active.filter((r) => r.objectKind === "reproduction").length,
  };
}
