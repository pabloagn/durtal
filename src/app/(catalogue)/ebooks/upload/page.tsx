import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { buttonClass } from "@/components/ui/button";
import { UploadWorkbench } from "@/components/ebooks/upload-workbench";
import { uploadTargetSchema } from "@/lib/ebooks/upload/protocol";
import { isUuid } from "@/lib/utils/uuid";

export const metadata: Metadata = { title: "Upload eBooks" };
export default async function UploadEbooksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const kind = raw.kind ?? "new";
  const target = uploadTargetSchema.safeParse(kind === "new" ? { kind } : {
    kind, ebookId: raw.ebookId, beforeFingerprint: raw.before, ...(kind === "replace" ? { fileId: raw.fileId } : {}),
  });
  const batch = typeof raw.batch === "string" && isUuid(raw.batch) ? raw.batch.toLowerCase() : null;
  if (!target.success || raw.batch !== undefined && !batch) return <div>
    <PageHeader title="Upload eBooks" description="This upload link is invalid. Open a fresh upload or return to the eBook you want to update." />
    <form action="/ebooks/upload" method="get">
      <button className={buttonClass()} type="submit">Open new upload</button>
    </form>
  </div>;
  return <div>
    <PageHeader title={target.data.kind === "new" ? "Upload eBooks" : target.data.kind === "add_format" ? "Add a format" : "Replace an eBook file"}
      description="Your files are checked before any library changes. Replacements and restores show a preview for confirmation." />
    <UploadWorkbench target={target.data} initialBatchId={batch} />
  </div>;
}
