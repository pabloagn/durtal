import { asc } from "drizzle-orm";
import { workAuthors } from "@/lib/db/schema";

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
  },
} as const;
