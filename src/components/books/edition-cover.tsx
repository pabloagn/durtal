import {
  editionImage,
  type EditionImage,
  type EditionImageKeys,
  type PosterImage,
} from "@/lib/utils/edition-image";
import { mediaImageStyle } from "@/lib/utils/media-style";

const SIZES = { md: "h-24 w-16", sm: "h-12 w-8" } as const;

/**
 * An edition image chosen by `editionImage` (64×96, or 32×48 when small).
 * Posters keep their crop and adjustments. Without an image the box says
 * "No cover" (small boxes only carry it as a label).
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
    <div className={`${SIZES[size]} shrink-0 overflow-hidden bg-bg-secondary`}>
      {image ? (
        <img
          src={`/api/s3/read?key=${encodeURIComponent(image.key)}`}
          alt={
            image.source === "edition" ? `${title} cover` : `${title} poster`
          }
          title={
            image.source === "poster"
              ? "Book poster: this edition has no cover"
              : undefined
          }
          loading="lazy"
          className="h-full w-full object-cover"
          style={mediaImageStyle(image.crop)}
        />
      ) : size === "md" ? (
        <span className="flex h-full items-center justify-center text-center text-micro text-fg-secondary">
          No cover
        </span>
      ) : (
        <span role="img" aria-label={`${title}: no cover`} className="block h-full" />
      )}
    </div>
  );
}

/** The edition's cover, else the book poster, else "No cover" */
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
