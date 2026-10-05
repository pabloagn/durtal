import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CardRating, CardReading, CardStatus } from "@/components/books/card-status";
import { FadeImage } from "@/components/shared/fade-image";
import type { CardReadingValue } from "@/lib/reading/card";
import { languageName } from "@/lib/utils/language";
import { coverToneStyle } from "@/lib/utils/media-style";

/**
 * The anatomy every work card shares, whatever its collection (SLN-478): the
 * picture's frame, then `CardHeading` (two title lines, one subtitle line),
 * then `WorkCardInfo`. `BookCard` is the model; the film, perfume and
 * painting cards and the home page's tiles follow it, so cards of different
 * collections in one row line up: titles, subtitles and info rows at the
 * same heights.
 */
export const WORK_CARD =
  "@container group relative rounded-sm border border-glass-border bg-bg-secondary card-interactive";

/** The text under a work card's picture */
export const WORK_CARD_BODY = "p-3.5";

/**
 * A work card's info row: the status (or the open reading) on the left; the
 * language, the rating and the year on the right. The status keeps the row:
 * the rating shows from 160px of card width, the language from 200px, the
 * year from 160px (220px beside a rating). The row keeps its height when it
 * is empty.
 */
export function WorkCardInfo({
  status,
  priority,
  copies,
  reading,
  language,
  rating,
  year,
}: {
  status?: string | null;
  priority?: string | null;
  /** Copies, bottles or objects held: the status tooltip names them */
  copies?: number;
  /** An open reading: it takes the status slot ("Reading 44%") */
  reading?: CardReadingValue;
  language?: string | null;
  rating?: number | null;
  /** The year, or the collection's own date: a release, a creation */
  year?: ReactNode;
}) {
  return (
    <div className="mt-2.5 flex h-5 items-center gap-2">
      {reading ? (
        <CardReading reading={reading} status={status} priority={priority} copies={copies} />
      ) : (
        <CardStatus status={status} priority={priority} copies={copies} />
      )}
      {language && language !== "en" && (
        <span className="hidden @[200px]:contents">
          {/* A long name ("Norwegian Bokmål") shrinks first and cuts off;
              the status never does */}
          <Badge variant="blue" className="min-w-0 shrink-[999]">
            <span className="truncate">{languageName(language)}</span>
          </Badge>
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden @[160px]:contents">
          <CardRating rating={rating} />
        </span>
        {year != null && year !== "" && (
          <span
            className={`hidden font-mono text-micro text-fg-secondary ${rating ? "@[220px]:inline" : "@[160px]:inline"}`}
          >
            {year}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * A work's picture in the book cover's 2:3 frame, for rows that mix
 * collections: the whole picture, contained and centered, so a bottle or a
 * landscape painting is never cropped. Where it does not fill the frame, a
 * blurred, dimmed copy of it fills the bands, like frosted glass behind it.
 * Without a picture, the collection's stand-in fills the frame.
 */
export function WorkCardArt({
  src,
  tone,
  fallback,
}: {
  src: string | null | undefined;
  /** The picture's main color: the frame shows it while the picture loads */
  tone?: string | null;
  /** A flacon, a monogram: absolutely placed, it fills the frame */
  fallback: ReactNode;
}) {
  return (
    <div className="cover-shadow">
      <div
        className="relative aspect-[2/3] overflow-hidden bg-bg-tertiary"
        style={src ? coverToneStyle(tone) : undefined}
      >
        {src ? (
          <>
            <FadeImage
              src={src}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="protected-image absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-xl brightness-50 saturate-[0.8]"
            />
            <FadeImage
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="protected-image absolute inset-0 h-full w-full object-contain group-hover:scale-[1.02]"
            />
          </>
        ) : (
          fallback
        )}
      </div>
    </div>
  );
}
