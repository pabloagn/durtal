import Link from "next/link";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { parseEbookLibraryParams } from "@/lib/ebooks/library-params";
import {
  getEbooksPage,
  getEbookLibraryCounts,
  getContinueReading,
} from "@/lib/ebooks/library-queries";
import {
  ebookPageCoverBase,
  ebookCoverImage,
} from "@/lib/ebooks/library-cover";
import { ebookCardData } from "@/lib/ebooks/library-view";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import {
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { ContinueReading } from "@/components/ebooks/continue-reading";
import { EbooksView } from "./ebooks-view";
import { EbooksMenu } from "./ebooks-menu";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
export const metadata = { title: "eBooks" };
const requestTime = cache(() => Date.now());
function since(date: string | Date, now: number) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(date).getTime()) / 60000),
  );
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export default async function EbooksPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const search = await searchParams;
  const params = parseEbookLibraryParams(search);
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  const [books, counts, recent] = await Promise.all([
    getEbooksPage(params),
    getEbookLibraryCounts(params),
    params.state === "excluded"
      ? Promise.resolve([])
      : getContinueReading(isDeviceId(device) ? device : null),
  ]);
  if (params.page > lastPage(counts.total, params.perPage))
    redirect(
      pageHref("/ebooks", search, lastPage(counts.total, params.perPage)),
    );
  const base = ebookPageCoverBase();
  const now = requestTime();
  const continuation = recent.flatMap(({ ebook, descriptor, bookTitle, bookAuthors }) =>
    descriptor.anchor && descriptor.savedPercent !== null
      ? [
          {
            book: {
              ...ebookCardData(ebook, ebookCoverImage(ebook, base)),
              title: bookTitle ?? ebook.title,
              authors: bookAuthors?.length ? bookAuthors : ebook.authors,
            },
            href: descriptor.href,
            // The book's one place, as its card and book page count it (SLN-683)
            savedPercent: descriptor.bookPercent ?? descriptor.savedPercent,
            projection: descriptor.projection === "pending-reanchor",
            chapter: (descriptor.bookPlace ?? descriptor.anchor).chapter,
            when: since((descriptor.bookPlace ?? descriptor.anchor).clientUpdatedAt, now),
          },
        ]
      : [],
  );
  return (
    <>
      <PageHeader
        title="eBooks"
        actions={
          // On the cap-height center of the title's line
          <CapAlignedControls height={32} coarseHeight={44} className="type-page-title">
            <EbooksMenu />
          </CapAlignedControls>
        }
      />
      <nav
        aria-label="eBook states"
        className="-mt-5 mb-8 flex flex-wrap gap-x-2 gap-y-1 text-sm text-fg-secondary"
      >
        <Link
          href="/ebooks"
          className="touch-hit"
          aria-current={
            params.state === "active" && params.needsReview === null
              ? "page"
              : undefined
          }
        >
          {counts.active.toLocaleString("en")} eBooks
        </Link>
        <span aria-hidden>·</span>
        <Link href="/ebooks?review=yes" className="touch-hit">
          {counts.review.toLocaleString("en")} to review
        </Link>
        <span aria-hidden>·</span>
        <Link
          href="/ebooks?state=excluded"
          className="touch-hit"
          aria-current={params.state === "excluded" ? "page" : undefined}
        >
          {counts.excluded.toLocaleString("en")} set aside
        </Link>
      </nav>
      <ContinueReading books={continuation} />
      <EbooksView
        books={books.map((ebook) =>
          ebookCardData(ebook, ebookCoverImage(ebook, base)),
        )}
        counts={counts}
        page={params.page}
        perPage={params.perPage}
      />
    </>
  );
}
