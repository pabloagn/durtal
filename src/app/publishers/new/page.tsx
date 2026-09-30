import { getPublisherSpecialties } from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherEditor } from "@/components/publishers/publisher-editor";
export default async function NewPublisherPage() {
  const specialties = await getPublisherSpecialties();
  return (
    <>
      <PageHeader title="Add publisher" />
      <PublisherEditor specialties={specialties} />
    </>
  );
}
