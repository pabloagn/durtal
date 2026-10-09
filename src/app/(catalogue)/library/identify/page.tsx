import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { getIdentifyQueue } from "@/lib/actions/identify";
import { IdentifyQueue } from "@/components/books/identify-queue";

export const metadata = { title: "Identify editions" };

export default async function IdentifyEditionsPage({
  searchParams,
}: {
  searchParams: Promise<{ edition?: string }>;
}) {
  const { edition } = await searchParams;
  const queue = await getIdentifyQueue();
  const withCopies = queue.filter((q) => q.copies.length > 0).length;
  const editions = `${queue.length} edition${queue.length === 1 ? "" : "s"}`;
  return (
    <>
      <Link href="/library" className="text-sm text-fg-secondary">
        ← Library
      </Link>
      <PageHeader
        title="Identify editions"
        description={
          queue.length
            ? `${editions} from the old import have no ISBN; ${withCopies} of them hold copies. Pick the edition you have: its copies and collections stay with it.`
            : "Every edition is identified."
        }
      />
      {queue.length > 0 && <IdentifyQueue items={queue} startAt={edition} />}
    </>
  );
}
