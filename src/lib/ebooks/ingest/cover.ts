import sharp from "sharp";
import { EBOOK_COVER_WIDTHS, type EbookCoverWidth } from "../keys";
import type { CoverRef } from "./inspect/types";
import { inspectionBudget } from "./budget";
import { rasterHeader } from "./image-header";
import { MiB, UPLOAD_LIMITS } from "../upload/limits";

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
    const budget = inspectionBudget();
    if (budget) {
      let dimensions: ReturnType<typeof rasterHeader>;
      try { dimensions = rasterHeader(image); }
      catch (error) { return { covers: null, reason: (error as Error).message }; } // no native decode for other codecs
      // One sequential pipeline, no cache, conservative compressed copies,
      // full-resolution working surfaces and encoder workspace reserved first.
      budget.imageAllocation(1, 1, image.length); // retained compressed input; no GC refund
      const release = budget.imageAllocation(dimensions.width, dimensions.height,
        image.length + dimensions.width * dimensions.height * 32 + 8 * MiB);
      sharp.cache(false); sharp.concurrency(1);
      try {
        const entries: [string, Uint8Array][] = [];
        for (const width of EBOOK_COVER_WIDTHS) {
          const pipeline = sharp(image, { failOn: "error", limitInputPixels: UPLOAD_LIMITS.imagePixels, animated: false, pages: 1 });
          try {
            const actual = await pipeline.metadata();
            if (actual.width !== dimensions.width || actual.height !== dimensions.height || actual.pages && actual.pages !== 1)
              budget.reject("Native cover dimensions differ from its bounded header");
            const swap = actual.orientation !== undefined && actual.orientation >= 5 && actual.orientation <= 8;
            const orientedWidth = swap ? dimensions.height : dimensions.width;
            const orientedHeight = swap ? dimensions.width : dimensions.height;
            const scale = Math.min(1, width / orientedWidth, UPLOAD_LIMITS.coverHeight / orientedHeight);
            const outputHeight = Math.max(1, Math.ceil(orientedHeight * scale));
            const outputWidth = Math.max(1, Math.ceil(orientedWidth * scale));
            // WebP output is bounded before calling the native encoder; its
            // compressed result and retained copy both fit this reservation.
            const releaseOutput = budget.imageAllocation(outputWidth, outputHeight, outputWidth * outputHeight * 16 + MiB);
            try {
              const webp = await pipeline.rotate().resize({ width, height: UPLOAD_LIMITS.coverHeight, fit: "inside", withoutEnlargement: true })
                .webp({ quality: QUALITY }).toBuffer();
              if (webp.length > outputWidth * outputHeight * 16 + MiB) budget.reject("Native encoded cover exceeds its reserved output envelope");
              budget.decodedChunk(`cover:${width}`, webp.length);
              budget.imageAllocation(1, 1, webp.length); // retained output survives this pipeline
              entries.push([`cover-${width}.webp`, webp]);
            } finally { releaseOutput(); }
          } finally { pipeline.destroy(); }
        }
        return { covers: Object.fromEntries(entries) as Covers, reason: null };
      } finally { release(); }
    }
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
