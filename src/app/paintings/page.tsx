import { DomainHome } from "@/components/domains/domain-home";
import type { ListSearchParams } from "@/lib/utils/pagination";

export default async function PaintingsPage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  return <DomainHome kind="painting" searchParams={await searchParams} />;
}
