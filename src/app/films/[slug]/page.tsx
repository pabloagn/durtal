import { cache } from "react";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { renderStamp } from "@/lib/activity/render-stamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { Prose } from "@/components/shared/prose";
import { GallerySection } from "@/components/shared/gallery-section";
import {
  DetailColumns,
  RecordField,
  RecordFields,
  RecordGroup,
  RecordPanel,
} from "@/components/shared/detail-layout";
import { TaxonomyAssignments } from "@/components/taxonomy/taxonomy-assignments";
import {
  CurationProvider,
  CurationFavourite,
  PersonalNotes,
  RatingControl,
} from "@/components/catalogue/curation";
import { LinkedWorksSection } from "@/components/catalogue/work-relations";
import { getWorkRelations } from "@/lib/actions/work-relations";
import { SourcesSection } from "@/components/catalogue/sources-section";
import { FilmSourceLookup } from "@/components/films/source-lookup";
import { FilmPoster } from "@/components/films/film-poster";
import { FilmActions } from "@/components/films/film-actions";
import { CastSection, CrewSection, type CreditView } from "@/components/films/film-credits";
import { VersionsSection, type VersionView } from "@/components/films/versions-section";
import { WantedSection } from "@/components/catalogue/wanted-section";
import { getTypedTargets } from "@/lib/actions/acquisitions";
import { CopiesSection, type CopyView } from "@/components/films/copies-section";
import type { CopyLocation, VersionChoice } from "@/components/films/copy-dialog";
import { RelatedFilms } from "@/components/films/related-films";
import type { FilmCreditEntry } from "@/components/films/film-fields";
import { getFilm, getFilmChoices, getRelatedFilms } from "@/lib/actions/films";
import { getWorkCuration } from "@/lib/actions/curation";
import { getCatalogueProvenance } from "@/lib/actions/catalogue-provenance";
import { getTaxonomyAssignments } from "@/lib/actions/taxonomy-families";
import { getMediaForWork } from "@/lib/actions/media";
import { getLocations } from "@/lib/actions/locations";
import { catalogueDateText, catalogueDateYears } from "@/lib/catalogue/dates";
import {
  FILM_CREDIT_ROLE_IDS,
  FILM_GENRES_FAMILY,
  FILM_MEDIUM_LABELS,
  FILM_RELEASE_FORMAT_LABELS,
  HOLDING_STATUS_LABELS,
  creditHeading,
  filmCreditName,
  filmHoldingsText,
  formatRuntime,
  otherClassificationIds,
  releaseTerritory,
  versionName,
  type FilmCreditRole,
} from "@/lib/catalogue/film-labels";
import { formatPrice } from "@/lib/catalogue/perfume-labels";
import { sourceChoices, sourceViews } from "@/lib/catalogue/source-views";
import { mediaCrop, mediaImageStyle } from "@/lib/utils/media-style";
import type { ListSearchParams } from "@/lib/utils/pagination";
import { mediaUrl } from "@/lib/s3/media-url";

/** One read per request for the page and its title */
const loadFilm = cache((slug: string) => getFilm(decodeURIComponent(slug)));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const film = await loadFilm((await params).slug);
  return { title: film?.title ?? "Film not found" };
}

type Film = NonNullable<Awaited<ReturnType<typeof getFilm>>>;
type Credit = Film["credits"][number];

/** A credit as the page lists it; directors and cast link to their films */
function creditView(credit: Credit): CreditView {
  const filter =
    credit.roleId === "film.director" ? "director" : credit.roleId === "film.cast" ? "cast" : null;
  return {
    id: credit.id,
    href: credit.personId && filter ? `/films?${filter}=${credit.personId}` : null,
    name: filmCreditName(credit),
    unnamed: !credit.person && !credit.creditedAs,
    creditedAs: credit.person && credit.creditedAs ? credit.creditedAs : null,
    characters: credit.characters,
  };
}

/** "John Carpenter, Christian Nyby" as links into the filtered home */
function PeopleLinks({ people }: { people: CreditView[] }) {
  return (
    <>
      {people.map((person, i) => (
        <span key={person.id}>
          {i > 0 && ", "}
          {person.href ? (
            <Link href={person.href} className="transition-colors hover:text-accent-rose-text">
              {person.name}
            </Link>
          ) : (
            <span className={person.unnamed ? "text-fg-secondary" : undefined}>{person.name}</span>
          )}
        </span>
      ))}
    </>
  );
}

/**
 * A film: the still behind its poster and title, who made it and when, then
 * the synopsis, cast and crew, versions with their releases, the copies
 * held, sources and personal notes beside the record (details and genres),
 * and films to look at next.
 */
export default async function FilmPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const film = await loadFilm(slug);
  if (!film) notFound();
  const owner = { kind: "film" as const, id: film.id };
  const [media, curation, provenance, related, genres, allLocations, choices, links, wanted] =
    await Promise.all([
      getMediaForWork(film.id),
      getWorkCuration(owner),
      getCatalogueProvenance({ owner, limit: 100 }),
      getRelatedFilms(film.id),
      getTaxonomyAssignments({ kind: "film", level: "work", ownerId: film.id }),
      getLocations(),
      getFilmChoices(),
      getWorkRelations(film.id),
      getTypedTargets(film.id),
    ]);

  // ── Images ────────────────────────────────────────────────────────────────
  const poster = media.find((m) => m.type === "poster" && m.isActive);
  const still = media.find((m) => m.type === "background" && m.isActive);
  const posterImage = poster
    ? {
        ...poster,
        tone:
          (poster.colorPalette as { dominant?: { hex?: string } } | null)?.dominant?.hex ?? null,
      }
    : null;
  const counts = {
    posters: media.filter((m) => m.type === "poster").length,
    stills: media.filter((m) => m.type === "background").length,
    gallery: media.filter((m) => m.type === "gallery").length,
  };
  const mediaLine = (
    [
      [counts.posters, "poster", "posters"],
      [counts.stills, "still", "stills"],
      [counts.gallery, "gallery image", "gallery images"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`)
    .join(" · ");

  // ── Cast and crew ─────────────────────────────────────────────────────────
  const byRole = (roleId: FilmCreditRole) =>
    film.credits.filter((c) => c.roleId === roleId).map(creditView);
  const directors = byRole("film.director");
  const writers = byRole("film.screenwriter");
  const cast = byRole("film.cast");
  // The header names the first three billed by name; the Cast section has all
  const starring = cast.filter((c) => !c.unnamed).slice(0, 3);
  const crew = FILM_CREDIT_ROLE_IDS.filter(
    (role) => role !== "film.cast" && role !== "film.director" && role !== "film.screenwriter",
  )
    .map((roleId) => ({ roleId, people: byRole(roleId) }))
    .filter((role) => role.people.length)
    .map((role) => ({ ...role, heading: creditHeading(role.roleId, role.people.length) }));
  const released = catalogueDateText(film.releaseDate?.value ?? null);
  const year = catalogueDateYears(film.releaseDate?.value ?? null);
  const runtimes = film.versions.filter((v) => v.runtimeSeconds !== null);
  const runtime = runtimes.length
    ? runtimes.length === 1 || runtimes.every((v) => v.runtimeSeconds === runtimes[0].runtimeSeconds)
      ? formatRuntime(runtimes[0].runtimeSeconds)
      : runtimes.map((v) => `${formatRuntime(v.runtimeSeconds)} (${versionName(v)})`).join(", ")
    : null;

  // ── Sources ───────────────────────────────────────────────────────────────
  const cited = new Set(
    [
      film.sourceRecordId,
      ...film.organizations.map((o) => o.sourceRecordId),
      ...film.versions.flatMap((v) => [v.sourceRecordId, ...v.releases.map((r) => r.sourceRecordId)]),
      // A link starting here cites a source of this film
      ...links.filter((l) => l.direction === "outgoing").map((l) => l.source?.id),
    ].filter((id): id is string => !!id),
  );
  const sources = sourceViews(provenance, cited);
  const citable = sourceChoices(provenance);

  // ── Versions and copies ───────────────────────────────────────────────────
  const locations: CopyLocation[] = allLocations.flatMap((l) =>
    l.type === "physical" || l.type === "digital"
      ? [
          {
            id: l.id,
            name: l.name,
            type: l.type,
            subLocations: l.subLocations.map((s) => ({ id: s.id, name: s.name })),
          },
        ]
      : [],
  );
  const releaseLine = (r: Film["versions"][number]["releases"][number]) =>
    [
      releaseTerritory(r),
      FILM_RELEASE_FORMAT_LABELS[r.format],
      catalogueDateText(r.releaseDate?.value ?? null),
      r.distributorName,
    ]
      .filter(Boolean)
      .join(" · ");
  const versionChoices: VersionChoice[] = film.versions.map((v) => ({
    id: v.id,
    label: versionName(v),
    releases: v.releases.map((r) => ({ id: r.id, label: releaseLine(r) })),
  }));
  const versions: VersionView[] = film.versions.map((v) => ({
    id: v.id,
    name: versionName(v),
    runtime: formatRuntime(v.runtimeSeconds),
    notes: v.notes,
    releases: v.releases.map((r) => ({ id: r.id, line: releaseLine(r), notes: r.notes })),
    copies: film.holdings.filter(
      (h) => h.versionId === v.id || v.releases.some((r) => r.id === h.releaseId),
    ).length,
    editable: {
      id: v.id,
      fingerprint: v.fingerprint,
      label: v.label,
      runtimeSeconds: v.runtimeSeconds,
      notes: v.notes,
      sourceRecordId: v.sourceRecordId,
      releases: v.releases.map((r) => ({
        id: r.id,
        country: r.countryId ? { id: r.countryId, label: r.countryName ?? "Country" } : null,
        territoryLabel: r.territoryLabel,
        format: r.format,
        releaseDate: r.releaseDate?.value ?? null,
        distributor: r.distributorId
          ? { id: r.distributorId, label: r.distributorName ?? "Distributor" }
          : null,
        notes: r.notes,
        sourceRecordId: r.sourceRecordId,
      })),
    },
  }));
  const held = film.holdings.filter((h) => h.status !== "disposed");
  const heldSummary = filmHoldingsText({
    physical: held.filter((h) => h.medium === "physical").length,
    digital: held.filter((h) => h.medium === "digital").length,
  });
  const copies: CopyView[] = [...film.holdings]
    .sort((a, b) => Number(a.status === "disposed") - Number(b.status === "disposed"))
    .map((h) => {
      const acquired = catalogueDateText(h.acquisitionDate?.value ?? null);
      const gone = catalogueDateText(h.dispositionDate?.value ?? null);
      const release = film.versions
        .flatMap((v) => v.releases)
        .find((r) => r.id === h.releaseId);
      return {
        id: h.id,
        title: h.formatLabel ?? `${FILM_MEDIUM_LABELS[h.medium]} copy`,
        line: [
          h.versionId ? versionName({ label: h.versionLabel }) : null,
          release ? releaseLine(release) : null,
          HOLDING_STATUS_LABELS[h.status],
          h.locationName ? [h.locationName, h.subLocationName].filter(Boolean).join(" › ") : null,
        ]
          .filter(Boolean)
          .join(" · "),
        details:
          [
            acquired ? `Acquired ${acquired}` : null,
            h.supplierName,
            h.venueName,
            h.acquisitionPrice !== null && h.acquisitionCurrency
              ? formatPrice(h.acquisitionPrice, h.acquisitionCurrency)
              : null,
            h.condition,
            h.status === "disposed"
              ? [gone ? `Gone since ${gone}` : "Gone", h.dispositionReason].filter(Boolean).join(": ")
              : null,
            h.notes,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        disposed: h.status === "disposed",
        editable: {
          id: h.id,
          fingerprint: h.fingerprint,
          versionId: h.versionId,
          releaseId: h.releaseId,
          medium: h.medium,
          formatLabel: h.formatLabel,
          status: h.status,
          condition: h.condition,
          locationId: h.locationId,
          subLocationId: h.subLocationId,
          acquisitionDate: h.acquisitionDate?.value ?? null,
          supplier: h.supplierId ? { id: h.supplierId, label: h.supplierName ?? "Supplier" } : null,
          venue: h.venueId ? { id: h.venueId, label: h.venueName ?? "Shop" } : null,
          acquisitionPrice: h.acquisitionPrice,
          acquisitionCurrency: h.acquisitionCurrency,
          dispositionDate: h.dispositionDate?.value ?? null,
          dispositionReason: h.dispositionReason,
          notes: h.notes,
        },
      };
    });

  // ── The edit form ─────────────────────────────────────────────────────────
  const companies = film.organizations.filter((o) => o.role === "production_company");
  const editable = {
    id: film.id,
    title: film.title,
    originalTitle: film.originalTitle,
    description: film.description,
    releaseDate: film.releaseDate?.value ?? null,
    sourceRecordId: film.sourceRecordId,
    countries: film.countries.map((c) => ({ id: c.id, name: c.name })),
    languages: film.languages.map((l) => ({ id: l.id, name: l.name })),
    companies: companies.map((o) => ({
      organizationId: o.organizationId,
      name: o.name,
      sourceRecordId: o.sourceRecordId,
    })),
    credits: film.credits.map(
      (c): FilmCreditEntry => ({
        key: c.id,
        id: c.id,
        personId: c.personId,
        name: c.person?.name ?? null,
        roleId: c.roleId as FilmCreditRole,
        creditedAs: c.creditedAs ?? "",
        characters: c.characters.join(" / "),
        attribution: c.attribution,
        notes: c.notes,
      }),
    ),
    otherItemIds: otherClassificationIds(film.classification),
    genres: film.classification
      .filter((c) => c.familySlug === FILM_GENRES_FAMILY)
      .map((c) => ({
        id: c.itemId,
        name: c.name,
        parentName:
          genres
            .find((f) => f.slug === FILM_GENRES_FAMILY)
            ?.items.find((i) => i.id === c.itemId)?.parentName ?? null,
      })),
  };

  return (
    <CurationProvider owner={owner} fingerprint={curation?.fingerprint ?? ""}>
      <div className="relative">
        <CopyShortcuts
          name={[film.title, directors.map((d) => d.name).join(", ")].filter(Boolean).join(", ")}
          title={film.title}
        />

        {/* The still behind the poster and title */}
        <div className={still ? "relative z-[1] -mx-6 -mt-6 mb-8" : "relative z-[1] mb-8"}>
          {still && (
            <div className="absolute inset-0 -z-0 overflow-hidden">
              <img
                src={mediaUrl(still.s3Key)}
                alt=""
                className="h-full w-full object-cover"
                style={mediaImageStyle(mediaCrop(still))}
              />
              <div className="absolute inset-0 bg-scrim" />
              <div
                className="absolute inset-x-0 bottom-0 h-40"
                style={{
                  background:
                    "linear-gradient(to top, var(--color-bg-primary) 0%, var(--color-bg-primary) 5%, transparent 100%)",
                }}
              />
            </div>
          )}

          <div className={still ? "relative z-10 px-6 pt-6 pb-2" : ""}>
            <Link
              href="/films"
              className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
            >
              <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
              Back to films
            </Link>

            <header className="flex flex-col gap-6 sm:flex-row">
              <div className="w-36 shrink-0 sm:w-44">
                <div className="overflow-hidden rounded-sm shadow-[0_2px_24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
                  <FilmPoster
                    image={posterImage}
                    title={film.title}
                    year={year}
                    alt={`${film.title} poster`}
                    thumbnail={false}
                    eager
                  />
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h1 className="type-page-title">{film.title}</h1>
                  <FilmActions
                    film={editable}
                    fingerprint={film.fingerprint}
                    choices={choices}
                    sources={citable}
                    copies={film.holdings.length}
                  >
                    <CurationFavourite isFavourite={curation?.isFavourite ?? false} />
                  </FilmActions>
                </div>
                {film.originalTitle && film.originalTitle !== film.title && (
                  <p className="mt-1 text-sm italic text-fg-secondary">{film.originalTitle}</p>
                )}

                <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
                  <dt className="text-fg-secondary">Directed by</dt>
                  <dd className="text-fg-primary">
                    {directors.length ? (
                      <PeopleLinks people={directors} />
                    ) : (
                      <span className="text-fg-secondary">Not recorded</span>
                    )}
                  </dd>
                  {writers.length > 0 && (
                    <>
                      <dt className="text-fg-secondary">Written by</dt>
                      <dd className="text-fg-primary">
                        <PeopleLinks people={writers} />
                      </dd>
                    </>
                  )}
                  {starring.length > 0 && (
                    <>
                      <dt className="text-fg-secondary">Starring</dt>
                      <dd className="text-fg-primary">
                        <PeopleLinks people={starring} />
                        {cast.length > starring.length && (
                          <a
                            href="#film-cast"
                            className="text-fg-secondary transition-colors hover:text-accent-rose-text"
                          >
                            {" "}
                            and more
                          </a>
                        )}
                      </dd>
                    </>
                  )}
                  <dt className="text-fg-secondary">Released</dt>
                  <dd className="text-fg-primary">
                    {released ?? <span className="text-fg-secondary">Not recorded</span>}
                  </dd>
                  <dt className="text-fg-secondary">Runtime</dt>
                  <dd className="text-fg-primary">
                    {runtime ?? <span className="text-fg-secondary">Not recorded</span>}
                  </dd>
                  <dt className="text-fg-secondary">In the collection</dt>
                  <dd className="text-fg-primary">
                    {heldSummary ? (
                      // Inline padding: a target over 24px high beside the rating's larger one, and no change to the line
                      <a href="#film-copies" className="py-1 transition-colors hover:text-accent-rose-text">
                        {heldSummary}
                      </a>
                    ) : (
                      <span className="text-fg-secondary">No copies</span>
                    )}
                  </dd>
                  <dt className="text-fg-secondary">Your rating</dt>
                  <dd className="text-fg-primary">
                    <RatingControl rating={curation?.rating ?? null} />
                  </dd>
                </dl>
              </div>
            </header>
          </div>
        </div>

        {/* Reading column and, from lg up, the record on the right */}
        <DetailColumns
          record={
            <RecordPanel>
              <RecordGroup title="Details">
                <RecordFields>
                  {film.originalTitle && (
                    <RecordField label="Original title">{film.originalTitle}</RecordField>
                  )}
                  <RecordField label="First released">
                    {released ?? <span className="text-fg-secondary">Not recorded</span>}
                  </RecordField>
                  <RecordField label={film.countries.length === 1 ? "Country" : "Countries"}>
                    {film.countries.length ? (
                      film.countries.map((c) => c.name).join(", ")
                    ) : (
                      <span className="text-fg-secondary">Not recorded</span>
                    )}
                  </RecordField>
                  <RecordField label={film.languages.length === 1 ? "Language" : "Languages"}>
                    {film.languages.length ? (
                      film.languages.map((l) => l.name).join(", ")
                    ) : (
                      <span className="text-fg-secondary">Not recorded</span>
                    )}
                  </RecordField>
                  {companies.length > 0 && (
                    <RecordField label="Production">
                      {companies.map((o) => o.name).join(", ")}
                    </RecordField>
                  )}
                  <RecordField label="Added">
                    {film.createdAt.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </RecordField>
                </RecordFields>
              </RecordGroup>
              {genres.length > 0 && (
                // Genres alone need no label; with other families each is named
                <RecordGroup title={genres.length === 1 ? "Genres" : "Taxonomy"}>
                  <TaxonomyAssignments
                    kind="film"
                    level="work"
                    ownerId={film.id}
                    families={genres}
                    labelled={genres.length > 1}
                  />
                </RecordGroup>
              )}
              {mediaLine && (
                <RecordGroup title="Media">
                  <p className="text-sm text-fg-primary">{mediaLine}</p>
                </RecordGroup>
              )}
            </RecordPanel>
          }
        >
          {film.description && (
            <section className="mb-10" aria-label="Synopsis">
              <Prose className="whitespace-pre-wrap">{film.description}</Prose>
            </section>
          )}

          <CastSection cast={cast} />
          <CrewSection crew={crew} />

          <LinkedWorksSection
            work={{ id: film.id, kind: "film", title: film.title }}
            relations={links}
          />

          <VersionsSection
            film={{ id: film.id, title: film.title, fingerprint: film.fingerprint }}
            versions={versions}
            countries={choices.countries}
            sources={citable}
            versionChoices={versionChoices}
            locations={locations}
            startAdding={query.add === "version"}
          />

          <CopiesSection
            film={{ id: film.id, title: film.title }}
            copies={copies}
            summary={heldSummary}
            versions={versionChoices}
            locations={locations}
          />

          <WantedSection
            workId={film.id}
            title={film.title}
            targets={wanted}
            choices={{
              kind: "film",
              versions: versionChoices.map((v) => ({ id: v.id, label: v.label, releases: v.releases })),
            }}
            locations={{
              physical: locations.filter((l) => l.type === "physical"),
              digital: locations.filter((l) => l.type === "digital"),
            }}
          />

          <SourcesSection
            owner={owner}
            title={film.title}
            sources={sources}
            examples={{
              name: "The film's credits, a festival catalogue, a disc's sleeve",
              says: "Release date, runtime of the theatrical cut",
            }}
            lookup={<FilmSourceLookup key="lookup" film={{ id: film.id, title: film.title, fingerprint: film.fingerprint }} />}
          />

          <PersonalNotes
            notes={curation?.notes ?? null}
            placeholder="When you saw it, what stays with you"
          />
        </DetailColumns>

        <GallerySection entityType="work" entityId={film.id} />

        <RelatedFilms related={related} />

        <ActivityTimeline entityType="work" entityId={film.id} refreshKey={renderStamp()} />
      </div>
    </CurationProvider>
  );
}
