import Link from "next/link";
import { getPublishers } from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherFavourite } from "@/components/publishers/favourite-button";
const fieldClass =
  "rounded-sm border border-glass-border bg-bg-primary px-3 py-2 text-sm text-fg-primary";
export default async function PublishersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; favourites?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const { rows, total } = await getPublishers(
    params.q,
    params.favourites === "true",
    page,
  );
  const link = (n: number) =>
    `/publishers?${new URLSearchParams({ q: params.q ?? "", favourites: params.favourites ?? "", page: String(n) })}`;
  return (
    <>
      <PageHeader
        title="Publishers"
        description="Publishing houses and imprints you collect"
        actions={
          <Link href="/publishers/new" className="text-sm text-accent-blue">
            Add publisher
          </Link>
        }
      />
      <form className="mb-6 flex flex-wrap items-center gap-3">
        <input
          name="q"
          aria-label="Search publishers"
          placeholder="Search publishers…"
          className={`${fieldClass} max-w-sm`}
          defaultValue={params.q}
        />
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <input
            type="checkbox"
            name="favourites"
            value="true"
            defaultChecked={params.favourites === "true"}
          />
          Favourites
        </label>
        <button className="text-sm text-accent-blue">Search</button>
        <Link
          href="/publishers/review"
          className="ml-auto text-xs text-fg-muted"
        >
          Review unmatched editions
        </Link>
      </form>
      <p className="mb-3 text-xs text-fg-muted">
        {total} publishers · edition counts refer to your Durtal catalogue
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ publisher: p, editionCount }) => (
          <div
            key={p.id}
            className="flex items-start rounded-sm border border-glass-border bg-bg-secondary p-4"
          >
            <Link href={`/publishers/${p.slug}`} className="min-w-0 flex-1">
              <h2 className="font-serif text-xl">{p.name}</h2>
              <p className="mt-1 text-xs text-fg-muted">
                {[p.country, p.kind === "imprint" ? "Imprint" : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="mt-3 text-sm text-fg-secondary">
                {editionCount} edition{editionCount === 1 ? "" : "s"}
              </p>
            </Link>
            <PublisherFavourite id={p.id} favourite={p.isFavourite} />
          </div>
        ))}
      </div>
      {!rows.length && (
        <p className="py-10 text-fg-muted">
          No publishers match these filters.
        </p>
      )}
      <div className="mt-6 flex gap-4 text-sm text-accent-blue">
        {page > 1 && <Link href={link(page - 1)}>Previous</Link>}
        {page * 48 < total && <Link href={link(page + 1)}>Next</Link>}
      </div>
    </>
  );
}
