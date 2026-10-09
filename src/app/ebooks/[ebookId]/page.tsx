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
import { isEbookFileDownloadable } from "@/lib/ebooks/conditions";
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
import { Prose } from "@/components/shared/prose";
import { buttonClass } from "@/components/ui/button";
import { EbookCover } from "@/components/ebooks/ebook-card";
import { EbookLinkPanel } from "@/components/ebooks/ebook-link-panel";
import { EbookFilesTable } from "@/components/ebooks/ebook-files-table";
import { EbookPlaces } from "@/components/ebooks/ebook-places";
type Props = { params: Promise<{ ebookId: string }> };
const load = cache(async (id: string) =>
  isUuid(id) ? getEbookDetail(id.toLowerCase()) : null,
);
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const ebook = await load((await params).ebookId);
  return { title: ebook?.title ?? "eBook not found" };
}
export default async function EbookPage({ params }: Props) {
  // proxy returns 400 for malformed ids before page or metadata can query.
  const ebook = await load((await params).ebookId);
  if (!ebook) notFound();
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
  const readLabel = !descriptor?.anchor
    ? "Read"
    : descriptor.projection === "pending-reanchor"
      ? `Continue · saved ${descriptor.savedPercent}%`
      : `Continue · ${descriptor.targetPercent}%`;
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
      <Link
        href="/ebooks"
        className="mb-4 inline-block text-xs text-fg-secondary touch-hit"
      >
        eBooks
      </Link>
      <PageHeader
        title={ebook.title}
        description={ebook.subtitle ?? undefined}
        actions={
          descriptor && (
            <Link href={descriptor.href} className={buttonClass("primary")}>
              {readLabel}
            </Link>
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
          <div className="min-w-0 flex-1">
            <p className="type-item-title [overflow-wrap:anywhere]">
              {ebook.authors.join(", ") || "Unknown author"}
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
                  <Link
                    key={file.id}
                    href={`/reader/${ebook.id}?file=${file.id}`}
                    className={buttonClass("secondary", "sm")}
                  >
                    Read the {formatLabel(file.format)}
                  </Link>
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
        <section className="mb-8">
          <SectionHeading title="The book it belongs to" />
          <EbookLinkPanel ebook={ebook} />
        </section>
        <section className="mb-8">
          <SectionHeading title="Files" count={files.length} />
          <EbookFilesTable files={files} />
        </section>
        <section className="mb-8">
          <SectionHeading title="Places" count={ebook.positions.length} />
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
