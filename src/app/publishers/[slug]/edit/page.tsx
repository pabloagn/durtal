import { notFound } from "next/navigation";
import {
  getPublisher,
  getPublisherOptions,
  getPublisherSpecialties,
} from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherEditor } from "@/components/publishers/publisher-editor";
export default async function EditPublisherPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [publisher, options, specialties] = await Promise.all([
    getPublisher(slug),
    getPublisherOptions(),
    getPublisherSpecialties(),
  ]);
  if (!publisher) notFound();
  return (
    <>
      <PageHeader title={`Edit ${publisher.name}`} />
      <PublisherEditor
        publisher={publisher}
        options={options}
        specialties={specialties}
      />
    </>
  );
}
