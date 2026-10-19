import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClass } from "@/components/ui/button";
import { UploadWorkbench } from "@/components/ebooks/upload-workbench";
import { uploadTargetSchema } from "@/lib/ebooks/upload/protocol";
import { uploadsAvailable, uploadsNotice } from "@/lib/ebooks/upload/availability";
import { readUploadTargetSummary, type UploadTargetSummary } from "@/lib/ebooks/upload/target-summary";
import { formatBytes } from "@/lib/ebooks/run-text";
import { formatLabel } from "@/lib/ebooks/formats";
import { isUuid } from "@/lib/utils/uuid";

export const metadata: Metadata = { title: "Upload eBooks" };
const one = (value: string | string[] | undefined) => typeof value === "string" ? value : undefined;
/** A replacement must be the same format: the picker offers that format's files (a Kobo EPUB ends in .epub) */
const pickerExtensions = (format: string) => format === "other" ? undefined : format === "kepub" ? ".epub,.kepub" : `.${format}`;
export default async function UploadEbooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const kind = raw.kind ?? "new";
  const ebookId = one(raw.ebookId), fileId = one(raw.fileId);
  // Links name only the eBook and the file; the page reads what the server will check them against (SLN-672)
  let summary: UploadTargetSummary | null = null;
  if (kind !== "new" && ebookId && isUuid(ebookId) && (kind !== "replace" || fileId && isUuid(fileId)))
    summary = await readUploadTargetSummary(ebookId, kind === "replace" ? fileId! : null).catch(() => null);
  const target = uploadTargetSchema.safeParse(kind === "new" ? { kind } : {
    kind, ebookId, beforeFingerprint: summary?.fingerprint ?? raw.before, ...(kind === "replace" ? { fileId } : {}),
  });
  const batch = typeof raw.batch === "string" && isUuid(raw.batch) ? raw.batch.toLowerCase() : null;
  if (!target.success || raw.batch !== undefined && !batch) return <div>
    <PageHeader title="Upload eBooks" description="This upload link does not lead to an eBook or file in the library. Start a new upload, or go back to the eBook you want to change." />
    <div className="flex flex-wrap gap-3">
      <Link className={buttonClass("primary")} href="/ebooks/upload">Upload eBooks</Link>
      <Link className={buttonClass("secondary")} href="/ebooks">Back to eBooks</Link>
    </div>
  </div>;
  const description = target.data.kind === "new"
    ? "Each file is checked, then added to the library. One that needs a decision waits here for you."
    : target.data.kind === "add_format"
      ? `Adds another format to “${summary?.title ?? "this eBook"}”. Its reading places, highlights and notes stay.`
      : summary?.file
        ? `Replaces the ${formatLabel(summary.file.format)} (${formatBytes(summary.file.sizeBytes)}) of “${summary.title}”. The old file is kept, so it can be put back.`
        : "Replaces a file of this eBook. The old file is kept, so it can be put back.";
  return <div>
    <PageHeader title={target.data.kind === "new" ? "Upload eBooks" : target.data.kind === "add_format" ? "Add a format" : "Replace a file"}
      description={description} />
    <UploadWorkbench target={target.data} initialBatchId={batch} available={uploadsAvailable()} notice={await uploadsNotice()}
      accept={target.data.kind === "replace" && summary?.file ? pickerExtensions(summary.file.format) : undefined} />
  </div>;
}
