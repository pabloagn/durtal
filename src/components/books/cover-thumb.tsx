import type { CSSProperties } from "react";
import { FadeImage } from "@/components/shared/fade-image";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";

/**
 * A small cover in its 2:3 box, for rows, pickers and queues: the image, or
 * the title's letter when there is none or it fails to load, as every card
 * shows (SLN-1066). A row with no cover keeps the box, so its title starts on
 * the same edge as its neighbours'. The class sets the width (`w-10`), or both sides (`h-10 w-7`).
 */
export function CoverThumb({
  src,
  title,
  alt = "",
  className = "w-10",
  contain = false,
  style,
}: {
  src: string | null | undefined;
  title: string;
  alt?: string;
  className?: string;
  /** Whole, not cropped to the box: a perfume's bottle */
  contain?: boolean;
  /** The poster's crop (`mediaImageStyle`) */
  style?: CSSProperties;
}) {
  return (
    <span className={`${COVER_BLANK} relative aspect-[2/3] shrink-0 overflow-hidden rounded-sm bg-bg-tertiary ${className}`}>
      {src ? (
        <FadeImage
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          style={style}
          className={`protected-image absolute inset-0 h-full w-full ${contain ? "object-contain" : "object-cover"}`}
          fallback={<CoverLetter title={title} />}
        />
      ) : (
        <CoverLetter title={title} />
      )}
    </span>
  );
}
