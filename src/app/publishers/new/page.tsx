import {
  getPublisherOptions,
  getPublisherSpecialties,
} from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherEditor } from "@/components/publishers/publisher-editor";
export default async function NewPublisherPage() {
  const [options, specialties] = await Promise.all([
    getPublisherOptions(),
    getPublisherSpecialties(),
  ]);
  return (
    <>
      <PageHeader title="Add publisher" />
      <PublisherEditor options={options} specialties={specialties} />
    </>
  );
}
