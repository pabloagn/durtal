import { FadeImage } from "@/components/shared/fade-image";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { coverToneStyle, mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import { mediaUrl } from "@/lib/s3/media-url";

export interface FilmPosterImage {
  s3Key: string;
  thumbnailS3Key?: string | null;
  cropX?: number | null;
  cropY?: number | null;
  cropZoom?: number | null;
  /** The poster's main color: the frame shows it while the image loads */
  tone?: string | null;
}

/** The URL of a stored image's display (or thumbnail) size */
export function filmImageUrl(
  image: { s3Key: string; thumbnailS3Key?: string | null } | null | undefined,
  { thumbnail = true }: { thumbnail?: boolean } = {},
) {
  const key = thumbnail ? (image?.thumbnailS3Key ?? image?.s3Key) : image?.s3Key;
  return key ? mediaUrl(key) : null;
}

/**
 * A film's poster in its 2:3 frame, cropped as it was framed, over its own
 * tone while it loads; the title's letter when it has no poster
 * (`CoverLetter`), as every blank cover shows. The parent sets the width.
 */
export function FilmPoster({
  image,
  title,
  alt = "",
  thumbnail = true,
  className = "",
  eager = false,
}: {
  image: FilmPosterImage | null | undefined;
  title: string;
  alt?: string;
  thumbnail?: boolean;
  className?: string;
  /** The page's main image: load it at once */
  eager?: boolean;
}) {
  const src = filmImageUrl(image, { thumbnail });
  return (
    <div
      className={`@container card-cover ${className}`}
      style={src ? coverToneStyle(image?.tone) : undefined}
    >
      {src ? (
        <FadeImage
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          fallback={<span className={`absolute inset-0 ${COVER_BLANK}`}><CoverLetter title={title} /></span>}
          className="protected-image absolute inset-0 h-full w-full object-cover"
          style={mediaImageStyle(mediaCrop(image ?? {}))}
        />
      ) : (
        <span className={`absolute inset-0 ${COVER_BLANK}`}>
          <CoverLetter title={title} />
        </span>
      )}
    </div>
  );
}
