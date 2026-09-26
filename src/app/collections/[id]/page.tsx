import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BookOpen } from "lucide-react";
import { getCollection } from "@/lib/actions/collections";
import {
  CollectionControls,
  CollectionMemberControls,
} from "@/components/collections/collection-controls";
import { CopyBookButton } from "@/components/books/copy-book-button";
import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const collection = await getCollection(id);
  if (!collection) notFound();
  const query = await searchParams;
  const { page, perPage, offset } = parsePagination(query);
  const total = collection.collectionEditions.length;
  if (page > lastPage(total, perPage))
    redirect(pageHref(`/collections/${id}`, query, lastPage(total, perPage)));
  const bookCount = new Set(
    collection.collectionEditions.map((m) => m.edition.workId),
  ).size;
  const poster =
    collection.posterS3Key ??
    collection.posterThumbnailS3Key ??
    collection.coverS3Key;
  return (
    <>
      <Link
        href="/collections"
        className="mb-6 inline-flex items-center gap-2 text-xs text-fg-muted"
      >
        <ArrowLeft size={14} />
        Back to collections
      </Link>
      <header className="relative mb-8 overflow-hidden rounded-sm border border-glass-border bg-bg-secondary">
        {collection.backgroundS3Key && (
          <>
            <img
              src={`/api/s3/read?key=${encodeURIComponent(collection.backgroundS3Key)}`}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-20"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-bg-primary/90 to-bg-primary/50" />
          </>
        )}
        <div className="relative flex flex-wrap items-start gap-6 p-6">
          {poster && (
            <img
              src={`/api/s3/read?key=${encodeURIComponent(poster)}`}
              alt={`${collection.name} collection artwork`}
              className="h-40 w-28 shrink-0 rounded-sm object-cover"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-serif text-4xl">
              {collection.name}
            </h1>
            {collection.description && (
              <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm text-fg-secondary">
                {collection.description}
              </p>
            )}
            <p className="my-4 text-xs text-fg-muted">
              {bookCount} {bookCount === 1 ? "book" : "books"} · {total}{" "}
              {total === 1 ? "edition" : "editions"}
            </p>
            <CollectionControls
              collection={collection}
              editionIds={collection.collectionEditions.map((m) => m.editionId)}
              initialAdd={query.add === "1"}
            />
          </div>
        </div>
      </header>
      {total ? (
        <PaginatedSection
          page={page}
          perPage={perPage}
          total={total}
          noun="editions"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {collection.collectionEditions
              .slice(offset, offset + perPage)
              .map((member, index) => {
                const e = member.edition;
                const work = e.work;
                const names = work.workAuthors.map((a) => a.author.name);
                const image =
                  e.thumbnailS3Key ??
                  e.coverS3Key ??
                  work.media[0]?.thumbnailS3Key ??
                  work.media[0]?.s3Key;
                return (
                  <article
                    key={e.id}
                    className="flex gap-4 rounded-sm border border-glass-border bg-bg-secondary p-4"
                  >
                    <Link
                      href={`/library/${work.slug ?? work.id}#edition-${e.id}`}
                      className="flex h-32 w-20 shrink-0 items-center justify-center rounded-sm bg-bg-primary"
                    >
                      {image ? (
                        <img
                          src={`/api/s3/read?key=${encodeURIComponent(image)}`}
                          alt={e.title}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <BookOpen size={24} className="text-fg-muted" />
                      )}
                    </Link>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/library/${work.slug ?? work.id}#edition-${e.id}`}
                        className="font-serif text-xl"
                      >
                        {e.title}
                      </Link>
                      <p className="mt-1 text-sm text-fg-secondary">
                        {names.join(" & ")}
                      </p>
                      <p className="mt-2 text-xs text-fg-muted">
                        {[e.publisher, e.publicationYear, e.language, e.binding]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {e.isbn13 && (
                        <p className="mt-1 font-mono text-xs text-fg-muted">
                          {e.isbn13}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between">
                        <CopyBookButton
                          title={work.title}
                          authorNames={names}
                        />
                        <CollectionMemberControls
                          collectionId={id}
                          editionId={e.id}
                          title={e.title}
                          first={offset + index === 0}
                          last={offset + index === total - 1}
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
          </div>
        </PaginatedSection>
      ) : (
        <div className="rounded-sm border border-dashed border-glass-border px-6 py-14 text-center">
          <BookOpen
            className="mx-auto mb-3 text-fg-muted"
            size={24}
            strokeWidth={1}
          />
          <h2 className="font-serif text-2xl">Build your collection</h2>
          <p className="mt-2 text-sm text-fg-muted">
            Use Add books above, or select books in your library and choose
            Collections.
          </p>
        </div>
      )}
    </>
  );
}
