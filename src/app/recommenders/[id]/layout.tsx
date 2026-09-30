import { redirectMergedRecord } from "@/lib/harmonization/redirect";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  await redirectMergedRecord("recommenders", (await params).id);
  return children;
}
