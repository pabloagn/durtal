import { asc, sql, type AnyColumn } from "drizzle-orm";
import { workAuthors } from "@/lib/db/schema";

/**
 * Extra for a `media` relation: `tone`, the poster's main color
 * (`color_palette.dominant.hex`). A cover frame shows it while the image
 * loads. Only the hex leaves the database, not the palette.
 */
export const posterTone = (fields: { colorPalette: AnyColumn }) => ({
  tone: sql<string | null>`${fields.colorPalette}->'dominant'->>'hex'`.as("tone"),
});

/**
 * Relations a book card in a carousel needs ("More by …", similar works):
 * authors, one edition with its copies, and media for the active poster.
 */
export const workCardWith = {
  workAuthors: {
    with: { author: { columns: { name: true } } },
    orderBy: asc(workAuthors.sortOrder),
  },
  editions: {
    columns: {
      id: true,
      thumbnailS3Key: true,
      publicationYear: true,
      language: true,
    },
    limit: 1,
    with: {
      instances: { columns: { id: true } },
    },
  },
  media: {
    columns: {
      s3Key: true,
      thumbnailS3Key: true,
      type: true,
      isActive: true,
      cropX: true,
      cropY: true,
      cropZoom: true,
      brightness: true,
      contrast: true,
    },
    extras: posterTone,
  },
} as const;
