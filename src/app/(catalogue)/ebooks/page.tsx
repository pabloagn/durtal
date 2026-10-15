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
import { ListPendingProvider } from "@/components/shared/list-pending";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { buttonClass } from "@/components/ui/button";
import { Upload } from "lucide-react";
export const metadata = { title: "eBooks" };
const requestTime = cache(() => Date.now());
/** The state counts are text commands; the one in view reads as plain text */
const STATE_LINK = "text-command aria-[current=page]:text-fg-primary aria-[current=page]:no-underline";
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
            <Link href="/ebooks/upload" className={`${buttonClass("secondary")} whitespace-nowrap`}>
              <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
              Upload eBooks
            </Link>
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
          className={STATE_LINK}
          aria-current={
            params.state === "active" && params.needsReview === null
              ? "page"
              : undefined
          }
        >
          {counts.active.toLocaleString("en")} eBooks
        </Link>
        <span aria-hidden>·</span>
        <Link href="/ebooks/review" className={STATE_LINK}>
          {counts.review.toLocaleString("en")} to review
        </Link>
        <span aria-hidden>·</span>
        <Link
          href="/ebooks?state=excluded"
          className={STATE_LINK}
          aria-current={params.state === "excluded" ? "page" : undefined}
        >
          {counts.excluded.toLocaleString("en")} set aside
        </Link>
      </nav>
      {params.needsReview === true && (
        <p className="-mt-4 mb-8 text-sm text-fg-secondary">
          These eBooks wait for a decision.{" "}
          <Link href="/ebooks/review" className="text-accent-primary underline underline-offset-2">
            Review them in the queue
          </Link>
          , where each one shows the book it may belong to.
        </p>
      )}
      <ContinueReading books={continuation} />
      {/* A search, sort or filter marks the eBooks busy at once (SLN-753) */}
      <ListPendingProvider>
        <EbooksView
          books={books.map((ebook) =>
            ebookCardData(ebook, ebookCoverImage(ebook, base)),
          )}
          counts={counts}
          page={params.page}
          perPage={params.perPage}
        />
      </ListPendingProvider>
    </>
  );
}
