import { notFound } from "next/navigation";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { authorExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await redirectMergedRecord("authors", slug);
  // Before the loading screen starts the response, so a missing person answers 404
  if (!(await authorExists(slug))) notFound();
  return children;
}
