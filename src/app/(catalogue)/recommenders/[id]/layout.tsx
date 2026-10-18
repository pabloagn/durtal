import { notFound } from "next/navigation";
import { liveRecord } from "@/lib/harmonization/redirect";
import { recommenderExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Before the loading screen starts the response, so a missing recommender answers 404
  if (!(await liveRecord("recommenders", (await params).id, recommenderExists))) notFound();
  return children;
}
