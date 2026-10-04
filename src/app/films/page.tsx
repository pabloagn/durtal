import { DomainHome } from "@/components/domains/domain-home";
import type { ListSearchParams } from "@/lib/utils/pagination";

export const metadata = { title: "Films" };

export default async function FilmsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  return <DomainHome kind="film" searchParams={await searchParams} />;
}
