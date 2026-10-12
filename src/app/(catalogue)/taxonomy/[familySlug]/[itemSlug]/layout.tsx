import { notFound } from "next/navigation";
import { loadItem } from "../load";

/** A missing item answers 404: checked here, before the page's Suspense starts the response */
export default async function TaxonomyItemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ familySlug: string; itemSlug: string }>;
}) {
  const { familySlug, itemSlug } = await params;
  if (!(await loadItem(familySlug, itemSlug))) notFound();
  return children;
}
