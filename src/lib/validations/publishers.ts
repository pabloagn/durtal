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
    foundedYear: z.number().int().min(1000).max(2100).nullable().optional(),
    foundedPlaceId: z.uuid().nullable().optional(),
    kind: z.enum(["group", "publisher", "imprint"]).default("publisher"),
    parentId: z.uuid().nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    /** ISBN publisher prefixes ("978-1-59017"); undefined leaves the saved rules */
    isbnPrefixes: z
      .array(
        z
          .string()
          .transform((v) => v.replace(/[^0-9]/g, ""))
          .pipe(z.string().regex(/^97[89][0-9]{2,10}$/, "Use an ISBN prefix such as 978-1-59017")),
      )
      .max(100)
      .optional(),
    specialtyIds: z.array(z.uuid()).max(100).default([]),
  })
  .refine(
    (v) => (v.kind === "imprint" ? !!v.parentId : v.kind === "group" ? !v.parentId : true),
    "An imprint needs its publisher; a group has no parent",
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
