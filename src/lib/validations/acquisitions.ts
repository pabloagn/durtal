import { z } from "zod/v4";
import { PERFUME_CONTAINERS } from "@/lib/catalogue/perfumes";
import { FILM_HOLDING_MEDIA } from "@/lib/catalogue/films";
import { createOrderSchema } from "./orders";

/** What a film, perfume or painting target names (SLN-374) */
export const typedTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("perfume"),
    workId: z.uuid(),
    variantId: z.uuid(),
    container: z.enum(PERFUME_CONTAINERS),
    capacityValue: z
      .number()
      .positive("Enter a size above 0")
      .max(1_000_000, "Enter a smaller size"),
    volumeUnit: z.enum(["ml", "l"]),
  }),
  z.object({
    kind: z.literal("film"),
    workId: z.uuid(),
    versionId: z.uuid(),
    releaseId: z.uuid().nullable().optional(),
    medium: z.enum(FILM_HOLDING_MEDIA),
    formatLabel: z.string().trim().min(1).max(200).nullable().optional(),
  }),
  z.object({
    kind: z.literal("painting"),
    workId: z.uuid(),
    objectId: z.uuid(),
    /** A reproduction of the object, not the object itself */
    reproduction: z.boolean(),
  }),
]);
export type TypedTargetInput = z.input<typeof typedTargetSchema>;

/** An order for a target: the work and the target come from the target */
export const typedOrderSchema = createOrderSchema
  .omit({ workId: true, acquisitionTargetId: true, editionId: true, instanceId: true })
  .extend({ targetId: z.uuid() });
export type TypedOrderInput = z.input<typeof typedOrderSchema>;
