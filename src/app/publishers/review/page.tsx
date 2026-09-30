import { redirect } from "next/navigation";
import Link from "next/link";
import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  pageHref,
  lastPage,
  toSearchParams,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { getPublisher } from "@/lib/actions/publishers";
import { getPublisherNameInbox } from "@/lib/actions/publisher-names";
import { PublisherNameInbox } from "@/components/publishers/publisher-name-inbox";
import { PageHeader } from "@/components/layout/page-header";

export default async function ReviewPublisherNames({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const query = await searchParams;
  const { page, perPage } = parsePagination(query);
  // ?publisher=<slug> keeps the names suggested for one house
  const slug = toSearchParams(query).get("publisher");
  const house = slug ? await getPublisher(slug) : null;
  const inbox = await getPublisherNameInbox({
    page,
    perPage,
    house: house?.id,
  });
  if (page > lastPage(inbox.total, perPage))
    redirect(pageHref("/publishers/review", query, lastPage(inbox.total, perPage)));
  const editions = `${inbox.editions} edition${inbox.editions === 1 ? "" : "s"}`;
  const names = `${inbox.total} name${inbox.total === 1 ? "" : "s"}`;
  return (
    <>
      <Link href="/publishers" className="text-sm text-fg-muted">
        ← Publishers
      </Link>
      <PageHeader
        title="Publisher names"
        description={
          house
            ? `${editions} without a publishing house look like ${house.name}.`
            : `${editions} without a publishing house carry ${names}. One decision per name links all its editions, now and in later imports.`
        }
      />
      {house && (
        <p className="mb-4 text-sm">
          <Link href="/publishers/review" className="text-accent-blue">
            Show every name
          </Link>
        </p>
      )}
      <PaginatedSection
        page={page}
        perPage={perPage}
        total={inbox.total}
        noun="names"
      >
        <PublisherNameInbox
          rows={inbox.rows}
          ignored={inbox.ignored}
          safe={inbox.safe}
          decisions={inbox.decisions}
        />
      </PaginatedSection>
    </>
  );
}
