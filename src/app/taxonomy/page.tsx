import { Suspense } from "react";
import { Tags } from "lucide-react";
import { getTaxonomyFamilies } from "@/lib/actions/taxonomy-families";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { FamilyCard } from "@/components/taxonomy/family-card";

async function TaxonomyContent() {
  const families = await getTaxonomyFamilies();

  if (families.length === 0) {
    return (
      <EmptyState
        icon={Tags}
        title="No taxonomy families"
        description="Create taxonomy families to classify your works and editions"
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

export default function TaxonomyPage() {
  return (
    <>
      <PageHeader
        title="Taxonomy"
        description="Manage your classification system"
      />
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <TaxonomyContent />
      </Suspense>
    </>
  );
}
