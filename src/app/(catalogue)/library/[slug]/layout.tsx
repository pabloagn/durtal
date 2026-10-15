import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { bookRecordExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  // Before the loading screen starts the response, so a missing book answers 404
  if (!(await liveRecord("works", (await params).slug, bookRecordExists))) notFound();
  return children;
}
