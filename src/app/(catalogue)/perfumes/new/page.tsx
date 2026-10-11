import { PageHeader } from "@/components/layout/page-header";
import { PerfumeForm } from "@/components/perfumes/perfume-form";

export const metadata = { title: "Add Perfume" };

/** A new fragrance by hand; its formulations, bottles and samples are added on its page. */
export default function AddPerfumePage() {
  return (
    <>
      <PageHeader
        title="Add perfume"
        description="The fragrance first; its concentrations, bottles and samples go on its page"
      />
      <div className="max-w-3xl">
        <PerfumeForm mode="create" />
      </div>
    </>
  );
}
