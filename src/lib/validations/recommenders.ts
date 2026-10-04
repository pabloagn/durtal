import { z } from "zod/v4";
import { parseWebsite } from "@/lib/utils/website";

export { parseWebsite, websiteLabel } from "@/lib/utils/website";

export const recommenderInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  url: z
    .string()
    .nullable()
    .optional()
    .transform((raw, ctx) => {
      const result = parseWebsite(raw);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", message: result.error });
        return z.NEVER;
      }
      return result.value;
    }),
});

export type RecommenderInput = z.input<typeof recommenderInputSchema>;
