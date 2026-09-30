import { notFound } from "next/navigation";
import {
  getPublisher,
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
  const [publisher, specialties] = await Promise.all([
    getPublisher(slug),
    getPublisherSpecialties(),
  ]);
  if (!publisher) notFound();
  return (
    <>
      <PageHeader title={`Edit ${publisher.name}`} />
      <PublisherEditor
        publisher={publisher}
        parent={publisher.parent}
        specialties={specialties}
      />
    </>
  );
}
