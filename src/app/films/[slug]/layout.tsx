import { notFound } from "next/navigation";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { workRecordExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await redirectMergedRecord("works", slug);
  // Before the loading screen starts the response, so a missing film answers 404
  if (!(await workRecordExists("film", slug))) notFound();
  return children;
}
