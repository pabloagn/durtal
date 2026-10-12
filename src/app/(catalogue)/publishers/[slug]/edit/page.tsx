import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import {
  getPublisher,
  getPublisherSpecialties,
} from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherEditor } from "@/components/publishers/publisher-editor";
/** One read per request for the page and its title */
const loadPublisher = cache(getPublisher);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const publisher = await loadPublisher((await params).slug);
  return { title: publisher ? `Edit ${publisher.name}` : "Publisher not found" };
}

export default async function EditPublisherPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [publisher, specialties] = await Promise.all([
    loadPublisher(slug),
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
