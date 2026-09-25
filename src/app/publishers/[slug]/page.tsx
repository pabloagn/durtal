import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getPublisher, getPublisherCatalogue } from "@/lib/actions/publishers";
import { PageHeader } from "@/components/layout/page-header";
import { PublisherFavourite } from "@/components/publishers/favourite-button";
import { Badge } from "@/components/ui/badge";
export default async function PublisherPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const p = await getPublisher(slug);
  if (!p) notFound();
  const filter = ["all", "owned", "wanted", "on_order"].includes(
    query.filter ?? "",
  )
    ? query.filter!
    : "all";
  const page = Math.max(1, Number(query.page) || 1);
  const { rows, totals, pendingTargets } = await getPublisherCatalogue(
    p.id,
    filter,
    page,
  );
  const groups = Map.groupBy(rows, (r) => r.work.id);
  const href = (n: number) => `/publishers/${slug}?filter=${filter}&page=${n}`;
  return (
    <>
      <Link href="/publishers" className="text-sm text-fg-muted">
        ← Publishers
      </Link>
      <PageHeader
        title={p.name}
        description={[p.country, p.kind === "imprint" ? "Imprint" : null]
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
            Published by{" "}
            <Link
              href={`/publishers/${p.parent.slug}`}
              className="text-accent-blue"
            >
              {p.parent.name}
            </Link>
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
        {p.children.length > 0 && (
          <p>
            Imprints:{" "}
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
            href={`/publishers/${slug}?filter=${value}`}
            aria-current={filter === value ? "page" : undefined}
            className={
              filter === value
                ? "text-fg-primary border-b border-accent-rose"
                : "text-fg-muted"
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
      <p className="mb-4 text-xs text-fg-muted">
        {totals.works} book{totals.works === 1 ? "" : "s"} · {totals.editions}{" "}
        edition{totals.editions === 1 ? "" : "s"} recorded in Durtal
      </p>
      {pendingTargets.length > 0 && (
        <div className="mb-6 space-y-2">
          <h2 className="font-serif text-xl">Publisher preferences</h2>
          {pendingTargets.map((t) => (
            <div
              key={t.target.id}
              className="flex flex-wrap justify-between gap-2 border border-glass-border p-3 text-sm"
            >
              <Link href={`/library/${t.work.slug ?? t.work.id}`}>
                {t.work.title}
              </Link>
              <span className="text-fg-muted">
                {t.publisher.name} · {t.state.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-5">
        {[...groups].map(([id, items]) => (
          <section
            key={id}
            className="rounded-sm border border-glass-border p-4"
          >
            <Link
              href={`/library/${items[0].work.slug ?? id}`}
              className="font-serif text-xl"
            >
              {items[0].work.title}
            </Link>
            {items[0].authors && (
              <p className="mt-1 text-sm text-fg-muted">{items[0].authors}</p>
            )}
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {items.map(({ edition: e, owned, onOrder, wanted }) => (
                <div key={e.id} className="flex gap-3">
                  {e.thumbnailS3Key || e.coverS3Key ? (
                    <Image
                      src={`/api/s3/read?key=${encodeURIComponent((e.thumbnailS3Key ?? e.coverS3Key)!)}`}
                      alt={e.title}
                      width={64}
                      height={96}
                      className="h-24 w-16 object-contain"
                      unoptimized
                    />
                  ) : (
                    <div className="flex h-24 w-16 shrink-0 items-center justify-center bg-bg-secondary text-xs text-fg-muted">
                      No cover
                    </div>
                  )}
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
                        e.language,
                        e.binding,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {e.isbn13 && (
                      <p className="font-mono text-xs text-fg-muted">
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
        <p className="py-10 text-fg-muted">No editions match this view.</p>
      )}
      <div className="mt-6 flex gap-4 text-sm text-accent-blue">
        {page > 1 && <Link href={href(page - 1)}>Previous</Link>}
        {page * 24 < totals.works && <Link href={href(page + 1)}>Next</Link>}
      </div>
    </>
  );
}
