import { notFound } from "next/navigation";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { loadVenue } from "./load";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await redirectMergedRecord("venues", slug);
  // A missing place answers 404: checked here, before the page's Suspense starts the response
  if (!(await loadVenue(slug))) notFound();
  return children;
}
