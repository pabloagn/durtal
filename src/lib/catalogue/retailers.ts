import { z } from "zod/v4";
import { sourceUrlSchema } from "./provenance";
import { PERFUME_CONTAINERS } from "./perfumes";

export const RETAILER_AVAILABILITY = ["unknown", "in_stock", "out_of_stock", "preorder", "discontinued", "unlisted"] as const;
export const retailerLinkSchema = z.strictObject({
  workId: z.uuid(), variantId: z.uuid().nullable().optional(),
  organizationId: z.uuid(), venueId: z.uuid().nullable().optional(),
  url: sourceUrlSchema, sourceRecordId: z.uuid().nullable().optional(),
});
export type RetailerLinkInput = z.input<typeof retailerLinkSchema>;
export const retailerObservationSchema = z.strictObject({
  linkId: z.uuid(), checkedAt: z.iso.datetime({ offset: true }),
  availability: z.enum(RETAILER_AVAILABILITY).default("unknown"),
  price: z.number().min(0).max(999999999.99).multipleOf(0.01).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  container: z.enum(PERFUME_CONTAINERS).nullable().optional(),
  capacityMl: z.number().positive().max(1000000).multipleOf(0.001).nullable().optional(),
  packageLabel: z.string().trim().min(1).max(500).nullable().optional(),
  sourceRecordId: z.uuid().nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
}).refine(v => (v.price == null) === (v.currency == null), "Price and currency must be supplied together")
  .refine(v => v.capacityMl == null || v.container != null, "Offered capacity requires a container type");
export type RetailerObservationInput = z.input<typeof retailerObservationSchema>;
/** A freshness hint, never a claim that an observed offer is still available. */
export function retailerObservationAge(checkedAt: string | Date | null, now = new Date(), staleAfterDays = 30) {
  z.number().int().min(1).max(3650).parse(staleAfterDays);
  if (checkedAt === null) return { ageDays: null, isStale: true };
  const milliseconds = new Date(checkedAt).getTime();
  if (!Number.isFinite(milliseconds) || !Number.isFinite(now.getTime())) throw new Error("Invalid observation date");
  const ageDays = Math.max(0, Math.floor((now.getTime() - milliseconds) / 86400000));
  return { ageDays, isStale: ageDays >= staleAfterDays };
}
