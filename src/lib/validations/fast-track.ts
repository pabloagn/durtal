import { z } from "zod/v4";
import { createWorkSchema } from "./works";
import { createEditionSchema } from "./editions";

// Only fields available in Details and the edition metadata already fetched.
// Skipped copy, taxonomy and collection drafts cannot enter this write path.
export const fastTrackBookSchema = z.object({
  authorName: z.string().trim().min(1, "Author is required").max(300),
  work: createWorkSchema
    .pick({
      title: true,
      originalLanguage: true,
      originalYear: true,
      description: true,
      seriesName: true,
      seriesPosition: true,
      catalogueStatus: true,
      acquisitionPriority: true,
      recommenderIds: true,
      metadataSource: true,
      metadataSourceId: true,
    })
    .extend({ title: z.string().trim().min(1, "Title is required").max(500) }),
  edition: createEditionSchema.pick({
    isbn13: true,
    publisher: true,
    publicationYear: true,
    language: true,
    pageCount: true,
    binding: true,
    coverSourceUrl: true,
    metadataSource: true,
  }),
});

export type FastTrackBookInput = z.input<typeof fastTrackBookSchema>;
