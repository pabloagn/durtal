import { redirectMergedRecord } from "@/lib/harmonization/redirect";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  await redirectMergedRecord("publishers", (await params).slug);
  return children;
}
