import { FadeImage } from "@/components/shared/fade-image";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { coverToneStyle } from "@/lib/utils/media-style";
import { paintingRatio } from "@/lib/catalogue/painting-labels";
import { mediaUrl } from "@/lib/s3/media-url";

export interface PaintingImageData {
  s3Key: string;
  thumbnailS3Key?: string | null;
  width?: number | null;
  height?: number | null;
  /** The image's main color: the frame shows it while the image loads */
  tone?: string | null;
}

/** The URL of a stored image's display (or thumbnail) size */
export function paintingImageUrl(
  image: { s3Key: string; thumbnailS3Key?: string | null } | null | undefined,
  { thumbnail = true }: { thumbnail?: boolean } = {},
) {
  const key = thumbnail ? (image?.thumbnailS3Key ?? image?.s3Key) : image?.s3Key;
  return key ? mediaUrl(key) : null;
}

/**
 * A painting's picture, whole and never cropped, over a tone of its own
 * color while it loads; the title's letter when it has no picture
 * (`CoverLetter`), as every blank cover shows.
 *
 * - `frame="card"`: a fixed 4:5 frame, so every card of a grid has one
 *   height; a wide or tall painting sits inside it with margins.
 * - `frame="native"`: the frame takes the painting's own proportions (the
 *   image's, else the primary object's size in centimetres).
 */
export function PaintingImage({
  image,
  title,
  size,
  frame = "card",
  alt = "",
  thumbnail = true,
  className = "",
  eager = false,
}: {
  image: PaintingImageData | null | undefined;
  title: string;
  /** The primary object's size, for the proportions of a painting without a picture */
  size?: { widthCm: number | null; heightCm: number | null } | null;
  frame?: "card" | "native";
  alt?: string;
  thumbnail?: boolean;
  className?: string;
  /** The page's main image: load it at once */
  eager?: boolean;
}) {
  const src = paintingImageUrl(image, { thumbnail });
  return (
    <div
      className={`@container relative overflow-hidden bg-bg-tertiary ${frame === "card" ? "aspect-[4/5]" : ""} ${className}`}
      style={{
        ...(frame === "native" ? { aspectRatio: paintingRatio(image, size) } : {}),
        ...(src ? coverToneStyle(image?.tone) : {}),
      }}
    >
      {src ? (
        <FadeImage
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="protected-image absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <span className={`absolute inset-0 ${COVER_BLANK}`}>
          <CoverLetter title={title} />
        </span>
      )}
    </div>
  );
}
