import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { seriesExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Before the loading screen starts the response, so a missing series answers 404
  if (!(await liveRecord("series", (await params).id, seriesExists))) notFound();
  return children;
}
