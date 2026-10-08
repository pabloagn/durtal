import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Upload, FileText, Database } from "lucide-react";
import { CapAligned } from "@/components/shared/cap-aligned";

export const metadata = { title: "Import Books" };

export default function ImportPage() {
  return (
    <>
      <PageHeader
        title="Import"
        description="Bulk import books from CSV or external sources"
      />

      <p className="mb-6 text-sm text-fg-secondary" data-reading-import-link="">
        Importing reading history from Goodreads or StoryGraph? Use{" "}
        <Link href="/reading/import" className="text-fg-primary underline decoration-glass-border underline-offset-2 transition-colors hover:text-accent-primary">
          Reading › Import
        </Link>
      </p>

      <div className="max-w-2xl space-y-6">
        {/* CSV upload */}
        <Card>
          <CardContent className="py-6">
            <div className="flex flex-col items-center justify-center">
              <div className="mb-4 rounded-sm border border-glass-border bg-bg-primary p-3">
                <Upload className="h-6 w-6 text-fg-muted" strokeWidth={1.5} />
              </div>
              <h3 className="type-item-title">
                CSV Import
              </h3>
              <p className="mt-1 text-center text-xs text-fg-secondary">
                Upload a CSV file with book data. The file will be processed
                through the medallion pipeline (bronze &rarr; silver &rarr; gold).
              </p>
              <p className="mt-4 text-center text-micro text-fg-secondary">
                Coming soon &mdash; use Python ingestion scripts for now
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Python scripts */}
        <Card>
          <CardContent className="py-6">
            {/* The row carries the heading's type: the icon tile sits on the
                cap-height center of the heading */}
            <div className="type-item-title flex items-start gap-4">
              <CapAligned height={34}>
                <span className="block rounded-sm border border-glass-border bg-bg-primary p-2">
                  <FileText
                    className="block h-4 w-4 text-fg-secondary"
                    strokeWidth={1.5}
                  />
                </span>
              </CapAligned>
              <div className="font-sans">
                <h3 className="type-item-title">
                  Python ingestion scripts
                </h3>
                <p className="mt-1 text-xs text-fg-secondary">
                  For the initial data load from the knowledge base Excel
                  workbook, use the Python scripts in{" "}
                  <code className="rounded-sm bg-bg-tertiary px-1 py-0.5 font-mono text-micro">
                    scripts/ingest/
                  </code>
                </p>
                <div className="mt-3 space-y-1 font-mono text-micro text-fg-secondary">
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
            {/* The row carries the heading's type: the icon tile sits on the
                cap-height center of the heading */}
            <div className="type-item-title flex items-start gap-4">
              <CapAligned height={34}>
                <span className="block rounded-sm border border-glass-border bg-bg-primary p-2">
                  <Database
                    className="block h-4 w-4 text-fg-secondary"
                    strokeWidth={1.5}
                  />
                </span>
              </CapAligned>
              <div className="font-sans">
                <h3 className="type-item-title">
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
