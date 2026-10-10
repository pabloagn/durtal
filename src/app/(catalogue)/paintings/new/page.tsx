import { PageHeader } from "@/components/layout/page-header";
import { PaintingForm } from "@/components/paintings/painting-form";
import { getPaintingChoices } from "@/lib/actions/paintings";

export const metadata = { title: "Add Painting" };

/** A new painting by hand; its original, versions and reproductions are added on its page. */
export default async function AddPaintingPage() {
  const choices = await getPaintingChoices();
  return (
    <>
      <PageHeader
        title="Add painting"
        description="The painting first; where the original is, and any print you own, go on its page"
      />
      <div className="max-w-3xl">
        <PaintingForm mode="create" choices={choices} />
      </div>
    </>
  );
}
