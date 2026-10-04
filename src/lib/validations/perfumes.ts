import { z } from "zod";
import { catalogueDateSchema, datesInOrder } from "@/lib/catalogue/dates";
import {
  NOTE_POSITIONS,
  PERFUME_CONCENTRATIONS,
  PERFUME_CONTAINERS,
  PERFUME_ORGANIZATION_ROLES,
  checkPerfumeBottle,
  variantPerfumerSchema,
} from "@/lib/catalogue/perfumes";
import { PERSONAL_HOLDING_STATUSES } from "@/lib/catalogue/holdings";
import { creditListSchema } from "./people";


const source = z.uuid().nullable().default(null);
const date = catalogueDateSchema.nullable();
const label = z.string().trim().min(1).max(200).nullable();
function unique<T>(key: (value: T) => string, message: string) {
  return (list: T[], ctx: z.RefinementCtx) => {
    if (new Set(list.map(key)).size !== list.length)
      ctx.addIssue({ code: "custom", message });
  };
}
const dateOrder = "The end date cannot precede the start date";

export const perfumeOrganizationInputSchema = z.strictObject({
  organizationId: z.uuid(),
  role: z.enum(PERFUME_ORGANIZATION_ROLES),
  sourceRecordId: source,
});
export const perfumeNoteInputSchema = z.strictObject({
  itemId: z.uuid(),
  position: z.enum(NOTE_POSITIONS).default("unspecified"),
  sourceRecordId: source,
});
/** Array order is the display order within each role or note position. */
const organizations = z
  .array(perfumeOrganizationInputSchema)
  .max(100)
  .superRefine(
    unique(
      (o) => `${o.organizationId}:${o.role}`,
      "List each organization once per role",
    ),
  );
const notePyramid = z
  .array(perfumeNoteInputSchema)
  .max(500)
  .superRefine(
    unique(
      (n) => `${n.itemId}:${n.position}`,
      "List each note once per position",
    ),
  );
const itemIds = z
  .array(z.uuid())
  .max(500)
  .superRefine(unique((id) => id, "List each classification once"));

const perfumeFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(50000).nullable(),
  releaseDate: date,
  discontinuedDate: date,
  sourceRecordId: z.uuid().nullable(),
  organizations,
  credits: creditListSchema,
  notePyramid,
  classificationItemIds: itemIds,
};
/**
 * A fragrance identity. A flanker is its own fragrance, never a formulation;
 * bottle size belongs to a container, never to the fragrance or formulation.
 */
export const createPerfumeSchema = z
  .strictObject({
    title: perfumeFields.title,
    description: perfumeFields.description.default(null),
    releaseDate: date.default(null),
    discontinuedDate: date.default(null),
    organizations: organizations.default([]),
    credits: creditListSchema.default([]),
    notePyramid: notePyramid.default([]),
    classificationItemIds: itemIds.default([]),
  })
  .refine((v) => datesInOrder(v.releaseDate, v.discontinuedDate), dateOrder)
  .refine(
    (v) =>
      [...v.organizations, ...v.notePyramid].every((x) => !x.sourceRecordId),
    "Record sources after the perfume exists",
  );
/** Each supplied section replaces that section; omitted sections stay as they are. */
export const updatePerfumeSchema = z
  .strictObject(perfumeFields)
  .partial()
  .refine((v) => datesInOrder(v.releaseDate, v.discontinuedDate), dateOrder);

const variantFields = {
  concentration: z.enum(PERFUME_CONCENTRATIONS).nullable(),
  concentrationLabel: label,
  formulationLabel: label,
  releaseDate: date,
  discontinuedDate: date,
  sourceRecordId: z.uuid().nullable(),
  notes: z.string().max(10000).nullable(),
  /** null inherits the fragrance's perfumers; [] records no attributed perfumer. */
  perfumers: z.array(variantPerfumerSchema).max(100).nullable(),
  /** null inherits the fragrance's notes; [] replaces them with none. */
  notePyramid: notePyramid.nullable(),
  /** Each listed family replaces the fragrance's values; others are inherited. */
  classification: z
    .array(z.strictObject({ familyId: z.uuid(), itemIds }))
    .max(50)
    .superRefine(unique((f) => f.familyId, "List each family once")),
};
export const createPerfumeVariantSchema = z
  .strictObject({
    workId: z.uuid(),
    concentration: variantFields.concentration.default(null),
    concentrationLabel: label.default(null),
    formulationLabel: label.default(null),
    releaseDate: date.default(null),
    discontinuedDate: date.default(null),
    sourceRecordId: source,
    notes: variantFields.notes.default(null),
    perfumers: variantFields.perfumers.default(null),
    notePyramid: variantFields.notePyramid.default(null),
    classification: variantFields.classification.default([]),
  })
  .refine(
    (v) => v.concentration !== "other" || !!v.concentrationLabel,
    "Describe the other concentration",
  )
  .refine((v) => datesInOrder(v.releaseDate, v.discontinuedDate), dateOrder);
export const updatePerfumeVariantSchema = z
  .strictObject(variantFields)
  .partial()
  .refine((v) => datesInOrder(v.releaseDate, v.discontinuedDate), dateOrder);

const bottleFields = {
  variantId: z.uuid(),
  container: z.enum(PERFUME_CONTAINERS),
  capacityValue: z.number().finite().positive().max(1000000),
  volumeUnit: z.enum(["ml", "l"]),
  remainingMl: z.number().finite().nonnegative().nullable(),
  status: z.enum(PERSONAL_HOLDING_STATUSES),
  batchCode: z.string().trim().min(1).max(200).nullable(),
  condition: z.string().trim().min(1).max(300).nullable(),
  locationId: z.uuid().nullable(),
  subLocationId: z.uuid().nullable(),
  acquisitionDate: date,
  supplierId: z.uuid().nullable(),
  venueId: z.uuid().nullable(),
  acquisitionPrice: z.number().finite().nonnegative().max(999999999.99).nullable(),
  acquisitionCurrency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  dispositionDate: date,
  dispositionReason: z.string().trim().min(1).max(1000).nullable(),
  notes: z.string().max(10000).nullable(),
};
/** Values for a new container when the input leaves a field out. */
export const PERFUME_BOTTLE_DEFAULTS = {
  remainingMl: null,
  status: "held",
  batchCode: null,
  condition: null,
  locationId: null,
  subLocationId: null,
  acquisitionDate: null,
  supplierId: null,
  venueId: null,
  acquisitionPrice: null,
  acquisitionCurrency: null,
  dispositionDate: null,
  dispositionReason: null,
  notes: null,
} as const;
/** A whole bottle, sample or decant record, validated across its fields. */
export const perfumeBottleRecordSchema = z
  .strictObject(bottleFields)
  .superRefine((v, ctx) =>
    checkPerfumeBottle(
      { ...v, hasDisposition: !!v.dispositionDate || !!v.dispositionReason },
      ctx,
    ),
  )
  .refine((v) => datesInOrder(v.acquisitionDate, v.dispositionDate), dateOrder);
/** Supplied fields only. Merged with defaults or the stored record, then validated whole. */
export const perfumeBottlePatchSchema = z.strictObject(bottleFields).partial();

const year = z.number().int().min(-999999).max(999999);
export const PERFUME_SORTS = ["title", "release", "recent", "rating"] as const;
export const perfumeQuerySchema = z
  .strictObject({
    search: z.string().trim().max(200).optional(),
    /** Any of these as perfume house or brand. */
    houseIds: z.array(z.uuid()).max(50).optional(),
    /** With `houseIds`: only in this role (an organization page's "As brand" row). */
    houseRole: z.enum(["perfume_house", "brand", "manufacturer"]).optional(),
    /** Any of these as perfumer of the fragrance or of one formulation. */
    perfumerIds: z.array(z.uuid()).max(50).optional(),
    /**
     * Families, accords and notes: every item must match, directly or through
     * a narrower item, on the fragrance or on one formulation.
     */
    taxonomyItemIds: z.array(z.uuid()).max(50).optional(),
    /** Any of these as the concentration of one formulation. */
    concentrations: z.array(z.enum(PERFUME_CONCENTRATIONS)).max(8).optional(),
    /** Release period overlaps these years; unknown releases never match. */
    releaseYearFrom: year.optional(),
    releaseYearTo: year.optional(),
    /** Active (not disposed) personal containers. */
    holding: z.enum(["any", "owned", "not_owned"]).default("any"),
    containers: z.array(z.enum(PERFUME_CONTAINERS)).max(3).optional(),
    favourite: z.boolean().optional(),
    sort: z.enum(PERFUME_SORTS).default("title"),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(200).default(48),
    offset: z.number().int().min(0).max(1000000).default(0),
  })
  .refine(
    (v) =>
      v.releaseYearFrom === undefined ||
      v.releaseYearTo === undefined ||
      v.releaseYearFrom <= v.releaseYearTo,
    "The first year cannot follow the last year",
  )
  .refine(
    (v) => !v.containers?.length || v.holding !== "not_owned",
    "Container filters need owned perfumes",
  );
export type PerfumeQuery = z.input<typeof perfumeQuerySchema>;
export type CreatePerfumeInput = z.input<typeof createPerfumeSchema>;
export type UpdatePerfumeInput = z.input<typeof updatePerfumeSchema>;
export type CreatePerfumeVariantInput = z.input<
  typeof createPerfumeVariantSchema
>;
export type UpdatePerfumeVariantInput = z.input<
  typeof updatePerfumeVariantSchema
>;
export type PerfumeBottlePatch = z.input<typeof perfumeBottlePatchSchema>;
export type PerfumeBottleInput = PerfumeBottlePatch &
  Pick<
    z.input<typeof perfumeBottleRecordSchema>,
    "variantId" | "container" | "capacityValue" | "volumeUnit"
  >;
