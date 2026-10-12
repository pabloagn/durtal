import { z } from "zod/v4";
export const preferredEbookFileSchema = z.object({
  ebookId: z.uuid(),
  fileId: z.uuid(),
});
export type PreferredEbookFileInput = z.infer<typeof preferredEbookFileSchema>;
