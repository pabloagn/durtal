import sharp from "sharp";
import { EBOOK_COVER_WIDTHS, type EbookCoverWidth } from "../keys";
import type { CoverRef } from "./inspect/types";
import { inspectionBudget } from "./budget";
import { rasterHeader } from "./image-header";
import { MiB, UPLOAD_LIMITS } from "../upload/limits";
import { requireImageBudget } from "../upload/inspection-policy";

/*
 * An e-book's covers (SLN-494): its cover image (or a PDF's first page) as
 * WebP at 240, 400 and 800 px wide, quality 82, with no metadata. A cover
 * smaller than a width is never enlarged. No cover found: none is written,
 * and the library shows its placeholder.
 */

const QUALITY = 82;

export type Covers = Record<`cover-${EbookCoverWidth}.webp`, Uint8Array>;

/*
 * Native bytes one cover reserves. The working surfaces are 16 bytes a pixel:
 * the decoded image and its rotated or resampled copy, at up to 8 bytes a
 * pixel each (16-bit RGBA). Measured peaks of this pipeline in sharp, upright
 * and with EXIF orientation 6, were under 8 bytes a pixel for 8-bit JPEG and
 * PNG and 12 for a 16-bit RGBA PNG. At 32, a 1600 x 2400 cover, a common
 * size, did not fit and failed the whole upload (SLN-1388).
 */
const workingBytes = (width: number, height: number, input: number) => input + width * height * 16 + 8 * MiB;
const outputBytes = (size: { width: number; height: number }) => size.width * size.height * 16 + MiB;

function outputSize(width: number, imageWidth: number, imageHeight: number): { width: number; height: number } {
  const scale = Math.min(1, width / imageWidth, UPLOAD_LIMITS.coverHeight / imageHeight);
  return { width: Math.max(1, Math.ceil(imageWidth * scale)), height: Math.max(1, Math.ceil(imageHeight * scale)) };
}

/**
 * Why a cover cannot be made within the attempt's native budget, or null:
 * the budget's own rule applied to everything the cover will reserve, its
 * retained input, working surfaces and each width's output envelope (which
 * bounds the retained outputs too) in either orientation.
 */
export function coverTooLarge(width: number, height: number, input: number, reserved: number): string | null {
  if (width < 1 || height < 1) return "The cover has no width or height";
  const outputs = EBOOK_COVER_WIDTHS.reduce((sum, at) =>
    sum + Math.max(outputBytes(outputSize(at, width, height)), outputBytes(outputSize(at, height, width))), 0);
  try {
    requireImageBudget({ width, height, allocatedNativeBytes: reserved, requestedNativeBytes: input + workingBytes(width, height, input) + outputs });
    return null;
  } catch {
    return `The cover is too large to make covers from (${width} x ${height})`;
  }
}

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
      // A cover too large for the attempt's native budget is left out with its
      // reason, before any reservation: the book is still added (SLN-1388)
      const tooLarge = coverTooLarge(dimensions.width, dimensions.height, image.length, budget.snapshot().nativeBytes);
      if (tooLarge) return { covers: null, reason: tooLarge };
      // One sequential pipeline, no cache, conservative compressed copies,
      // full-resolution working surfaces and encoder workspace reserved first.
      budget.imageAllocation(1, 1, image.length); // retained compressed input; no GC refund
      const release = budget.imageAllocation(dimensions.width, dimensions.height, workingBytes(dimensions.width, dimensions.height, image.length));
      sharp.cache(false); sharp.concurrency(1);
      try {
        const entries: [string, Uint8Array][] = [];
        for (const width of EBOOK_COVER_WIDTHS) {
          const pipeline = sharp(image, { failOn: "error", limitInputPixels: UPLOAD_LIMITS.imagePixels, animated: false, pages: 1 });
          try {
            const actual = await pipeline.metadata();
            // Only the header is read so far: a mismatch is a damaged cover, not a breach
            if (actual.width !== dimensions.width || actual.height !== dimensions.height)
              throw new Error("its size differs from its header");
            if (actual.pages && actual.pages !== 1) throw new Error("it has more than one page");
            const swap = actual.orientation !== undefined && actual.orientation >= 5 && actual.orientation <= 8;
            const orientedWidth = swap ? dimensions.height : dimensions.width;
            const orientedHeight = swap ? dimensions.width : dimensions.height;
            const output = outputSize(width, orientedWidth, orientedHeight);
            // WebP output is bounded before calling the native encoder; its
            // compressed result and retained copy both fit this reservation.
            const envelope = outputBytes(output);
            const releaseOutput = budget.imageAllocation(output.width, output.height, envelope);
            try {
              const webp = await pipeline.rotate().resize({ width, height: UPLOAD_LIMITS.coverHeight, fit: "inside", withoutEnlargement: true })
                .webp({ quality: QUALITY }).toBuffer();
              if (webp.length > envelope) budget.reject("Native encoded cover exceeds its reserved output envelope");
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
