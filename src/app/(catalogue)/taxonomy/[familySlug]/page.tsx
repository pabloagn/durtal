import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { loadFamily } from "./load";
import { getTaxonomyItems } from "@/lib/actions/taxonomy-families";
import { Spinner } from "@/components/ui/spinner";
import { TaxonomyFamilyShell } from "./taxonomy-family-shell";

async function FamilyContent({ familySlug }: { familySlug: string }) {
  const [family, items] = await Promise.all([
    loadFamily(familySlug),
    getTaxonomyItems(familySlug),
  ]);

  if (!family) notFound();

  // Normalize items: some system families may return nullable slugs
  const normalizedItems = items.map((item) => ({
    ...item,
    slug: item.slug ?? item.id,
  }));

  return <TaxonomyFamilyShell family={family} items={normalizedItems} />;
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
  params,
}: {
  params: Promise<{ familySlug: string }>;
}) {
  const { familySlug } = await params;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <FamilyContent familySlug={familySlug} />
    </Suspense>
  );
}
