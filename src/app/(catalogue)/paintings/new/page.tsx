import { PageHeader } from "@/components/layout/page-header";
import { PaintingForm } from "@/components/paintings/painting-form";
import { getPaintingChoices } from "@/lib/actions/paintings";

export const metadata = { title: "Add painting" };

/** A new painting by hand; its original, versions and reproductions are added on its page. */
export default async function AddPaintingPage() {
  const choices = await getPaintingChoices();
  return (
    <>
      <PageHeader
        title="Add painting"
      />
      <div className="max-w-3xl">
        <PaintingForm mode="create" choices={choices} />
      </div>
    </>
  );
}
