import { notFound } from "next/navigation";
import { loadFamily } from "./load";

/** A missing family answers 404: checked here, before the page's Suspense starts the response */
export default async function TaxonomyFamilyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ familySlug: string }>;
}) {
  if (!(await loadFamily((await params).familySlug))) notFound();
  return children;
}
