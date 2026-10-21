import { cropRegion, rotatedFrame, type AppliedCrop } from "./crop";

/** The same cover-frame geometry as the shared image editor. Original bytes
 * remain unchanged; only the resulting display image is published. */
export async function frameImage(
  bytes: Buffer,
  crop: AppliedCrop,
  aspect = 2 / 3,
) {
  const sharp = (await import("sharp")).default;
  const options = { failOn: "error" as const, limitInputPixels: 100_000_000 };
  const upright = await sharp(bytes, options)
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  const turned = !!crop.turn || !!crop.straighten;
  let image = upright.data,
    width = upright.info.width,
    height = upright.info.height;
  if (turned) {
    const spun = await sharp(image, options)
      .rotate((crop.turn ?? 0) + (crop.straighten ?? 0), {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const frame = rotatedFrame(
      width,
      height,
      crop.turn ?? 0,
      crop.straighten ?? 0,
    );
    const inset = crop.straighten ? 2 : 0;
    width = Math.max(
      1,
      Math.min(spun.info.width, Math.floor(frame.width) - inset),
    );
    height = Math.max(
      1,
      Math.min(spun.info.height, Math.floor(frame.height) - inset),
    );
    image = await sharp(spun.data, options)
      .extract({
        left: Math.floor((spun.info.width - width) / 2),
        top: Math.floor((spun.info.height - height) / 2),
        width,
        height,
      })
      .png()
      .toBuffer();
  }
  return sharp(image, options)
    .extract(cropRegion(width, height, aspect, crop))
    .png()
    .toBuffer();
}
