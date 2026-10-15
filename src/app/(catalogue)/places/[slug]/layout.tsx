import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { loadVenue } from "./load";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  // Before the loading screen starts the response, so a missing place answers 404
  if (!(await liveRecord("venues", (await params).slug, loadVenue))) notFound();
  return children;
}
