import Link from "next/link";
import { Upload } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DomainAddLink } from "@/components/domains/domain-add-link";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Import" };

/**
 * Importing books in bulk is not built yet (SLN-832). The page says so
 * plainly and offers what works today: adding a book, and importing reading
 * history. Nothing links here until the import exists.
 */
export default function ImportPage() {
  return (
    <>
      <PageHeader title="Import" />
      <EmptyState
        icon={Upload}
        heading="h2"
        title="Importing books isn't available yet"
        description="For now, add books one at a time. Reading history from Goodreads or StoryGraph can be imported already."
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <DomainAddLink kind="book" size="md" />
            <Link href="/reading/import" className={`${buttonClass("secondary", "md")} whitespace-nowrap`}>
              Import reading history
            </Link>
          </div>
        }
      />
    </>
  );
}
