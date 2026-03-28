import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileText, Database } from "lucide-react";

export const metadata = { title: "Import Books" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import"
        description="Bulk import books from CSV or external sources"
      />

      <div className="max-w-2xl space-y-6">
        {/* CSV upload */}
        <Card>
          <CardContent className="py-6">
            <div className="flex flex-col items-center justify-center">
              <div className="mb-4 rounded-sm border border-bg-tertiary bg-bg-primary p-3">
                <Upload className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />
              </div>
              <h3 className="font-serif text-base text-fg-primary">
                CSV Import
              </h3>
              <p className="mt-1 text-center text-xs text-fg-secondary">
                Upload a CSV file with book data. The file will be processed
                through the medallion pipeline (bronze &rarr; silver &rarr; gold).
              </p>
              <p className="mt-4 text-center text-[10px] text-fg-muted">
                Coming soon &mdash; use Python ingestion scripts for now
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Python scripts */}
        <Card>
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <div className="rounded-sm border border-bg-tertiary bg-bg-primary p-2.5">
                <FileText
                  className="h-5 w-5 text-fg-muted"
                  strokeWidth={1.5}
                />
              </div>
              <div>
                <h3 className="font-serif text-base text-fg-primary">
                  Python ingestion scripts
                </h3>
                <p className="mt-1 text-xs text-fg-secondary">
                  For the initial data load from the knowledge base Excel
                  workbook, use the Python scripts in{" "}
                  <code className="rounded-sm bg-bg-tertiary px-1 py-0.5 font-mono text-[10px]">
                    scripts/ingest/
                  </code>
                </p>
                <div className="mt-3 space-y-1 font-mono text-[10px] text-fg-muted">
                  <p>task ingest:dry &mdash; Preview without writing</p>
                  <p>task ingest &mdash; Full ingestion run</p>
                  <p>task ingest:report &mdash; Post-ingestion report</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Import history placeholder */}
        <Card>
          <CardContent className="py-6">
            <div className="flex items-start gap-4">
              <div className="rounded-sm border border-bg-tertiary bg-bg-primary p-2.5">
                <Database
                  className="h-5 w-5 text-fg-muted"
                  strokeWidth={1.5}
                />
              </div>
              <div>
                <h3 className="font-serif text-base text-fg-primary">
                  Import history
                </h3>
                <p className="mt-1 text-xs text-fg-secondary">
                  No imports recorded yet. Import history will appear here once
                  you run your first import.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
