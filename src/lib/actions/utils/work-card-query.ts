import { asc, inArray, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { editions, media, workAuthors } from "@/lib/db/schema";
import {
  lastReadAtSql,
  openReadingPercentSql,
  readCountSql,
  readingStateSql,
} from "@/lib/reading/summary";

/**
 * Extra for a `media` relation: `tone`, the poster's main color
 * (`color_palette.dominant.hex`). A cover frame shows it while the image
 * loads. Only the hex leaves the database, not the palette.
 */
export const posterTone = (fields: { colorPalette: AnyColumn }) => ({
  tone: sql<string | null>`${fields.colorPalette}->'dominant'->>'hex'`.as(
    "tone",
  ),
});

/**
 * Relations a book card in a carousel needs ("More by …", similar works):
 * authors, one edition with its copies, and media for the active poster.
 */
export const workCardWith = {
  workAuthors: {
    where: inArray(workAuthors.role, ["author", "co_author"]),
    with: { author: { columns: { name: true } } },
    orderBy: [asc(workAuthors.sortOrder), asc(workAuthors.authorId)] as SQL[],
  },
  editions: {
    columns: {
      id: true,
      title: true,
      coverS3Key: true,
      thumbnailS3Key: true,
      publicationYear: true,
      language: true,
    },
    orderBy: [asc(editions.createdAt), asc(editions.id)] as SQL[],
    limit: 1,
    with: {
      instances: { columns: { id: true } },
    },
  },
  media: {
    where: sql`${media.type} = 'poster' and ${media.isActive}`,
    orderBy: asc(media.id),
    limit: 1,
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

/**
 * Root extras a book card query spreads in (SLN-449): the open reading's
 * state and percent, which `cardReadingOf` turns into the card's field. The
 * relational query cannot reach a reading by status, so these are
 * correlated subqueries over the work: a function of its (aliased) columns,
 * so a nested `work` relation can take it too.
 */
export const workCardExtras = (work: { id: AnyColumn }) => ({
  readingState: readingStateSql(work.id).as("reading_state"),
  readingPercent: sql<number | null>`${openReadingPercentSql(work.id)}`
    .mapWith(Number)
    .as("reading_percent"),
});

/**
 * A list page's per-book reading (the author's books, a series' volumes):
 * the card's open reading, the finished reads and the last time read.
 */
export const workReadingExtras = (work: { id: AnyColumn }) => ({
  ...workCardExtras(work),
  timesRead: readCountSql(work.id).as("times_read"),
  lastReadAt: sql<string | null>`${lastReadAtSql(work.id)}::text`.as(
    "last_read_at",
  ),
});
