import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
      <Link
        href={`/publishers/${publisher.slug}`}
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to {publisher.name}
      </Link>
      <PageHeader title={`Edit ${publisher.name}`} />
      <PublisherEditor
        publisher={publisher}
        options={options}
        specialties={specialties}
      />
    </>
  );
}
