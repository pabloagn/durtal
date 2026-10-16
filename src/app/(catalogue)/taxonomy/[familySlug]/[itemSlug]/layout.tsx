import { notFound } from "next/navigation";
import { redirectMergedRecord } from "@/lib/harmonization/redirect";
import { taxonomyStorage } from "@/lib/catalogue/taxonomy-storage";
import { loadFamily, loadItem } from "../load";

/** A missing item answers 404: checked here, before the page's Suspense starts the response */
export default async function TaxonomyItemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ familySlug: string; itemSlug: string }>;
}) {
  const { familySlug, itemSlug } = await params;
  if (!(await loadItem(familySlug, itemSlug))) {
    const family = await loadFamily(familySlug);
    if (family) await redirectMergedRecord(taxonomyStorage(family).entity, itemSlug, `/taxonomy/${family.slug}`, family.id);
    notFound();
  }
  return children;
}
