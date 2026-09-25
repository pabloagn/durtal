import Link from "next/link";
import {
  getPublisherReview,
  getEditionPublisherLinks,
} from "@/lib/actions/publishers";
import { EditionPublishers } from "@/components/publishers/edition-publishers";
import { PageHeader } from "@/components/layout/page-header";
export default async function ReviewPublisherMatches({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { rows, total } = await getPublisherReview(page);
  const links = await Promise.all(
    rows.map((r) => getEditionPublisherLinks(r.edition.id)),
  );
  return (
    <>
      <PageHeader
        title="Review publisher matches"
        description={`${total} edition${total === 1 ? " has" : "s have"} names that need review. Original metadata is preserved.`}
      />
      <Link href="/publishers" className="text-sm text-accent-blue">
        ← Publishers
      </Link>
      <div className="mt-5 space-y-3">
        {rows.map(({ edition: e, work: w }, i) => (
          <div key={e.id} className="space-y-2 border border-glass-border p-4">
            <Link
              href={`/library/${w.slug ?? w.id}#edition-${e.id}`}
              className="font-serif text-xl"
            >
              {w.title}
            </Link>
            <p className="text-sm text-fg-secondary">
              {[e.publisher, e.imprint, e.isbn13, e.publicationCountry]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <EditionPublishers
              editionId={e.id}
              confirmed={e.publisherLinksConfirmed}
              linked={links[i].map((l) => l.publisher)}
            />
          </div>
        ))}
      </div>
      {!rows.length && (
        <p className="mt-6 text-fg-muted">No unmatched publisher names.</p>
      )}
      <div className="mt-5 flex gap-4 text-sm text-accent-blue">
        {page > 1 && <Link href={`?page=${page - 1}`}>Previous</Link>}
        {page * 24 < total && <Link href={`?page=${page + 1}`}>Next</Link>}
      </div>
    </>
  );
}
