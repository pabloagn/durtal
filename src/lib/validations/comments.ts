import { z } from "zod";
import { ACTIVITY_ENTITY_TYPES } from "@/lib/activity/entities";

export const createCommentSchema = z.object({
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: z.string().uuid(),
  contentHtml: z.string().min(1).max(50000),
  contentJson: z.any().optional(),
});

export const updateCommentSchema = z.object({
  contentHtml: z.string().min(1).max(50000),
  contentJson: z.any().optional(),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
