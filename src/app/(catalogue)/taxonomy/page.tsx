import { Suspense } from "react";
import { Tags } from "lucide-react";
import { getTaxonomyFamilies } from "@/lib/actions/taxonomy-families";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { TaxonomySkeleton } from "@/components/taxonomy/taxonomy-skeleton";
import { FamilyCard } from "@/components/taxonomy/family-card";
import { TaxonomyActions } from "./taxonomy-actions";

export const metadata = { title: "Taxonomy" };

async function TaxonomyContent({
  families,
}: {
  families: Awaited<ReturnType<typeof getTaxonomyFamilies>>;
}) {

  if (families.length === 0) {
    return (
      <EmptyState
        icon={Tags}
        title="No taxonomy families"
        description="A family groups the terms you tag works with, such as genres or themes. Add one with New family."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {families.map((family) => (
        <FamilyCard key={family.id} family={family} />
      ))}
    </div>
  );
}

async function TaxonomyDirectory() {
  const families = await getTaxonomyFamilies();
  return (
    <>
      <PageHeader
        title="Taxonomy"
        actions={
          <TaxonomyActions
            families={families.map(({ id, name }) => ({ id, name }))}
          />
        }
      />
      <TaxonomyContent families={families} />
    </>
  );
}

export default function TaxonomyPage() {
  return (
    <Suspense fallback={<TaxonomySkeleton kind="directory" />}>
      <TaxonomyDirectory />
    </Suspense>
  );
}
