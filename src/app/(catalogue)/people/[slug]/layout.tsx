import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { authorExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  // Before the loading screen starts the response, so a missing person answers 404
  if (!(await liveRecord("authors", (await params).slug, authorExists))) notFound();
  return children;
}
