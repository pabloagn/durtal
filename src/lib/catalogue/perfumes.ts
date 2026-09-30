import { z } from "zod";
import { PERSONAL_HOLDING_STATUSES } from "./holdings";
import { ATTRIBUTIONS } from "./credits";

export const PERFUME_CONCENTRATIONS = [
  "extrait",
  "parfum",
  "eau_de_parfum",
  "eau_de_toilette",
  "eau_de_cologne",
  "eau_fraiche",
  "oil",
  "other",
] as const;
export const PERFUME_ORGANIZATION_ROLES = [
  "perfume_house",
  "brand",
  "manufacturer",
] as const;
export const NOTE_POSITIONS = ["top", "heart", "base", "unspecified"] as const;
export const PERFUME_CONTAINERS = ["bottle", "sample", "decant"] as const;
export const variantPerfumerSchema = z
  .strictObject({
    id: z.uuid().optional(),
    personId: z.uuid().nullable(),
    creditedAs: z.string().trim().min(1).max(300).nullable().default(null),
    attribution: z.enum(ATTRIBUTIONS).default("unspecified"),
    sourceRecordId: z.uuid().nullable().default(null),
    notes: z.string().max(10000).nullable().default(null),
  })
  .refine(
    (v) =>
      !!v.personId ||
      !!v.creditedAs ||
      v.attribution === "unknown" ||
      v.attribution === "anonymous",
    "Choose a perfumer, record the credited name or mark the attribution unknown",
  );
const optionalLabel = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .nullable()
  .default(null);
export const perfumeVariantSchema = z
  .strictObject({
    workId: z.uuid(),
    concentration: z.enum(PERFUME_CONCENTRATIONS).nullable().default(null),
    concentrationLabel: optionalLabel,
    formulationLabel: optionalLabel,
    perfumersOverride: z.boolean().default(false),
    releaseDateId: z.uuid().nullable().default(null),
    discontinuedDateId: z.uuid().nullable().default(null),
    sourceRecordId: z.uuid().nullable().default(null),
    notes: z.string().max(10000).nullable().default(null),
  })
  .refine(
    (v) => v.concentration !== "other" || !!v.concentrationLabel,
    "Describe the other concentration",
  );
export const perfumeBottleSchema = z
  .strictObject({
    variantId: z.uuid(),
    container: z.enum(PERFUME_CONTAINERS),
    capacityValue: z.number().finite().positive().max(1000000),
    volumeUnit: z.enum(["ml", "l"]),
    remainingMl: z.number().finite().nonnegative().nullable().default(null),
    status: z.enum(PERSONAL_HOLDING_STATUSES).default("held"),
    batchCode: z.string().trim().min(1).max(200).nullable().default(null),
    condition: z.string().trim().min(1).max(300).nullable().default(null),
    locationId: z.uuid().nullable().default(null),
    subLocationId: z.uuid().nullable().default(null),
    acquisitionDateId: z.uuid().nullable().default(null),
    supplierId: z.uuid().nullable().default(null),
    venueId: z.uuid().nullable().default(null),
    acquisitionPrice: z
      .number()
      .finite()
      .nonnegative()
      .max(999999999.99)
      .nullable()
      .default(null),
    acquisitionCurrency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .default(null),
    dispositionDateId: z.uuid().nullable().default(null),
    dispositionReason: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .nullable()
      .default(null),
    notes: z.string().max(10000).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const capacityMl = v.capacityValue * (v.volumeUnit === "l" ? 1000 : 1);
    for (const [field, amount] of [
      ["capacityValue", capacityMl],
      ["remainingMl", v.remainingMl],
    ] as const)
      if (
        amount !== null &&
        Math.abs(amount * 1000 - Math.round(amount * 1000)) > 0.000001
      )
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Use volumes precise to at most 0.001 ml",
        });
    if (v.remainingMl !== null && v.remainingMl > capacityMl)
      ctx.addIssue({
        code: "custom",
        path: ["remainingMl"],
        message: "Remaining volume exceeds capacity",
      });
    if (v.subLocationId && !v.locationId)
      ctx.addIssue({
        code: "custom",
        path: ["subLocationId"],
        message: "Choose a parent location",
      });
    if ((v.acquisitionPrice === null) !== (v.acquisitionCurrency === null))
      ctx.addIssue({
        code: "custom",
        message: "Price and currency must be supplied together",
      });
    if (v.status !== "disposed" && (v.dispositionDateId || v.dispositionReason))
      ctx.addIssue({
        code: "custom",
        message: "Disposition details require a disposed container",
      });
  });
