import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { collectionExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Before the loading screen starts the response, so a missing collection answers 404
  if (!(await liveRecord("collections", (await params).id, collectionExists))) notFound();
  return children;
}
