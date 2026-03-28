import { PageHeader } from "@/components/layout/page-header";
import { AddBookWizard } from "./wizard";

export const metadata = { title: "Add Book" };

export default function AddBookPage() {
  return (
    <>
      <PageHeader
        title="Add book"
        description="Search by ISBN, title, or enter details manually"
      />
      <AddBookWizard />
    </>
  );
}
