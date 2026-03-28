import { z } from "zod/v4";

export const createInstanceSchema = z.object({
  editionId: z.string().uuid(),
  locationId: z.string().uuid(),
  subLocationId: z.string().uuid().nullable().optional(),
  status: z.enum(["available", "lent_out", "in_transit", "in_storage", "missing", "damaged", "deaccessioned"]).default("available"),
  format: z.string().nullable().optional(),

  // Condition
  condition: z.string().nullable().optional(),
  hasDustJacket: z.boolean().nullable().optional(),
  hasSlipcase: z.boolean().nullable().optional(),
  conditionNotes: z.string().max(2000).nullable().optional(),

  // Collector
  isSigned: z.boolean().default(false),
  signedBy: z.string().max(300).nullable().optional(),
  inscription: z.string().max(2000).nullable().optional(),
  isFirstPrinting: z.boolean().default(false),
  provenance: z.string().max(5000).nullable().optional(),

  // Acquisition
  acquisitionType: z.string().nullable().optional(),
  acquisitionDate: z.string().nullable().optional(),
  acquisitionSource: z.string().max(500).nullable().optional(),
  acquisitionPrice: z.string().nullable().optional(),
  acquisitionCurrency: z.string().max(3).nullable().optional(),

  // Digital
  calibreId: z.number().int().nullable().optional(),
  calibreUrl: z.string().url().nullable().optional(),
  fileSizeBytes: z.number().int().nullable().optional(),

  // Disposition (for deaccessioned instances)
  dispositionType: z.enum(["sold", "donated", "gifted", "traded", "lost", "stolen", "destroyed", "returned", "expired"]).nullable().optional(),
  dispositionDate: z.string().nullable().optional(),
  dispositionTo: z.string().max(500).nullable().optional(),
  dispositionPrice: z.string().nullable().optional(),
  dispositionCurrency: z.string().max(3).nullable().optional(),
  dispositionNotes: z.string().max(5000).nullable().optional(),

  // Personal
  notes: z.string().max(10000).nullable().optional(),
  lentTo: z.string().max(300).nullable().optional(),
  lentDate: z.string().nullable().optional(),
});

export const updateInstanceSchema = createInstanceSchema.partial().omit({
  editionId: undefined,
});

export type CreateInstanceInput = z.input<typeof createInstanceSchema>;
export type UpdateInstanceInput = z.input<typeof updateInstanceSchema>;
