import { notFound } from "next/navigation";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { publisherExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await redirectMergedRecord("publishers", slug);
  // Before the loading screen starts the response, so a missing publisher answers 404
  if (!(await publisherExists(slug))) notFound();
  return children;
}
