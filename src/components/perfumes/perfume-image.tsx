import { FadeImage } from "@/components/shared/fade-image";
import { Flacon } from "@/components/shared/no-photo";
import { coverToneStyle } from "@/lib/utils/media-style";

/** The URL of a stored image's display (or thumbnail) size */
export function imageUrl(
  image: { s3Key: string; thumbnailS3Key?: string | null } | null | undefined,
  { thumbnail = true }: { thumbnail?: boolean } = {},
) {
  const key = thumbnail ? (image?.thumbnailS3Key ?? image?.s3Key) : image?.s3Key;
  return key ? `/api/s3/read?key=${encodeURIComponent(key)}` : null;
}

/**
 * A perfume's picture in its square frame: the whole bottle, never cropped,
 * over a tone of its own color (a cut-out bottle sits on it), or a flacon
 * drawn from its name when it has no picture. The parent sets the size.
 */
export function PerfumeImage({
  image,
  title,
  alt = "",
  thumbnail = true,
  small = false,
  className = "",
  eager = false,
}: {
  image: { s3Key: string; thumbnailS3Key?: string | null; tone?: string | null } | null | undefined;
  title: string;
  alt?: string;
  thumbnail?: boolean;
  /** A small thumbnail: the stand-in flacon carries no lettering */
  small?: boolean;
  className?: string;
  /** The page's main image: load it at once */
  eager?: boolean;
}) {
  const src = imageUrl(image, { thumbnail });
  return (
    <div
      className={`relative aspect-square overflow-hidden bg-bg-tertiary ${className}`}
      style={src ? coverToneStyle(image?.tone) : undefined}
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
        <Flacon name={title} initials={!small} />
      )}
    </div>
  );
}
