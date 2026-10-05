import { PageHeader } from "@/components/layout/page-header";
import { addBookParams } from "@/lib/reading/book-picker";
import { AddBookWizard } from "./wizard";

export const metadata = { title: "Add Book" };

export default async function AddBookPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string | string[]; isbn?: string | string[]; then?: string | string[] }>;
}) {
  // From the reading book picker (SLN-448): ?q= or ?isbn=, and &then=start, past or quote
  const { initialQuery, initialIsbn, then } = addBookParams((await searchParams) ?? {});
  return (
    <>
      <PageHeader
        title="Add book"
        description="Search by ISBN, title, or enter details manually"
      />
      <AddBookWizard initialQuery={initialQuery} initialIsbn={initialIsbn} then={then} />
    </>
  );
}
