import { Suspense } from "react";
import { Tags } from "lucide-react";
import { getTaxonomyFamilies } from "@/lib/actions/taxonomy-families";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
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
        description="Create a family to classify your collections with your own terms"
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
        description="Manage your classification system"
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
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-6 w-6" />
        </div>
      }
    >
      <TaxonomyDirectory />
    </Suspense>
  );
}
