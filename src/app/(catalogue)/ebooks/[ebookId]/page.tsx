import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import sanitizeHtml from "sanitize-html";
import { isUuid } from "@/lib/utils/uuid";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { getEbookDetail, readableFiles } from "@/lib/ebooks/library-queries";
import {
  ebookCoverImage,
  ebookPageCoverBase,
} from "@/lib/ebooks/library-cover";
import { ebookCardData } from "@/lib/ebooks/library-view";
import { continueTarget } from "@/lib/ebooks/continue-target";
import { catalogueReadLabel } from "@/lib/ebooks/read-target";
import { catalogueContinueDTO } from "@/lib/ebooks/catalogue-dto";
import {
  isEbookFileDownloadable,
  isEbookFileNativeReadable,
} from "@/lib/ebooks/conditions";
import { formatLabel } from "@/lib/ebooks/formats";
import { languageName } from "@/lib/utils/language";
import { PageHeader } from "@/components/layout/page-header";
import {
  DetailColumns,
  RecordPanel,
  RecordGroup,
  RecordFields,
  RecordField,
} from "@/components/shared/detail-layout";
import { SectionHeading } from "@/components/shared/section-heading";
import { CapAlignedControls } from "@/components/shared/cap-aligned";
import { Prose } from "@/components/shared/prose";
import { buttonClass } from "@/components/ui/button";
import { EbookCover } from "@/components/ebooks/ebook-card";
import { ReaderEntryLink } from "@/components/reader/reader-entry-link";
import { EbookLinkPanel } from "@/components/ebooks/ebook-link-panel";
import { EbookFilesTable } from "@/components/ebooks/ebook-files-table";
import { EbookPlaces } from "@/components/ebooks/ebook-places";
import { EbookMarksExport } from "@/components/ebooks/ebook-marks-export";
import { getEbookMarkCounts } from "@/lib/ebooks/highlights";
import { getLinkedBook } from "@/lib/ebooks/linked-book";
type Props = { params: Promise<{ ebookId: string }> };
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
const load = cache(async (id: string) =>
  isUuid(id) ? getEbookDetail(id.toLowerCase()) : null,
);
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ebook = await load((await params).ebookId);
  if (!ebook) return { title: "eBook not found" };
  // Named after its book, as a page under it (SLN-683)
  return { title: ebook.workTitle ? `${ebook.workTitle} · eBook` : ebook.title };
}
export default async function EbookPage({ params }: Props) {
  // proxy returns 400 for malformed ids before page or metadata can query.
  const ebook = await load((await params).ebookId);
  if (!ebook) notFound();
  const marks = await getEbookMarkCounts(ebook.id);
  const markTotal = marks.highlights + marks.bookmarks;
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  const descriptor = continueTarget({
    ebookId: ebook.id,
    excluded: ebook.matchState === "excluded",
    preferredFileId: ebook.preferredFileId,
    deviceId: isDeviceId(device) ? device : null,
    files: ebook.files,
    positions: ebook.positions,
  });
  const cover = ebookCoverImage(ebook, ebookPageCoverBase());
  const returnTo = `/ebooks/${ebook.id}`;
  // A linked eBook is a page under its book: titled after it, its own title kept as a note
  const linked =
    ebook.matchState === "linked" && ebook.instanceId
      ? await getLinkedBook(ebook.instanceId)
      : null;
  const book = linked
    ? { title: linked.title, authors: linked.authors, href: `/library/${linked.slug ?? linked.workId}` }
    : null;
  const fold = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  const own = book && fold(ebook.title) !== fold(book.title) ? ebook.title : null;
  // The book page's label and number: the newest place on any device (SLN-683)
  const readLabel = descriptor ? catalogueReadLabel(catalogueContinueDTO(descriptor)) : null;
  const identifiers = Object.entries(ebook.identifiers).flatMap(
    ([scheme, values]) =>
      Array.isArray(values)
        ? values
            .filter((value): value is string => typeof value === "string")
            .map((value) => ({ scheme, value }))
        : [],
  );
  const alternatives = readableFiles(ebook).filter(
    (file) => file.id !== descriptor?.target.id,
  );
  const files = ebook.files.map((file) => ({
    id: file.id,
    format: file.format,
    sizeBytes: file.sizeBytes,
    checksum: file.sha256,
    sourceHost: file.sourceHost,
    sourcePath: file.sourcePath,
    added:
      file.createdAt instanceof Date
        ? file.createdAt.toISOString()
        : file.createdAt,
    preferred: file.id === ebook.preferredFileId,
    download: isEbookFileDownloadable(file),
    readable:
      ebook.matchState !== "excluded" && isEbookFileNativeReadable(file),
    replaceable: file.status !== "replaced",
    status: file.drm
      ? `Protected by ${file.drm}, cannot be opened`
      : file.status === "verified"
        ? `Verified${file.verifiedAt ? ` ${file.verifiedAt.slice(0, 10)}` : ""}`
        : file.status === "missing"
          ? "Missing from storage"
          : file.status === "quarantined"
            ? `Damaged${file.quarantineReason ? `: ${file.quarantineReason}` : "; cannot be opened"}`
            : file.status === "replaced"
              ? "Replaced"
              : "Stored",
  }));
  return (
    <>
      {/* A page under its book: eBooks / the book, titled after it (SLN-683) */}
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-baseline gap-x-2 text-xs text-fg-secondary">
        <Link href="/ebooks" className="touch-hit transition-colors hover:text-fg-primary">
          eBooks
        </Link>
        {book && (
          <>
            <span aria-hidden="true" className="text-fg-muted">/</span>
            <Link href={book.href} className="touch-hit transition-colors hover:text-fg-primary [overflow-wrap:anywhere]">
              {book.title}
            </Link>
          </>
        )}
      </nav>
      <PageHeader
        title={book?.title ?? ebook.title}
        description={
          book
            ? `The eBook of this book${own ? `, titled “${own}” in its files` : ""}.`
            : (ebook.subtitle ?? undefined)
        }
        actions={
          descriptor && (
            <ReaderEntryLink readerPath={descriptor.href} returnTo={returnTo} className={buttonClass("primary")}>
              {readLabel}
            </ReaderEntryLink>
          )
        }
      />
      <DetailColumns
        record={
          <RecordPanel>
            <RecordGroup title="Details">
              <RecordFields>
                {ebook.series && (
                  <RecordField label="Series">
                    {ebook.series}
                    {ebook.seriesIndex ? ` · ${ebook.seriesIndex}` : ""}
                  </RecordField>
                )}
                {ebook.language && (
                  <RecordField label="Language">
                    {languageName(ebook.language)}
                  </RecordField>
                )}
                {ebook.publisher && (
                  <RecordField label="Publisher">{ebook.publisher}</RecordField>
                )}
                {ebook.publicationYear && (
                  <RecordField label="Published">
                    {ebook.publicationYear}
                  </RecordField>
                )}
                <RecordField label="Added">
                  {ebook.createdAt.slice(0, 10)}
                </RecordField>
              </RecordFields>
            </RecordGroup>
            {(ebook.isbns.length > 0 || identifiers.length > 0) && (
              <RecordGroup title="Identifiers">
                <RecordFields>
                  {ebook.isbns.map((isbn) => (
                    <RecordField key={isbn} label="ISBN">
                      <span className="font-mono">{isbn}</span>
                    </RecordField>
                  ))}
                  {identifiers.map(({ scheme, value }, index) => (
                    <RecordField key={index} label={scheme}>
                      <span className="[overflow-wrap:anywhere]">{value}</span>
                    </RecordField>
                  ))}
                </RecordFields>
              </RecordGroup>
            )}
          </RecordPanel>
        }
      >
        <div className="mb-8 flex flex-wrap items-start gap-6">
          <div className="w-52 max-w-full shrink-0">
            <EbookCover book={ebookCardData(ebook, cover)} sizes="208px" />
          </div>
          {/* Beside the cover while it has room for a format button, else below it (no sideways scroll at 320px, SLN-666) */}
          <div className="min-w-0 flex-1 basis-48">
            <p className="type-item-title [overflow-wrap:anywhere]">
              {(book?.authors.length ? book.authors : ebook.authors).join(", ") || "Unknown author"}
            </p>
            {descriptor?.projection === "pending-reanchor" && (
              <p className="mt-3 text-sm text-fg-secondary">
                Your saved place will be located in the current{" "}
                {formatLabel(descriptor.target.format)} file when it opens.
              </p>
            )}
            {ebook.matchState !== "excluded" && alternatives.length > 0 && (
              <nav
                className="mt-4 flex flex-wrap gap-2"
                aria-label="Readable formats"
              >
                {alternatives.map((file) => (
                  <ReaderEntryLink
                    key={file.id}
                    readerPath={`/reader/${ebook.id}?file=${file.id}`}
                    returnTo={returnTo}
                    className={buttonClass("secondary", "sm")}
                  >
                    Read the {formatLabel(file.format)}
                  </ReaderEntryLink>
                ))}
              </nav>
            )}
          </div>
        </div>
        {ebook.description && (
          <section className="mb-8">
            <SectionHeading title="About this eBook" />
            <Prose html={sanitizeHtml(ebook.description)} />
          </section>
        )}
        <section id="book" className="mb-8 scroll-mt-8">
          <SectionHeading title="The book it belongs to" />
          <EbookLinkPanel ebook={ebook} book={linked} />
        </section>
        {markTotal > 0 && (
          <section className="mb-8">
            <SectionHeading title="Highlights and notes" />
            <p className="mb-3 text-sm text-fg-secondary">
              <Link
                href={`/ebooks/highlights?ebook=${ebook.id}`}
                className="text-fg-primary transition-colors hover:text-accent-primary"
              >
                {[
                  plural(marks.highlights, "highlight"),
                  plural(marks.notes, "note"),
                  plural(marks.bookmarks, "bookmark"),
                ].join(" · ")}
              </Link>
            </p>
            <EbookMarksExport
              book={{ id: ebook.id, title: ebook.title, authors: ebook.authors }}
            />
          </section>
        )}
        <section className="mb-8">
          <SectionHeading title="Files" count={files.length} action={
            <CapAlignedControls height={28} coarseHeight={44} className="type-section-title">
              <Link href={`/ebooks/upload?kind=add_format&ebookId=${ebook.id}`} className={`${buttonClass("secondary", "sm")} whitespace-nowrap`}>
                Add a format…
              </Link>
            </CapAlignedControls>
          } />
          <EbookFilesTable ebookId={ebook.id} files={files} />
        </section>
        <section className="mb-8">
          <SectionHeading title="Reading places" count={ebook.positions.length} />
          <EbookPlaces ebook={ebook} />
        </section>
        <section className="mb-8">
          <SectionHeading title="History" count={ebook.historyTotal} />
          {ebook.history.length ? (
            <ul className="divide-y divide-glass-border">
              {ebook.history.map((item) => (
                <li key={item.id} className="py-3 text-sm">
                  <Link
                    href={`/ebooks/runs/${item.runId}`}
                    className="text-accent-primary"
                  >
                    {item.createdAt.slice(0, 10)} ·{" "}
                    {item.host ?? "Browser upload"}
                  </Link>
                  <p className="mt-1 text-xs text-fg-secondary [overflow-wrap:anywhere]">
                    {item.path} ·{" "}
                    {item.reason ??
                      item.outcome?.replace(/_/g, " ") ??
                      "Recorded"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-secondary">
              No ingestion history recorded.
            </p>
          )}
          {ebook.historyTotal > ebook.history.length && (
            <p className="mt-3 text-xs text-fg-secondary">
              Showing the latest {ebook.history.length} of {ebook.historyTotal}{" "}
              events. Open a run for its full history.
            </p>
          )}
        </section>
      </DetailColumns>
    </>
  );
}
