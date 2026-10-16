import {
  editionImage,
  type EditionImage,
  type EditionImageKeys,
  type PosterImage,
} from "@/lib/utils/edition-image";
import { mediaImageStyle } from "@/lib/utils/media-style";
import { FadeImage } from "@/components/shared/fade-image";
import { mediaUrl } from "@/lib/s3/media-url";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";

const SIZES = { md: "h-24 w-16", sm: "h-12 w-8" } as const;

/**
 * An edition image chosen by `editionImage` (64×96, or 32×48 when small).
 * Posters keep their crop and adjustments. Without an image the box shows
 * the title's letter, as every blank cover does, and names "no cover" to a
 * screen reader.
 */
export function EditionImageBox({
  image,
  title,
  size = "md",
}: {
  image: EditionImage | null;
  title: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div className={`${SIZES[size]} shrink-0 overflow-hidden bg-bg-tertiary`}>
      {image ? (
        <FadeImage
          src={mediaUrl(image.key, { width: 240 })}
          alt={
            image.source === "edition" ? `${title} cover` : `${title} poster`
          }
          data-tooltip={
            image.source === "poster"
              ? "Book poster: this edition has no cover"
              : undefined
          }
          loading="lazy"
          fallback={
            <span className={`h-full ${COVER_BLANK}`}>
              <CoverLetter title={title} />
            </span>
          }
          className="h-full w-full object-cover"
          style={mediaImageStyle(image.crop)}
        />
      ) : (
        // The title's letter, as on every other blank cover
        <span role="img" aria-label={`${title}: no cover`} className={`h-full ${COVER_BLANK}`}>
          <CoverLetter title={title} />
        </span>
      )}
    </div>
  );
}

/** The edition's cover, else the book poster, else the title's letter */
export function EditionCover({
  edition,
  poster,
  title,
  size,
}: {
  edition: EditionImageKeys;
  poster?: PosterImage | null;
  title: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <EditionImageBox
      image={editionImage(edition, poster)}
      title={title}
      size={size}
    />
  );
}
