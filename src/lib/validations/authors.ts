import { z } from "zod/v4";

export const createAuthorSchema = z.object({
  name: z.string().min(1, "Name is required").max(300),
  sortName: z.string().max(300).nullable().optional(),
  birthYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  deathYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  nationality: z.string().max(100).nullable().optional(),
  bio: z.string().max(10000).nullable().optional(),
  website: z.string().url().nullable().optional(),
  openLibraryKey: z.string().max(50).nullable().optional(),
  goodreadsId: z.string().max(50).nullable().optional(),
});

export const updateAuthorSchema = createAuthorSchema.partial();

export type CreateAuthorInput = z.infer<typeof createAuthorSchema>;
export type UpdateAuthorInput = z.infer<typeof updateAuthorSchema>;
