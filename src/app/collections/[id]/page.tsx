import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BookOpen, FolderOpen } from "lucide-react";
import { getCollection } from "@/lib/actions/collections";
import {
  CollectionControls,
  CollectionMemberControls,
} from "@/components/collections/collection-controls";
import { CopyBookButton } from "@/components/books/copy-book-button";
import { EditionCard } from "@/components/books/edition-card";
import {
  collectionBackground,
  collectionPoster,
} from "@/components/collections/collection-card";
import { FullBleedLayer } from "@/components/shared/full-bleed-layer";
import { CollectionIcon } from "@/components/collections/collection-icon";
import { CollectionIconPicker } from "@/components/collections/collection-icon-picker";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";

function imageUrl(key: string) {
  return `/api/s3/read?key=${encodeURIComponent(key)}`;
}
import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { CapAligned } from "@/components/shared/cap-aligned";

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
  const poster = collectionPoster(collection.media);
  const background = collectionBackground(collection.media);
  return (
    <>
      {/* Cinematic backdrop + header, as on author and book pages */}
      <div className={background ? "relative -mx-6 -mt-6 mb-8" : "mb-8"}>
        {background && (
          <FullBleedLayer className="-z-0">
            <img
              src={imageUrl(background.s3Key)}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(background))}
            />
            <div className="absolute inset-0 bg-black/70" />
            <div
              className="absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(to top, var(--color-bg-primary) 0%, var(--color-bg-primary) 5%, transparent 100%)",
              }}
            />
          </FullBleedLayer>
        )}
        <div className={background ? "relative z-10 px-6 pt-6 pb-2" : ""}>
          <Link
            href="/collections"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to collections
          </Link>
          <header className="mb-6 flex flex-wrap items-start gap-8">
            <div className="h-64 w-48 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
              {poster ? (
                <img
                  src={imageUrl(poster.s3Key)}
                  alt={`${collection.name} poster`}
                  className="protected-image h-full w-full object-cover"
                  style={mediaImageStyle(mediaCrop(poster))}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2">
                  <FolderOpen
                    className="h-10 w-10 text-fg-muted/20"
                    strokeWidth={1}
                  />
                  <span className="font-serif text-5xl text-fg-muted/20">
                    {collection.name[0]}
                  </span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 basis-64">
              {/* The row carries the title's type: the icon sits on the
                  title's cap-height center (first line) */}
              <div className="-ml-2 flex items-start gap-1.5 font-serif text-4xl tracking-tight">
                <CapAligned height={44}>
                  <CollectionIconPicker
                    collectionId={collection.id}
                    value={collection.icon}
                  >
                    <CollectionIcon
                      icon={collection.icon}
                      className="h-7 w-7"
                      absoluteStrokeWidth
                    />
                  </CollectionIconPicker>
                </CapAligned>
                <h1 className="min-w-0 break-words font-serif text-4xl tracking-tight text-fg-primary">
                  {collection.name}
                </h1>
              </div>
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
                editionIds={collection.collectionEditions.map(
                  (m) => m.editionId,
                )}
                initialAdd={query.add === "1"}
              />
            </div>
          </header>
        </div>
      </div>
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
                  <EditionCard
                    key={e.id}
                    href={`/library/${work.slug ?? work.id}#edition-${e.id}`}
                    title={e.title}
                    imageKey={image}
                    authorNames={names}
                    details={[
                      e.publisher,
                      e.publicationYear,
                      e.language,
                      e.binding,
                    ]}
                    isbn={e.isbn13}
                    footer={
                      <>
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
                      </>
                    }
                  />
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
