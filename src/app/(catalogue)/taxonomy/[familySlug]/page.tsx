import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { loadFamily } from "./load";
import { getTaxonomyBrowsePage } from "@/lib/actions/taxonomy-browse";
import { lastPage, pageHref, type ListSearchParams } from "@/lib/utils/pagination";
import { taxonomyStorage } from "@/lib/catalogue/taxonomy-storage";
import { TaxonomySkeleton } from "@/components/taxonomy/taxonomy-skeleton";
import { TaxonomyFamilyShell } from "./taxonomy-family-shell";

async function FamilyContent({ familySlug, query }: { familySlug: string; query: ListSearchParams }) {
  const [family, browse] = await Promise.all([loadFamily(familySlug), getTaxonomyBrowsePage(familySlug, query)]);
  if (!family || !browse) notFound();
  const end = lastPage(browse.total, browse.perPage);
  if (browse.page > end) redirect(pageHref(`/taxonomy/${familySlug}`, query, end));
  return <TaxonomyFamilyShell family={{ ...family, manualOrdering: taxonomyStorage(family).columns.has("sort_order") }} items={browse.items.map(i => ({ ...i, slug: i.slug ?? i.id }))} browse={browse} />;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ familySlug: string }>;
}): Promise<Metadata> {
  const family = await loadFamily((await params).familySlug);
  return { title: family?.name ?? "Taxonomy not found" };
}

export default async function TaxonomyFamilyPage({
  params, searchParams,
}: {
  params: Promise<{ familySlug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { familySlug } = await params;
  const query = await searchParams;

  return (
    <Suspense key={JSON.stringify(query)} fallback={<TaxonomySkeleton kind="family" />}>
      <FamilyContent familySlug={familySlug} query={query} />
    </Suspense>
  );
}
