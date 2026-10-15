import { notFound } from "next/navigation";
import { ebookExists } from "@/lib/catalogue/record-exists";

export default async function RecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ebookId: string }>;
}) {
  // Before the loading screen starts the response, so a missing eBook answers 404
  if (!(await ebookExists((await params).ebookId))) notFound();
  return children;
}
