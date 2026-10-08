import sharp from "sharp";
import { EBOOK_COVER_WIDTHS, type EbookCoverWidth } from "../keys";
import type { CoverRef } from "./inspect/types";

/*
 * An e-book's covers (SLN-494): its cover image (or a PDF's first page) as
 * WebP at 240, 400 and 800 px wide, quality 82, with no metadata. A cover
 * smaller than a width is never enlarged. No cover found: none is written,
 * and the library shows its placeholder.
 */

const QUALITY = 82;

export type Covers = Record<`cover-${EbookCoverWidth}.webp`, Uint8Array>;

export async function makeCovers(cover: CoverRef | null): Promise<{ covers: Covers | null; reason: string | null }> {
  if (!cover) return { covers: null, reason: "No cover in the file" };
  let image: Uint8Array;
  try {
    image = await cover.load();
  } catch (error) {
    return { covers: null, reason: `The cover cannot be read: ${(error as Error).message}` };
  }
  try {
    const entries = await Promise.all(
      EBOOK_COVER_WIDTHS.map(async (width) => {
        const webp = await sharp(image, { failOn: "error", limitInputPixels: 100_000_000 })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: QUALITY })
          .toBuffer();
        return [`cover-${width}.webp`, new Uint8Array(webp)] as const;
      }),
    );
    return { covers: Object.fromEntries(entries) as Covers, reason: null };
  } catch (error) {
    return { covers: null, reason: `The cover image is damaged: ${(error as Error).message}` };
  }
}
