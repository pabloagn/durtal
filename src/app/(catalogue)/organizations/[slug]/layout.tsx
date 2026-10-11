import { notFound } from "next/navigation";
import { organizationExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  // Before the loading screen starts the response, so a missing organization answers 404
  if (!(await organizationExists((await params).slug))) notFound();
  return children;
}
