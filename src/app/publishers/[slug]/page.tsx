import { PaginatedSection } from "@/components/shared/pagination";
import { parsePagination, pageHref, lastPage, toSearchParams, type ListSearchParams } from "@/lib/utils/pagination";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getPublisher, getPublisherCatalogue } from "@/lib/actions/publishers";
import { getPublisherSuggestionSummary } from "@/lib/actions/publisher-names";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherFavourite } from "@/components/publishers/favourite-button";
import { Badge } from "@/components/ui/badge";
import { EditionCover } from "@/components/books/edition-cover";
import { languageName } from "@/lib/utils/language";
import { HOUSE_KIND_LABEL } from "@/lib/publishers/kinds";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";
export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const p = await getPublisher(slug);
  if (!p) notFound();
  const filterValue = toSearchParams(query).get("filter");
  const filter = ["all", "owned", "wanted", "on_order"].includes(
    filterValue ?? "",
  )
    ? filterValue!
    : "all";
  const { page, perPage } = parsePagination(query);
  const [{ rows, totals, pendingTargets }, suggested] = await Promise.all([
    getPublisherCatalogue(p.id, filter, page, perPage),
    getPublisherSuggestionSummary(p.id),
  ]);
  if (page > lastPage(totals.works, perPage)) redirect(pageHref(`/publishers/${slug}`, query, lastPage(totals.works, perPage)));
  const groups = Map.groupBy(rows, (r) => r.work.id);
  return (
    <>
      <CopyShortcuts name={p.name} />
      <Link href="/publishers" className="text-sm text-fg-secondary">
        ← Publishers
      </Link>
      <PageHeader
        title={p.name}
        description={[
          p.kind === "publisher" ? null : HOUSE_KIND_LABEL[p.kind],
          p.country,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-3">
            <PublisherFavourite id={p.id} favourite={p.isFavourite} />
            <Link
              href={`/publishers/${p.slug}/edit`}
              className="text-sm text-accent-blue"
            >
              Edit
            </Link>
          </div>
        }
      />
      <div className="mb-6 space-y-3 text-sm text-fg-secondary">
        {p.parent && (
          <p>
            {p.kind === "imprint" ? "Imprint of " : "Part of "}
            <Link
              href={`/publishers/${p.parent.slug}`}
              className="text-accent-blue"
            >
              {p.parent.name}
            </Link>
            {p.group && (
              <>
                {", part of "}
                <Link
                  href={`/publishers/${p.group.slug}`}
                  className="text-accent-blue"
                >
                  {p.group.name}
                </Link>
              </>
            )}
          </p>
        )}
        {p.website && /^https?:\/\//i.test(p.website) && (
          <a
            href={p.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue"
          >
            Visit publisher website ↗
          </a>
        )}
        {p.description && (
          <p className="max-w-3xl whitespace-pre-wrap">{p.description}</p>
        )}
        {p.notes && (
          <p className="max-w-3xl whitespace-pre-wrap border-l border-accent-rose pl-3">
            {p.notes}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {p.specialties.map((s) => (
            <Badge key={s.id} variant="muted">
              {s.name}
            </Badge>
          ))}
        </div>
        {p.createdFrom && (
          <p>
            Created automatically on{" "}
            <span className="font-mono">
              {p.createdFrom.createdAt.toISOString().slice(0, 10)}
            </span>{" "}
            from the book data name &ldquo;{p.createdFrom.name}&rdquo;.{" "}
            <Link href="/publishers/review" className="text-accent-blue">
              Undo in Publisher names
            </Link>
          </p>
        )}
        {p.aliases.length > 0 && (
          <p>Other names: {p.aliases.join(" · ")}</p>
        )}
        {p.isbnPrefixes.length > 0 && (
          <p>
            ISBN prefixes:{" "}
            <span className="font-mono">{p.isbnPrefixes.join(" · ")}</span>
          </p>
        )}
        {p.children.length > 0 && (
          <p>
            {p.kind === "group" ? "Publishers: " : "Imprints: "}
            {p.children.map((c, i) => (
              <span key={c.id}>
                {i > 0 ? " · " : ""}
                <Link
                  href={`/publishers/${c.slug}`}
                  className="text-accent-blue"
                >
                  {c.name}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
      <nav
        aria-label="Publisher catalogue filters"
        className="mb-4 flex flex-wrap gap-4 text-sm"
      >
        {[
          ["all", "All"],
          ["owned", "Owned"],
          ["wanted", "Wanted"],
          ["on_order", "On order"],
        ].map(([value, label]) => (
          <Link
            key={value}
            href={pageHref(`/publishers/${slug}`, { ...query, filter: value }, 1)}
            aria-current={filter === value ? "page" : undefined}
            className={
              filter === value
                ? "text-fg-primary border-b border-accent-rose"
                : "text-fg-secondary"
            }
          >
            {label}
          </Link>
        ))}
        <Link
          href={`/library?publisher=${p.id}`}
          className="ml-auto text-accent-blue"
        >
          View in library
        </Link>
      </nav>
      <p className="mb-4 text-xs text-fg-secondary">
        {totals.works} book{totals.works === 1 ? "" : "s"} · {totals.editions}{" "}
        edition{totals.editions === 1 ? "" : "s"} recorded in Durtal
      </p>
      {suggested.editions > 0 && (
        <p className="mb-4 text-sm text-fg-secondary">
          {suggested.editions} more edition{suggested.editions === 1 ? "" : "s"}{" "}
          without a publishing house look{suggested.editions === 1 ? "s" : ""}{" "}
          like {p.name}.{" "}
          <Link
            href={`/publishers/review?publisher=${p.slug}`}
            className="text-accent-blue"
          >
            Review
          </Link>
        </p>
      )}
      {pendingTargets.length > 0 && (
        <div className="mb-6 space-y-2">
          <SectionHeading title="Publisher preferences" />
          {pendingTargets.map((t) => (
            <div
              key={t.target.id}
              className="flex flex-wrap justify-between gap-2 border border-glass-border p-3 text-sm"
            >
              <Link href={`/library/${t.work.slug ?? t.work.id}`}>
                {t.work.title}
              </Link>
              <span className="text-fg-secondary">
                {t.publisher.name} · {t.state.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
      <PaginatedSection page={page} perPage={perPage} total={totals.works} noun="books">
      <div className="space-y-5">
        {[...groups].map(([id, items]) => (
          <section
            key={id}
            className="rounded-sm border border-glass-border p-4"
          >
            <Link
              href={`/library/${items[0].work.slug ?? id}`}
              className="type-item-title"
            >
              {items[0].work.title}
            </Link>
            {items[0].authors && (
              <p className="mt-1 text-sm text-fg-secondary">{items[0].authors}</p>
            )}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {items.map(({ edition: e, poster, owned, onOrder, wanted }) => (
                <div key={e.id} className="flex gap-3">
                  <EditionCover edition={e} poster={poster} title={e.title} />
                  <div className="space-y-1 text-sm">
                    <Link
                      href={`/library/${items[0].work.slug ?? id}#edition-${e.id}`}
                      className="text-accent-blue"
                    >
                      {e.title}
                    </Link>
                    <p className="text-fg-secondary">
                      {[
                        e.publisher,
                        e.imprint,
                        e.publicationYear,
                        languageName(e.language),
                        e.binding,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {e.isbn13 && (
                      <p className="font-mono text-xs text-fg-secondary">
                        {e.isbn13}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {owned && <Badge variant="sage">Owned edition</Badge>}
                      {onOrder && <Badge variant="blue">On order</Badge>}
                      {wanted && <Badge variant="gold">Wanted</Badge>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!rows.length && !pendingTargets.length && (
        <p className="py-10 text-fg-secondary">No editions match this view.</p>
      )}
      </PaginatedSection>
    </>
  );
}
