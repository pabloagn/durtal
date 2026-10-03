import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
      <Link
        href="/publishers"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to publishers
      </Link>
      <PageHeader title="Add publisher" />
      <PublisherEditor options={options} specialties={specialties} />
    </>
  );
}
