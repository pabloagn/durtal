import { z } from "zod";
import { createAuthorSchema } from "./authors";
import { ATTRIBUTIONS } from "@/lib/catalogue/credits";
import { WORK_KINDS } from "@/lib/catalogue/kinds";

const aliases = z.array(z.string().trim().min(1).max(300)).max(50);
const personFields = createAuthorSchema.extend({
  name: z.string().trim().min(1).max(300),
  birthPlaceId: z.uuid().nullable().optional(),
  deathPlaceId: z.uuid().nullable().optional(),
});
export const createPersonSchema = personFields.extend({
  domains: z.array(z.enum(WORK_KINDS)).min(1).max(4),
  aliases: aliases.default([]),
});
export const updatePersonSchema = personFields
  .partial()
  .extend({ aliases: aliases.optional() });
export type CreatePersonInput = z.input<typeof createPersonSchema>;
export type UpdatePersonInput = z.input<typeof updatePersonSchema>;

export const creditInputSchema = z
  .object({
    id: z.uuid().optional(),
    personId: z.uuid().nullable(),
    roleId: z.string().min(1).max(300),
    creditedAs: z.string().trim().min(1).max(300).nullable().default(null),
    attribution: z.enum(ATTRIBUTIONS).default("unspecified"),
    characters: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
    notes: z.string().max(10000).nullable().default(null),
  })
  .superRefine((credit, ctx) => {
    if (
      !credit.personId &&
      !credit.creditedAs &&
      !["anonymous", "unknown"].includes(credit.attribution)
    )
      ctx.addIssue({
        code: "custom",
        path: ["personId"],
        message:
          "Choose a person, record the credited name, or mark the creator as unknown or anonymous",
      });
    if (credit.characters.length && credit.roleId !== "film.cast")
      ctx.addIssue({
        code: "custom",
        path: ["characters"],
        message: "Characters belong to film cast credits",
      });
  });
export const creditListSchema = z
  .array(creditInputSchema)
  .max(500)
  .superRefine((credits, ctx) => {
    const ids = credits.flatMap((credit) => (credit.id ? [credit.id] : []));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: "custom",
        message: "Each credit ID must appear once",
      });
  });
export type CreditInput = z.input<typeof creditInputSchema>;
