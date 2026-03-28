import { z } from "zod/v4";

export const createWorkSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  originalLanguage: z.string().default("en"),
  originalYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  description: z.string().max(10000).nullable().optional(),
  seriesName: z.string().max(300).nullable().optional(),
  seriesPosition: z.string().max(20).nullable().optional(),
  isAnthology: z.boolean().default(false),
  notes: z.string().max(10000).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional(),
  catalogueStatus: z.enum(["tracked", "shortlisted", "wanted", "on_order", "accessioned", "deaccessioned"]).default("tracked"),
  acquisitionPriority: z.enum(["none", "low", "medium", "high", "urgent"]).default("none"),
  authorIds: z.array(z.object({
    authorId: z.string().uuid(),
    role: z.enum(["author", "co_author"]).default("author"),
  })).min(1, "At least one author is required"),
  subjectIds: z.array(z.string().uuid()).optional(),
});

export const updateWorkSchema = createWorkSchema.partial().omit({ authorIds: undefined }).extend({
  authorIds: z.array(z.object({
    authorId: z.string().uuid(),
    role: z.enum(["author", "co_author"]).default("author"),
  })).optional(),
});

export type CreateWorkInput = z.input<typeof createWorkSchema>;
export type UpdateWorkInput = z.input<typeof updateWorkSchema>;
