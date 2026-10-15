import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { publisherExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  // Before the loading screen starts the response, so a missing publisher answers 404
  if (!(await liveRecord("publishers", (await params).slug, publisherExists))) notFound();
  return children;
}
