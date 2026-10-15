import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { workRecordExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const exists = (slug: string) => workRecordExists("film", slug);
  // Before the loading screen starts the response, so a missing film answers 404
  if (!(await liveRecord("works", (await params).slug, exists))) notFound();
  return children;
}
