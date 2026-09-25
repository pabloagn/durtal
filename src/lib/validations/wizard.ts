import { z } from "zod/v4";
import { createWorkSchema } from "./works";
import { createEditionSchema } from "./editions";
import { createInstanceSchema } from "./instances";

const idList = z.array(z.string().uuid()).optional();

/** Everything the add-book wizard submits, validated before anything is written. */
export const wizardBookSchema = z
  .object({
    /** Primary author, found by name or created. Ignored when adding an edition to an existing work. */
    authorName: z.string().trim().min(1, "Author is required").max(300),
    /** Add the edition to this work instead of creating a new one. */
    existingWorkId: z.string().uuid().nullable().optional(),
    /** New work details (required when there is no existingWorkId). */
    work: createWorkSchema.omit({ authorIds: true, subjectIds: true }).optional(),
    taxonomy: z
      .object({
        subjectIds: idList,
        categoryIds: idList,
        themeIds: idList,
        literaryMovementIds: idList,
        artTypeIds: idList,
        artMovementIds: idList,
        keywordIds: idList,
        attributeIds: idList,
      })
      .optional(),
    edition: createEditionSchema.omit({ workId: true, contributorIds: true }),
    copies: z.array(createInstanceSchema.omit({ editionId: true })).max(50).default([]),
    collectionIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((d) => d.existingWorkId || d.work, { message: "Work details are required", path: ["work"] });

export type WizardBookInput = z.input<typeof wizardBookSchema>;
