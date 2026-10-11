import Link from "next/link";
import type { EbookDetail } from "@/lib/ebooks/library-queries";
import type { ReviewQueueRow } from "@/lib/ebooks/review-queue/types";
import { isEbookFileDownloadable, isEbookFileNativeReadable } from "@/lib/ebooks/conditions";
import { ebookCoverEvidence } from "@/lib/ebooks/cover-evidence";
import { EbookLinkControls } from "./ebook-link-controls";

export function EbookLinkPanel({ ebook }: { ebook: EbookDetail }) {
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
  return <div>
    {ebook.matchState === "linked" ? <p className="text-sm">
      Your copy of {ebook.workSlug ? <Link href={`/library/${ebook.workSlug}`} className="text-accent-primary">
        {ebook.workTitle ?? ebook.title}
      </Link> : (ebook.workTitle ?? ebook.title)}
      {[ebook.editionPublisher, ebook.editionYear].filter(Boolean).length
        ? ` (${[ebook.editionPublisher, ebook.editionYear].filter(Boolean).join(", ")})` : ""}.
    </p> : <p className="text-sm text-fg-secondary">
      {ebook.matchState === "standalone" ? "Kept as an eBook."
        : ebook.matchState === "excluded" ? `Set aside${reason ? `: ${reason}` : ""}.` : "Not linked yet."}
    </p>}
    <EbookLinkControls row={row} />
  </div>;
}
