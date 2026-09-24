import { Suspense } from "react";
import { notFound } from "next/navigation";
import {
  getTaxonomyFamily,
  getTaxonomyItems,
} from "@/lib/actions/taxonomy-families";
import { Spinner } from "@/components/ui/spinner";
import { TaxonomyFamilyShell } from "./taxonomy-family-shell";

async function FamilyContent({ familySlug }: { familySlug: string }) {
  const [family, items] = await Promise.all([
    getTaxonomyFamily(familySlug),
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
