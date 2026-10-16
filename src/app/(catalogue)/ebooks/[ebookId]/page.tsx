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
import { openFailureOf } from "@/lib/ebooks/open-failure";
import { lockName, lockedFileMessage } from "@/lib/ebooks/locked-file";
import { languageName } from "@/lib/utils/language";
import {
  DetailColumns,
  DetailTitleRow,
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
import { EbookHistory } from "@/components/ebooks/ebook-history";
import { getEbookDecisions } from "@/lib/ebooks/review/history";
import { getEbookMarkCounts } from "@/lib/ebooks/highlights";
import { getLinkedBook } from "@/lib/ebooks/linked-book";
type Props = {
  params: Promise<{ ebookId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
/** Devices the Reading places section shows, and with "Show all devices" (SLN-665) */
const DEVICES_SHOWN = 5;
const DEVICES_ALL = 200;
const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;
const load = cache(async (id: string, allDevices: boolean) => {
  if (!isUuid(id)) return null;
  const device = (await cookies()).get(DEVICE_COOKIE)?.value;
  return getEbookDetail(id.toLowerCase(), undefined, {
    places: { deviceId: isDeviceId(device) ? device : null, devices: allDevices ? DEVICES_ALL : DEVICES_SHOWN },
  });
});
const allDevicesOf = async (searchParams: Props["searchParams"]) => (await searchParams).places === "all";
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ebook = await load((await params).ebookId, await allDevicesOf(searchParams));
  if (!ebook) return { title: "eBook not found" };
  // Named after its book, as a page under it (SLN-683)
  return { title: ebook.workTitle ? `${ebook.workTitle} · eBook` : ebook.title };
}
export default async function EbookPage({ params, searchParams }: Props) {
  // A malformed id finds nothing: the layout answers it with eBook not found (SLN-864)
  const allDevices = await allDevicesOf(searchParams);
  const ebook = await load((await params).ebookId, allDevices);
  if (!ebook) notFound();
  const [marks, decisions] = await Promise.all([getEbookMarkCounts(ebook.id), getEbookDecisions(ebook.id)]);
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
  // A file the reader could not open, or, with nothing to read, one DRM
  // locks: said in plain words beside the cover, with its replacement (SLN-685)
  const replaceHref = (fileId: string) => `/ebooks/upload?kind=replace&ebookId=${ebook.id}&fileId=${fileId}`;
  const target = descriptor ? ebook.files.find((file) => file.id === descriptor.target.id) : undefined;
  const damaged = target && openFailureOf(target.metadata) ? target : undefined;
  // With nothing else to read, the damaged file's replacement leads and Read
  // stays to try it again (SLN-864)
  const replaceLeads = !!damaged && alternatives.length === 0;
  const locked = descriptor || ebook.matchState === "excluded" ? undefined
    : ebook.files.find((file) => file.drm !== null && (file.status === "stored" || file.status === "verified"));
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
      ? `Locked with ${lockName(file.drm)}, cannot be opened`
      : (file.status === "stored" || file.status === "verified") && openFailureOf(file.metadata)
        ? `Damaged: did not open on ${openFailureOf(file.metadata)!.at.slice(0, 10)}`
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
  const description = book
    ? `The eBook of this book${own ? `, titled “${own}” in its files` : ""}.`
    : ebook.subtitle;
  return (
    <>
      {/* A page under its book: eBooks / the book, titled after it (SLN-683) */}
      <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap items-baseline gap-x-2 text-xs text-fg-secondary">
        <Link href="/ebooks" className="touch-hit text-command">
          eBooks
        </Link>
        {book && (
          <>
            <span aria-hidden="true" className="text-fg-muted">/</span>
            <Link href={book.href} className="touch-hit text-command [overflow-wrap:anywhere]">
              {book.title}
            </Link>
          </>
        )}
      </nav>
      {/* The title steps down on a phone like every record's, Read on its
          edge (SLN-877) */}
      <header className="mb-8 min-w-0">
        <DetailTitleRow title={book?.title ?? ebook.title} controls="button">
          {descriptor && (
            <CapAlignedControls height={32} coarseHeight={44}>
              {replaceLeads && (
                <Link href={replaceHref(damaged.id)} className={buttonClass("primary")}>
                  Replace file…
                </Link>
              )}
              <ReaderEntryLink readerPath={descriptor.href} returnTo={returnTo} className={buttonClass(replaceLeads ? "secondary" : "primary")}>
                {readLabel}
              </ReaderEntryLink>
            </CapAlignedControls>
          )}
        </DetailTitleRow>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-secondary [overflow-wrap:anywhere]">
            {description}
          </p>
        )}
      </header>
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
            {damaged && (
              <p className="mt-3 text-sm text-fg-primary">
                {replaceLeads ? `This ${formatLabel(damaged.format)} file is damaged.` : <>
                  This {formatLabel(damaged.format)} file is damaged ·{" "}
                  <Link href={replaceHref(damaged.id)} className="touch-hit text-command">Replace file…</Link>
                </>}
              </p>
            )}
            {locked?.drm && (
              <p className="mt-3 text-sm text-fg-primary">
                {lockedFileMessage(locked.drm)}{" "}
                <Link href={replaceHref(locked.id)} className="touch-hit text-command">Replace file…</Link>
              </p>
            )}
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
        <section id="places" className="mb-8 scroll-mt-6">
          <EbookPlaces ebook={ebook} descriptor={descriptor} returnTo={returnTo} allDevices={allDevices} />
        </section>
        <section className="mb-8">
          <EbookHistory ebook={ebook} decisions={decisions.decisions} decisionTotal={decisions.total} />
        </section>
      </DetailColumns>
    </>
  );
}
