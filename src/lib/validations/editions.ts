import { z } from "zod/v4";

export const createEditionSchema = z.object({
  workId: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(500),
  subtitle: z.string().max(500).nullable().optional(),

  // Identifiers
  isbn13: z.string().length(13).regex(/^\d{13}$/, "Must be 13 digits").nullable().optional(),
  isbn10: z.string().length(10).nullable().optional(),
  asin: z.string().max(20).nullable().optional(),
  lccn: z.string().max(20).nullable().optional(),
  oclc: z.string().max(20).nullable().optional(),
  openLibraryKey: z.string().max(50).nullable().optional(),
  googleBooksId: z.string().max(50).nullable().optional(),
  goodreadsId: z.string().max(50).nullable().optional(),

  // Publication
  publisher: z.string().max(300).nullable().optional(),
  imprint: z.string().max(300).nullable().optional(),
  publicationDate: z.string().nullable().optional(),
  publicationYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  publicationCountry: z.string().max(100).nullable().optional(),

  // Edition details
  editionName: z.string().max(200).nullable().optional(),
  editionNumber: z.number().int().positive().nullable().optional(),
  printingNumber: z.number().int().positive().nullable().optional(),
  isFirstEdition: z.boolean().optional().default(false),
  isLimitedEdition: z.boolean().optional().default(false),
  limitedEditionCount: z.number().int().positive().nullable().optional(),

  // Language
  language: z.string().default("en"),
  isTranslated: z.boolean().optional().default(false),

  // Physical
  pageCount: z.number().int().positive().nullable().optional(),
  binding: z.string().nullable().optional(),
  heightMm: z.number().int().positive().nullable().optional(),
  widthMm: z.number().int().positive().nullable().optional(),
  depthMm: z.number().int().positive().nullable().optional(),
  weightGrams: z.number().int().positive().nullable().optional(),
  illustrationType: z.string().nullable().optional(),

  // Content
  description: z.string().max(10000).nullable().optional(),
  tableOfContents: z.string().max(20000).nullable().optional(),

  // Cover
  coverSourceUrl: z.string().url().nullable().optional(),

  // Metadata
  metadataSource: z.string().nullable().optional(),
  metadataLocked: z.boolean().optional().default(false),

  // Personal
  notes: z.string().max(10000).nullable().optional(),

  // Relations
  contributorIds: z.array(z.object({
    authorId: z.string().uuid(),
    role: z.string().min(1),
  })).optional(),
  genreIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

export const updateEditionSchema = createEditionSchema.partial().omit({ workId: undefined });

export type CreateEditionInput = z.input<typeof createEditionSchema>;
export type UpdateEditionInput = z.input<typeof updateEditionSchema>;
