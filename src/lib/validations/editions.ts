import { z } from "zod/v4";
import { normalizeBinding } from "@/lib/utils/binding";
import { toUpdateSchema } from "./helpers";

export const createEditionSchema = z.object({
  workId: z.string().uuid(),
  title: z.string().min(1, "Title is required").max(500),
  subtitle: z.string().max(500).nullable().optional(),

  // Identifiers
  isbn13: z
    .string()
    .length(13)
    .regex(/^\d{13}$/, "Must be 13 digits")
    .nullable()
    .optional(),
  isbn10: z.string().length(10).nullable().optional(),
  asin: z.string().max(20).nullable().optional(),
  lccn: z.string().max(20).nullable().optional(),
  oclc: z.string().max(20).nullable().optional(),
  openLibraryKey: z.string().max(50).nullable().optional(),
  googleBooksId: z.string().max(50).nullable().optional(),
  goodreadsId: z.string().max(50).nullable().optional(),

  // Publication
  publisherIds: z.array(z.uuid()).max(20).optional(),
  publisher: z.string().max(300).nullable().optional(),
  imprint: z.string().max(300).nullable().optional(),
  publicationDate: z.string().nullable().optional(),
  publicationYear: z.number().int().min(-3000).max(2100).nullable().optional(),
  publicationCountry: z.string().max(100).nullable().optional(),

  // Edition details
  editionName: z.string().max(200).nullable().optional(),
  editionNumber: z.number().int().min(1).nullable().optional(),
  printingNumber: z.number().int().min(1).nullable().optional(),
  isFirstEdition: z.boolean().optional().default(false),
  isLimitedEdition: z.boolean().optional().default(false),
  limitedEditionCount: z.number().int().min(1).nullable().optional(),

  // Language
  language: z.string().default("en"),
  isTranslated: z.boolean().optional().default(false),

  // Physical — accept 0 as null (empty field parsed to 0)
  pageCount: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  // A source's text ("Mass Market Paperback") takes its code; unknown text fails
  binding: z
    .string()
    .nullable()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === null || !value.trim())
        return value === undefined ? undefined : null;
      const code = normalizeBinding(value);
      if (!code)
        ctx.issues.push({
          code: "custom",
          message: `Unknown binding: ${value}`,
          input: value,
        });
      return code ?? z.NEVER;
    }),
  heightMm: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  widthMm: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  depthMm: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
  weightGrams: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional()
    .transform((v) => (v === 0 ? null : v)),
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
  // An author by id, or by name: found by that name or created with the edition
  contributorIds: z
    .array(
      z.union([
        z.object({ authorId: z.string().uuid(), role: z.string().min(1) }),
        z.object({
          authorName: z.string().trim().min(1).max(300),
          role: z.string().min(1),
        }),
      ]),
    )
    .optional(),
  genreIds: z.array(z.string().uuid()).optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

/**
 * Partial update: no defaults (language and the edition flags are never
 * reset), unknown keys rejected. workId stays: reparenting an edition is
 * allowed, and updateEdition checks that the new parent is a book.
 */
export const updateEditionSchema = toUpdateSchema(createEditionSchema);

export type CreateEditionInput = z.input<typeof createEditionSchema>;
export type UpdateEditionInput = z.input<typeof updateEditionSchema>;
