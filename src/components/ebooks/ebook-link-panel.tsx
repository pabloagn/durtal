import Link from "next/link";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import type { ReviewQueueRow } from "@/lib/ebooks/review-queue/types";
import { isEbookFileDownloadable, isEbookFileNativeReadable } from "@/lib/ebooks/conditions";
import { ebookCoverEvidence } from "@/lib/ebooks/cover-evidence";
import { getLinkedBook, linkedEditionLine, type LinkedBook } from "@/lib/ebooks/linked-book";
import { withMediaWidth } from "@/lib/s3/media-url";
import { coverToneStyle, mediaImageStyle } from "@/lib/utils/media-style";
import { CardHeading } from "@/components/shared/card-heading";
import { FadeImage } from "@/components/shared/fade-image";
import { WorkCardInfo } from "@/components/shared/work-card";
import { buttonClass } from "@/components/ui/button";
import { COVER_CORNER } from "@/components/books/cover-chip";
import { COVER_BLANK, CoverLetter } from "@/components/books/cover-letter";
import { HuntBadge } from "@/components/books/hunt-badge";
import { PoisonBadge } from "@/components/books/poison-badge";
import { EbookLinkControls } from "./ebook-link-controls";
import { LinkedBookMenu } from "./linked-book-menu";

/** The card's frame: a cover beside the book's names, its edition, its copy and its actions (SLN-666).
 * Below 340px of card the cover stays beside the title only, and the rest takes the card's width. */
const CARD = "grid max-w-xl grid-cols-[5rem_minmax(0,1fr)] gap-x-4 rounded-sm border border-glass-border bg-bg-secondary p-4 @[340px]:grid-cols-[6rem_minmax(0,1fr)] @[480px]:grid-cols-[7rem_minmax(0,1fr)]";

function CoverFrame({ book, title }: { book: LinkedBook | null; title: string }) {
  const blank = <div className={`${COVER_BLANK} h-full`}><CoverLetter title={title} /></div>;
  return <div className="cover-shadow">
    <div className="relative aspect-[2/3] overflow-hidden rounded-sm bg-bg-tertiary" style={coverToneStyle(book?.coverTone)}>
      {book?.coverUrl ? <FadeImage src={withMediaWidth(book.coverUrl, 240)}
        srcSet={`${withMediaWidth(book.coverUrl, 240)} 240w, ${withMediaWidth(book.coverUrl, 400)} 400w`} sizes="112px"
        alt="" loading="lazy" decoding="async" className="protected-image cover-image" style={mediaImageStyle(book.coverCrop)} fallback={blank} />
        : blank}
      {book && (book.isRare || book.isPoison) && <div className={COVER_CORNER.bottomLeft}>
        <HuntBadge isRare={book.isRare} huntAssessedOn={book.huntAssessedOn} cover />
        <PoisonBadge isPoison={book.isPoison} cover />
      </div>}
    </div>
  </div>;
}

/** `book`: the linked book when the page already read it (SLN-683) */
export async function EbookLinkPanel({ ebook, book: read }: { ebook: EbookDetail; book?: LinkedBook | null }) {
  const book = read !== undefined ? read
    : ebook.matchState === "linked" && ebook.instanceId ? await getLinkedBook(ebook.instanceId) : null;
  if (book) {
    const href = `/library/${book.slug ?? book.workId}`;
    const edition = linkedEditionLine(book);
    return <div className="@container">
      <article className={`${CARD} @[340px]:grid-rows-[auto_1fr]`} data-ebook-linked-book="">
        <Link href={href} tabIndex={-1} aria-label={book.title} className="group self-start @[340px]:row-span-2">
          <CoverFrame book={book} title={book.title} />
        </Link>
        <CardHeading
          title={<Link href={href} className="transition-colors hover:text-accent-primary">{book.title}</Link>}
          subtitle={book.authors.length ? book.authors.join(", ") : "Unknown author"}
          action={<LinkedBookMenu ebookId={ebook.id} />}
        />
        <div className="col-span-2 flex flex-col @[340px]:col-span-1 @[340px]:col-start-2">
          {edition && <p className="mt-2 text-xs text-fg-secondary [overflow-wrap:anywhere]">{edition}</p>}
          <p className="mt-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
            {book.location ? `eBook copy in ${book.location}` : "eBook copy"}
          </p>
          <div className="@container">
            <WorkCardInfo status={book.status} reading={book.reading} rating={book.rating} />
          </div>
          <div className="mt-auto pt-3">
            <Link href={href} className={buttonClass("secondary", "sm")}>Open book</Link>
          </div>
        </div>
      </article>
    </div>;
  }
  // This is the chooser projection, as in the approved reverse chooser:
  // it supplies actual identity, metadata, capability and stamp. Candidate
  // proposals and duplicate descriptions are not loaded or displayed here.
  const row: ReviewQueueRow = {
    id: ebook.id, title: ebook.title, subtitle: ebook.subtitle, authors: ebook.authors,
    language: ebook.language, series: ebook.series, seriesIndex: ebook.seriesIndex,
    publisher: ebook.publisher, year: ebook.publicationYear, isbns: ebook.isbns,
    identifiers: ebook.identifiers, state: ebook.matchState, tier: ebook.matchTier,
    stamp: ebook.reviewStamp, hasCover: !!ebookCoverEvidence(ebook),
    candidates: [], duplicate: null,
    work: ebook.workId && ebook.workTitle && ebook.workSlug && ebook.workStatus
      ? { id: ebook.workId, title: ebook.workTitle, slug: ebook.workSlug, status: ebook.workStatus } : null,
    files: ebook.files.map((file) => ({ id: file.id, format: file.format,
      sizeBytes: file.sizeBytes, status: file.status, drm: file.drm,
      availability: isEbookFileNativeReadable(file) ? "native" : isEbookFileDownloadable(file) ? "download" : "blocked",
      checksum: file.sha256.slice(0, 12), sourcePath: file.sourcePath })),
  };
  const reason = ebook.exclusionReason === "duplicate" ? "duplicate"
    : ebook.exclusionReason === "not_a_book" ? "not a book" : ebook.exclusionReason === "other" ? "other" : null;
  const [title, note] = ebook.matchState === "standalone"
    ? ["Kept as an eBook", "It has no book in the library. Choose one to link it."]
    : ebook.matchState === "excluded"
      ? [`Set aside${reason ? `: ${reason}` : ""}`, "Restore it to review to link it to a book."]
      : ebook.matchState === "linked"
        ? ["Its book is missing", "The copy it was linked to is gone. Reload, or link it again from the review queue."]
        : ["Not linked to a book yet", "Choose its book, or create one, so its reading and quotes join the book."];
  return <div className="@container">
    <article className={CARD} data-ebook-linked-book="" data-unlinked="">
      <div className="self-start"><CoverFrame book={null} title={ebook.title} /></div>
      <CardHeading title={title} subtitle={note} subtitleLines={2} />
      {/* The decisions take the card's whole width under the placeholder: up to five buttons */}
      <div className="col-span-2"><EbookLinkControls row={row} /></div>
    </article>
  </div>;
}
