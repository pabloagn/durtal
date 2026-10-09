import type { Metadata } from "next";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { cache } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, BookOpen, FolderOpen } from "lucide-react";
import { getCollection } from "@/lib/actions/collections";
import { loadFilmCards } from "@/lib/catalogue/film-store";
import { loadPerfumeCards } from "@/lib/catalogue/perfume-store";
import { loadPaintingCards } from "@/lib/catalogue/painting-store";
import { catalogueDateYears } from "@/lib/catalogue/dates";
import { WORK_DOMAINS } from "@/lib/catalogue/domains";
import { MemberCard } from "@/components/collections/member-card";
import { readingStatesFor } from "@/lib/reading/states";
import { readingBadge } from "@/lib/reading/card";
import { FilmPoster } from "@/components/films/film-poster";
import { filmDirectors, filmFacts, filmHref } from "@/components/films/film-card";
import { PerfumeImage } from "@/components/perfumes/perfume-image";
import { perfumeFacts, perfumeHref, perfumeMakers } from "@/components/perfumes/perfume-card";
import { PaintingImage } from "@/components/paintings/painting-image";
import { paintingFacts, paintingHref, paintingPainters } from "@/components/paintings/painting-card";
import {
  CollectionControls,
  CollectionMemberControls,
} from "@/components/collections/collection-controls";
import { CopyBookButton } from "@/components/books/copy-book-button";
import {
  collectionBackground,
  collectionPoster,
} from "@/components/collections/collection-card";
import { FullBleedLayer } from "@/components/shared/full-bleed-layer";
import { CollectionIcon } from "@/components/collections/collection-icon";
import { CollectionIconPicker } from "@/components/collections/collection-icon-picker";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";

import { PaginatedSection } from "@/components/shared/pagination";
import {
  parsePagination,
  lastPage,
  pageHref,
  type ListSearchParams,
} from "@/lib/utils/pagination";
import { CapAligned } from "@/components/shared/cap-aligned";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { Prose } from "@/components/shared/prose";
import { mediaUrl } from "@/lib/s3/media-url";

type Collection = NonNullable<Awaited<ReturnType<typeof getCollection>>>;

interface Member {
  kind: "edition" | "work";
  id: string;
  sortOrder: number;
  addedAt: Date;
  card: Omit<React.ComponentProps<typeof MemberCard>, "actions">;
  /** Copy title and author, for books */
  copy?: React.ReactNode;
}

const cover = (key: string | null | undefined, alt: string) =>
  key ? (
    <img
      src={mediaUrl(key)}
      alt={alt}
      className="max-h-32 w-full object-contain"
    />
  ) : (
    <BookOpen size={24} className="mx-auto text-fg-muted" />
  );

/**
 * Every member the page shows, in the collection's one order: each edition,
 * and each whole work except a book that also has an edition here (the
 * edition stands for it and says so).
 */
async function collectionMembers(
  collection: Collection,
  reading: Awaited<ReturnType<typeof readingStatesFor>>,
): Promise<Member[]> {
  // A book's reading on its card's note line (SLN-449)
  const state = (workId: string) => readingBadge(reading.get(workId))?.label ?? null;
  const editionWorks = new Set(collection.collectionEditions.map((m) => m.edition.workId));
  const wholeWorks = collection.collectionWorks.filter((m) => !editionWorks.has(m.workId));
  const heldAsWork = new Set(collection.collectionWorks.map((m) => m.workId));
  const ofKind = (kind: string) =>
    wholeWorks.filter((m) => m.work.kind === kind).map((m) => m.workId);
  const [films, perfumes, paintings] = await Promise.all([
    loadFilmCards(ofKind("film")),
    loadPerfumeCards(ofKind("perfume")),
    loadPaintingCards(ofKind("painting")),
  ]);

  const editionMembers: Member[] = collection.collectionEditions.map((member) => {
    const e = member.edition;
    const work = e.work;
    const names = work.workAuthors.map((a) => a.author.name);
    return {
      kind: "edition",
      id: e.id,
      sortOrder: member.sortOrder,
      addedAt: member.addedAt,
      card: {
        href: `/library/${work.slug ?? work.id}#edition-${e.id}`,
        image: cover(
          e.thumbnailS3Key ?? e.coverS3Key ?? work.media[0]?.thumbnailS3Key ?? work.media[0]?.s3Key,
          e.title,
        ),
        title: e.title,
        byline: names.join(" & "),
        facts: [e.publisher, e.publicationYear, e.language, e.binding].filter(Boolean).join(" · "),
        // A book held both ways shows as its edition, and says so
        note: [e.isbn13, heldAsWork.has(work.id) ? "also collected as the book" : null, state(work.id)].filter(Boolean).join(" · ") || null,
        noteMono: true,
      },
      copy: <CopyBookButton title={work.title} authorNames={names} />,
    };
  });

  const workMembers: Member[] = wholeWorks.flatMap((member): Member[] => {
    const w = member.work;
    const base = { kind: "work" as const, id: w.id, sortOrder: member.sortOrder, addedAt: member.addedAt };
    const label = WORK_DOMAINS[w.kind].label;
    if (w.kind === "book") {
      const names = w.workAuthors.map((a) => a.author.name);
      return [
        {
          ...base,
          card: {
            href: `/library/${w.slug ?? w.id}`,
            image: cover(w.media[0]?.thumbnailS3Key ?? w.media[0]?.s3Key, w.title),
            title: w.title,
            byline: names.join(" & "),
            facts: "The book, no edition chosen",
            note: [label, state(w.id)].filter(Boolean).join(" · "),
          },
          copy: <CopyBookButton title={w.title} authorNames={names} />,
        },
      ];
    }
    if (w.kind === "film") {
      const film = films.find((f) => f.id === w.id);
      if (!film) return [];
      return [
        {
          ...base,
          card: {
            href: filmHref(film),
            image: (
              <FilmPoster
                image={film.poster}
                title={film.title}
                year={catalogueDateYears(film.releaseDate)}
                small
              />
            ),
            title: film.title,
            byline: filmDirectors(film),
            facts: filmFacts(film) || null,
            note: label,
          },
        },
      ];
    }
    if (w.kind === "perfume") {
      const perfume = perfumes.find((p) => p.id === w.id);
      if (!perfume) return [];
      return [
        {
          ...base,
          card: {
            href: perfumeHref(perfume),
            image: <PerfumeImage image={perfume.poster} title={perfume.title} small />,
            title: perfume.title,
            byline: perfumeMakers(perfume),
            facts: perfumeFacts(perfume) || null,
            note: label,
          },
        },
      ];
    }
    const painting = paintings.find((p) => p.id === w.id);
    if (!painting) return [];
    return [
      {
        ...base,
        card: {
          href: paintingHref(painting),
          image: <PaintingImage image={painting.poster} title={painting.title} small />,
          title: painting.title,
          byline: paintingPainters(painting),
          facts: paintingFacts(painting) || null,
          note: label,
        },
      },
    ];
  });

  // The same order as the database: position, then when added, then id
  return [...editionMembers, ...workMembers].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.addedAt.getTime() - b.addedAt.getTime() ||
      a.kind.localeCompare(b.kind) ||
      a.id.localeCompare(b.id),
  );
}

/** "3 books · 4 editions · 2 films": a book collected both ways counts once */
function collectionBookIds(collection: Collection) {
  return [
    ...new Set([
      ...collection.collectionEditions.map((m) => m.edition.workId),
      ...collection.collectionWorks.filter((m) => m.work.kind === "book").map((m) => m.workId),
    ]),
  ];
}

function memberCounts(collection: Collection, reading: Awaited<ReturnType<typeof readingStatesFor>>) {
  const bookIds = collectionBookIds(collection);
  const books = bookIds.length;
  // Read: a finished reading at least, so a book being re-read counts (SLN-449)
  const read = bookIds.filter((id) => (reading.get(id)?.timesRead ?? 0) >= 1).length;
  const of = (kind: string) => collection.collectionWorks.filter((m) => m.work.kind === kind).length;
  const editionCount = collection.collectionEditions.length;
  const parts: [number, string, string][] = [
    [books, "book", "books"],
    [editionCount, "edition", "editions"],
    [of("film"), "film", "films"],
    [of("perfume"), "perfume", "perfumes"],
    [of("painting"), "painting", "paintings"],
  ];
  const shown = parts.filter(([n]) => n > 0);
  if (!shown.length) return "Nothing yet";
  const counts = shown.map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  if (read) counts.push(`${read} of ${books} ${books === 1 ? "book" : "books"} read`);
  return counts.join(" · ");
}

/** One read per request for the page and its title */
const loadCollection = cache(getCollection);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const collection = z.string().uuid().safeParse(id).success
    ? await loadCollection(id)
    : null;
  return { title: collection?.name ?? "Collection not found" };
}

export default async function CollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const collection = await loadCollection(id);
  if (!collection) notFound();
  const query = await searchParams;
  const { page, perPage, offset } = parsePagination(query);
  const reading = await readingStatesFor(collectionBookIds(collection));
  const members = await collectionMembers(collection, reading);
  const total = members.length;
  if (page > lastPage(total, perPage))
    redirect(pageHref(`/collections/${id}`, query, lastPage(total, perPage)));
  const counts = memberCounts(collection, reading);
  const poster = collectionPoster(collection.media);
  const background = collectionBackground(collection.media);
  return (
    <>
      <CopyShortcuts name={collection.name} />
      {/* Cinematic backdrop + header, as on author and book pages */}
      <div className={background ? "relative -mx-4 -mt-6 mb-8 md:-mx-6" : "mb-8"}>
        {background && (
          <FullBleedLayer className="-z-0">
            <img
              src={mediaUrl(background.s3Key)}
              alt=""
              className="protected-image h-full w-full object-cover"
              style={mediaImageStyle(mediaCrop(background))}
            />
            <div className="absolute inset-0 bg-scrim" />
            <div
              className="absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(to top, var(--color-bg-primary) 0%, var(--color-bg-primary) 5%, transparent 100%)",
              }}
            />
          </FullBleedLayer>
        )}
        <div className={background ? "relative z-10 px-4 pt-6 pb-2 md:px-6" : ""}>
          <Link
            href="/collections"
            className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
          >
            <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
            Back to collections
          </Link>
          <header className="mb-6 flex flex-wrap items-start gap-8">
            <div className="h-64 w-48 shrink-0 overflow-hidden rounded-sm bg-bg-tertiary">
              {poster ? (
                <img
                  src={mediaUrl(poster.s3Key)}
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
                  <span
                    aria-hidden="true"
                    data-decorative
                    className="font-serif text-4xl text-fg-muted/20"
                  >
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
                <h1 className="type-page-title min-w-0 break-words">
                  {collection.name}
                </h1>
                <CapAligned height={32} coarseHeight={44} className="ml-1.5 pointer-coarse:ml-0">
                  <FavouriteToggle
                    favourite={collection.isFavourite}
                    target={{ entity: "collection", id: collection.id }}
                    name={collection.name}
                    shortcut
                  />
                </CapAligned>
              </div>
              {collection.description && (
                <Prose className="mt-3 whitespace-pre-wrap">
                  {collection.description}
                </Prose>
              )}
              <p className="my-4 text-xs text-fg-secondary">{counts}</p>
              <CollectionControls
                collection={collection}
                editionIds={collection.collectionEditions.map(
                  (m) => m.editionId,
                )}
                workIds={collection.collectionWorks.map((m) => m.workId)}
                kinds={[
                  ...collectionBookIds(collection).map(() => "book" as const),
                  ...collection.collectionWorks
                    .filter((m) => m.work.kind !== "book")
                    .map((m) => m.work.kind),
                ]}
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
          noun="items"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {members.slice(offset, offset + perPage).map((member, index) => (
              <MemberCard
                key={`${member.kind}:${member.id}`}
                {...member.card}
                actions={
                  <>
                    {member.copy ?? <span />}
                    <CollectionMemberControls
                      collectionId={id}
                      member={{ kind: member.kind, id: member.id }}
                      title={member.card.title}
                      first={offset + index === 0}
                      last={offset + index === total - 1}
                    />
                  </>
                }
              />
            ))}
          </div>
        </PaginatedSection>
      ) : (
        <div className="rounded-sm border border-dashed border-glass-border px-6 py-14 text-center">
          <BookOpen
            className="mx-auto mb-3 text-fg-muted"
            size={24}
            strokeWidth={1}
          />
          <h2 className="type-item-title">Build your collection</h2>
        </div>
      )}
    </>
  );
}
