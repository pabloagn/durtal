import { notFound } from "next/navigation";
import { readingImportExists } from "@/lib/catalogue/record-exists";

export default async function ImportPreviewLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Before the loading screen starts the response, so a missing import answers 404
  if (!(await readingImportExists((await params).id))) notFound();
  return children;
}
