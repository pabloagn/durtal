import { z } from "zod/v4";

export const createAuthorSchema = z.object({
  name: z.string().min(1, "Name is required").max(300),
  sortName: z.string().max(300).nullable().optional(),
  firstName: z.string().max(200).nullable().optional(),
  lastName: z.string().max(200).nullable().optional(),
  realName: z.string().max(300).nullable().optional(),
  gender: z.enum(["male", "female"]).nullable().optional(),
  birthYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthYearIsApproximate: z.boolean().optional(),
  birthYearGregorian: z.number().int().min(-3000).max(2100).nullable().optional(),
  deathYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  deathMonth: z.number().int().min(1).max(12).nullable().optional(),
  deathDay: z.number().int().min(1).max(31).nullable().optional(),
  deathYearIsApproximate: z.boolean().optional(),
  deathYearGregorian: z.number().int().min(-3000).max(2100).nullable().optional(),
  nationalityId: z.string().uuid().nullable().optional(),
  bio: z.string().max(10000).nullable().optional(),
  website: z.string().url().nullable().optional(),
  openLibraryKey: z.string().max(50).nullable().optional(),
  goodreadsId: z.string().max(50).nullable().optional(),
});

export const updateAuthorSchema = createAuthorSchema.partial();

export type CreateAuthorInput = z.infer<typeof createAuthorSchema>;
export type UpdateAuthorInput = z.infer<typeof updateAuthorSchema>;
