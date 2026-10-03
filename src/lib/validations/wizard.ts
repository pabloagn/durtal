import { z } from "zod/v4";
import { createWorkSchema } from "./works";
import { createEditionSchema } from "./editions";
import { createInstanceSchema } from "./instances";

const ids = z.array(z.uuid()).max(500).optional();

/** Everything the add-book wizard submits, validated before anything is written. */
export const wizardBookSchema = z
  .object({
    /** Primary author of a new work, found by name or created with the book. */
    authorName: z.string().trim().max(300).optional(),
    /** Add the edition to this book instead of creating one. */
    existingWorkId: z.uuid().nullable().optional(),
    /** The new work (required without an existing one). */
    work: createWorkSchema.omit({ authorIds: true, subjectIds: true }).optional(),
    /** Book taxonomy of a new work, by family. */
    taxonomy: z
      .object({
        subjectIds: ids,
        categoryIds: ids,
        themeIds: ids,
        literaryMovementIds: ids,
        artTypeIds: ids,
        artMovementIds: ids,
        keywordIds: ids,
        attributeIds: ids,
      })
      .optional(),
    edition: createEditionSchema.omit({ workId: true }),
    copies: z
      .array(createInstanceSchema.omit({ editionId: true }))
      .max(50)
      .default([]),
    collectionIds: z.array(z.uuid()).max(50).default([]),
  })
  .refine((book) => book.existingWorkId || book.work, {
    message: "Work details are required",
    path: ["work"],
  })
  .refine((book) => book.existingWorkId || book.authorName, {
    message: "Author is required",
    path: ["authorName"],
  });

export type WizardBookInput = z.input<typeof wizardBookSchema>;
