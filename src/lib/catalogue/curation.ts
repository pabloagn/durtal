import { z } from "zod";
import { WORK_KINDS } from "./kinds";
import { RATING_SCHEMA } from "@/lib/validations/helpers";

export const curationOwnerSchema = z.object({
  id: z.uuid(),
  kind: z.enum(WORK_KINDS),
});
/** Sparse edits cannot carry acquisition, ownership or consumption state. */
export const curationPatchSchema = z.strictObject({
  notes: z.string().max(10000).nullable().optional(),
  rating: RATING_SCHEMA,
  isFavourite: z.boolean().optional(),
  recommenderIds: z.array(z.uuid()).max(100).optional(),
});
export type CurationPatch = z.input<typeof curationPatchSchema>;
export type CurationOwner = z.input<typeof curationOwnerSchema>;
