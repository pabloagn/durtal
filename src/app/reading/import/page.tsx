import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { Badge } from "@/components/ui/badge";
import { ReadingTabs } from "@/components/reading/reading-tabs";
import { HubActions } from "@/components/reading/hub-actions";
import { ImportUpload, UndoImport } from "@/components/reading/import/import-client";
import { listReadingImports, type ImportListItem } from "@/lib/reading/import/page-data";
import { SOURCE_LABELS } from "@/lib/reading/import/preview-text";
import { formatReadingDate } from "@/lib/reading/dates";
import { appTimeZone, calendarDate } from "@/lib/utils/date";

export const metadata = { title: "Import reading history" };

const STATUS: Record<ImportListItem["status"], { label: string; variant: "sage" | "gold" | "muted" }> = {
  completed: { label: "Imported", variant: "sage" },
  pending: { label: "To review", variant: "gold" },
  undone: { label: "Undone", variant: "muted" },
};

const n = (count: number) => count.toLocaleString("en-US");
const when = (iso: string) => formatReadingDate(calendarDate(new Date(iso), appTimeZone()), "day");

/** Reading › Import (SLN-450): the upload and the past imports */
export default async function ReadingImportPage() {
  const imports = await listReadingImports();
  return (
    <>
      <PageHeader title="Reading" actions={<HubActions />} tabs={<ReadingTabs />} />
      <div className="space-y-12">
        <ImportUpload />
        {imports.length > 0 && (
          <section>
            <SectionHeading title="Past imports" count={imports.length} />
            <ul className="divide-y divide-glass-border rounded-sm border border-glass-border bg-bg-secondary" data-import-list="">
              {imports.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-import-item={i.id}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/reading/import/${i.id}`} className="lines-1 block text-sm text-fg-primary transition-colors hover:text-accent-rose-text">
                      {i.fileName ?? "Reading history"}
                    </Link>
                    <p className="lines-1 text-xs text-fg-secondary">
                      {[
                        when(i.createdAt),
                        SOURCE_LABELS[i.source] ?? i.source,
                        `${n(i.totalRecords)} ${i.totalRecords === 1 ? "row" : "rows"}`,
                        i.readings ? `${n(i.readings)} ${i.readings === 1 ? "reading" : "readings"} imported` : null,
                        i.errorRecords ? `${n(i.errorRecords)} not written` : null,
                        i.rawKept ? null : "Raw file not kept",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge variant={STATUS[i.status]?.variant ?? "muted"}>{STATUS[i.status]?.label ?? i.status}</Badge>
                    {i.readings > 0 && <UndoImport importId={i.id} readings={i.readings} size="sm" />}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
