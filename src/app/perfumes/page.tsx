import { DomainHome } from "@/components/domains/domain-home";
import type { ListSearchParams } from "@/lib/utils/pagination";

export default async function PerfumesPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  return <DomainHome kind="perfume" searchParams={await searchParams} />;
}
