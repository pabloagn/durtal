import { z } from "zod/v4";
const optionalText = z.string().trim().max(10000).nullable().optional();
export const publisherSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    country: z.string().trim().max(200).nullable().optional(),
    website: z
      .string()
      .trim()
      .url()
      .refine(
        (v) => ["http:", "https:"].includes(new URL(v).protocol),
        "Use an HTTP or HTTPS website",
      )
      .nullable()
      .optional(),
    description: optionalText,
    notes: optionalText,
    kind: z.enum(["publisher", "imprint"]).default("publisher"),
    parentId: z.uuid().nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    specialtyIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine(
    (v) => (v.kind === "imprint" ? !!v.parentId : !v.parentId),
    "An imprint needs a parent publishing house",
  );
export const targetSchema = z
  .object({
    workId: z.uuid(),
    editionId: z.uuid().nullable().optional(),
    publisherId: z.uuid().nullable().optional(),
  })
  .refine(
    (v) => !v.editionId || !v.publisherId,
    "Choose an exact edition or a publisher preference",
  );
export type PublisherInput = z.input<typeof publisherSchema>;
export type TargetInput = z.input<typeof targetSchema>;
