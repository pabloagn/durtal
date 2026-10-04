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
  FavouriteToggle,
  PersonalNotes,
  RatingControl,
} from "@/components/catalogue/curation";
import { LinkedWorksSection } from "@/components/catalogue/work-relations";
import { getWorkRelations } from "@/lib/actions/work-relations";
import { SourcesSection } from "@/components/catalogue/sources-section";
import type { StorageLocation } from "@/components/catalogue/holding-fields";
import { PaintingImage } from "@/components/paintings/painting-image";
import { PaintingActions } from "@/components/paintings/painting-actions";
import type { EditablePainting } from "@/components/paintings/painting-form";
import {
  ArtObjectsSection,
  type HistoryView,
  type ObjectView,
} from "@/components/paintings/art-objects-section";
import { getPainting, getPaintingChoices } from "@/lib/actions/paintings";
import { getWhereabouts } from "@/lib/actions/whereabouts";
import { getWorkCuration } from "@/lib/actions/curation";
import { getCatalogueProvenance } from "@/lib/actions/catalogue-provenance";
import { getTaxonomyAssignments } from "@/lib/actions/taxonomy-families";
import { getMediaForWork } from "@/lib/actions/media";
import { getLocations } from "@/lib/actions/locations";
import { catalogueDateText, catalogueDateYears } from "@/lib/catalogue/dates";
import { HOLDING_STATUS_LABELS } from "@/lib/catalogue/holdings";
import {
  attributedName,
  checkedText,
  custodyText,
  dimensionsText,
  objectName,
  ownerText,
  PAINTING_FAMILIES,
  paintingRatio,
  placeText,
  type PainterEntry,
  type ArtObjectKind,
  type ArtOwnership,
  type DimensionUnit,
  type DisplayStatus,
  type WhereaboutsCertainty,
  type WhereaboutsCustody,
  type WhereaboutsPlace,
} from "@/lib/catalogue/painting-labels";
import { formatPrice } from "@/lib/catalogue/perfume-labels";
import { sourceChoices, sourceViews } from "@/lib/catalogue/source-views";
import type { Attribution } from "@/lib/catalogue/credits";

/** One read per request for the page and its title */
const loadPainting = cache((slug: string) => getPainting(decodeURIComponent(slug)));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const painting = await loadPainting((await params).slug);
  return { title: painting?.title ?? "Painting not found" };
}

type Painting = NonNullable<Awaited<ReturnType<typeof getPainting>>>;
type ArtObject = Painting["objects"][number];
type History = NonNullable<Awaited<ReturnType<typeof getWhereabouts>>>;

/** "1941 – now", "1939 – 1941", "Unknown – 1937": a location's period */
function periodText(record: History["records"][number]) {
  const from = catalogueDateText(record.startsOn?.value ?? null) ?? "Unknown";
  const to = record.endsOn ? (catalogueDateText(record.endsOn.value) ?? "Unknown") : "now";
  return `${from} – ${to}`;
}

/** The object's views for the section: its lines, history and edit form */
function objectView(
  object: ArtObject,
  history: History | null,
  objects: ArtObject[],
  /** The painting's sources by id: what a location record cites */
  sourceLabels: Map<string, string>,
): ObjectView {
  const sourceOf = (id: string | null) => (id ? (sourceLabels.get(id) ?? null) : null);
  const dims = dimensionsText(object);
  const made = catalogueDateYears(object.creationDate?.value ?? null);
  const hands = object.attributionOverride
    ? object.attribution.map((a) => attributedName(a)).join(", ") || "No attributed hand"
    : null;
  const records = history?.records ?? [];
  const conflicts = new Set(history?.conflicts.map((c) => c.id) ?? []);
  const lastCollection = records.find(
    (r) => r.certainty === "confirmed" && r.custody === "permanent_collection" && r.venueId,
  );
  const current = object.currentWhereabouts;
  const reproduced = object.reproducesObjectId
    ? objects.find((o) => o.id === object.reproducesObjectId)
    : null;
  const acquired = catalogueDateText(object.acquisitionDate?.value ?? null);
  const gone = catalogueDateText(object.dispositionDate?.value ?? null);
  const historyViews: HistoryView[] = records.map((r) => ({
    id: r.id,
    place: placeText(r),
    custody: custodyText(r) || null,
    period: periodText(r),
    certainty: r.certainty as WhereaboutsCertainty,
    occasion: r.occasionLabel,
    checked: r.verifiedAt ? checkedText(r) : null,
    source: sourceOf(r.sourceRecordId),
    notes: r.notes,
    current: history?.current?.id === r.id,
    conflict: conflicts.has(r.id),
    editable: {
      id: r.id,
      placeKind: r.placeKind as WhereaboutsPlace,
      venue: r.venueId ? { id: r.venueId, label: r.venueName ?? "Venue" } : null,
      placeLabel: r.placeLabel,
      custody: r.custody as WhereaboutsCustody,
      displayStatus: r.displayStatus as DisplayStatus,
      certainty: r.certainty as WhereaboutsCertainty,
      startsOn: r.startsOn?.value ?? null,
      endsOn: r.endsOn?.value ?? null,
      occasionLabel: r.occasionLabel,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      notes: r.notes,
      sourceRecordId: r.sourceRecordId,
    },
  }));
  return {
    id: object.id,
    kind: object.kind as ArtObjectKind,
    name: objectName({ kind: object.kind as ArtObjectKind, label: object.label }),
    facts: [dims, made, hands].filter(Boolean).join(" · ") || null,
    owner: [
      ownerText({
        ownership: object.ownership as ArtOwnership,
        ownerName: object.ownerName,
        ownerLabel: object.ownerLabel,
      }),
      object.collectionName,
      object.accessionNumber,
    ]
      .filter(Boolean)
      .join(" · "),
    holding:
      object.ownership === "personal" && object.holdingStatus
        ? [
            HOLDING_STATUS_LABELS[object.holdingStatus],
            object.locationName
              ? [object.locationName, object.subLocationName].filter(Boolean).join(" › ")
              : null,
            acquired ? `Acquired ${acquired}` : null,
            object.venueName,
            object.acquisitionPrice !== null && object.acquisitionCurrency
              ? formatPrice(object.acquisitionPrice, object.acquisitionCurrency)
              : null,
            object.holdingStatus === "disposed"
              ? [gone ? `Gone since ${gone}` : "Gone", object.dispositionReason]
                  .filter(Boolean)
                  .join(": ")
              : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : null,
    reproduces:
      object.kind === "reproduction"
        ? `Reproduces ${reproduced ? objectName({ kind: reproduced.kind as ArtObjectKind, label: reproduced.label }).toLowerCase() : "the painting"}`
        : null,
    notes: object.notes,
    disposed: object.holdingStatus === "disposed",
    now: current
      ? {
          place: placeText(current),
          custody: custodyText(current) || null,
          since: current.since ? `since ${catalogueDateText(current.since)}` : null,
          checked: history?.current ? checkedText(history.current) : checkedText({ verifiedAt: null, recordedAt: current.checkedAt }),
          stale: current.isStale,
          source: sourceOf(history?.current?.sourceRecordId ?? null),
        }
      : null,
    history: historyViews,
    historyFingerprint: history?.fingerprint ?? "",
    ownerVenue: lastCollection?.venueId
      ? { id: lastCollection.venueId, label: lastCollection.venueName ?? "Venue" }
      : null,
    currentVenueId: current?.venueId ?? null,
    editable: {
      id: object.id,
      fingerprint: object.fingerprint,
      kind: object.kind as ArtObjectKind,
      label: object.label,
      reproducesObjectId: object.reproducesObjectId,
      creationDate: object.creationDate?.value ?? null,
      height: object.height,
      width: object.width,
      depth: object.depth,
      dimensionUnit: object.dimensionUnit as DimensionUnit | null,
      dimensionsNote: object.dimensionsNote,
      attribution: object.attributionOverride
        ? object.attribution.map(
            (a): PainterEntry => ({
              key: a.id,
              id: a.id,
              personId: a.personId,
              name: a.name,
              creditedAs: a.creditedAs,
              attribution: a.attribution as Attribution,
            }),
          )
        : null,
      ownership: object.ownership as ArtOwnership,
      owner: object.ownerOrganizationId
        ? { id: object.ownerOrganizationId, label: object.ownerName ?? "Institution" }
        : null,
      ownerLabel: object.ownerLabel,
      collectionName: object.collectionName,
      accessionNumber: object.accessionNumber,
      holdingStatus: object.holdingStatus,
      locationId: object.locationId,
      subLocationId: object.subLocationId,
      acquisitionDate: object.acquisitionDate?.value ?? null,
      venue: object.venueId ? { id: object.venueId, label: object.venueName ?? "Shop" } : null,
      acquisitionPrice: object.acquisitionPrice,
      acquisitionCurrency: object.acquisitionCurrency,
      dispositionDate: object.dispositionDate?.value ?? null,
      dispositionReason: object.dispositionReason,
      notes: object.notes,
    },
  };
}

/** "Hieronymus Bosch, Workshop of Bosch" as links into the filtered home */
function Painters({ painting }: { painting: Painting }) {
  const painters = painting.credits.filter((c) => c.roleId === "painting.painter");
  if (!painters.length) return <span className="text-fg-secondary">Not recorded</span>;
  return (
    <>
      {painters.map((credit, i) => (
        <span key={credit.id}>
          {i > 0 && ", "}
          {credit.personId ? (
            <Link
              href={`/paintings?painter=${credit.personId}`}
              className="transition-colors hover:text-accent-rose-text"
            >
              {attributedName(credit)}
            </Link>
          ) : (
            <span className="text-fg-secondary">{attributedName(credit)}</span>
          )}
        </span>
      ))}
    </>
  );
}

/**
 * A painting: the whole picture, large and uncropped, beside who painted it,
 * when, who owns the original and where it is now; then its description, the
 * original with its location history, versions and reproductions, sources
 * and personal notes beside the record (details and classification).
 */
export default async function PaintingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const painting = await loadPainting(slug);
  if (!painting) notFound();
  const owner = { kind: "painting" as const, id: painting.id };
  const [media, curation, provenance, families, allLocations, choices, histories, links] =
    await Promise.all([
      getMediaForWork(painting.id),
      getWorkCuration(owner),
      getCatalogueProvenance({ owner, limit: 100 }),
      getTaxonomyAssignments({ kind: "painting", level: "work", ownerId: painting.id }),
      getLocations(),
      getPaintingChoices(),
      Promise.all(painting.objects.map((o) => getWhereabouts(o.id))),
      getWorkRelations(painting.id),
    ]);

  // ── The picture ───────────────────────────────────────────────────────────
  const picture = media.find((m) => m.type === "poster" && m.isActive);
  const image = picture
    ? {
        ...picture,
        tone:
          (picture.colorPalette as { dominant?: { hex?: string } } | null)?.dominant?.hex ?? null,
      }
    : null;
  const primary =
    painting.objects.find((o) => o.kind === "original") ??
    painting.objects.find((o) => o.kind === "version") ??
    null;
  const size = primary ? { widthCm: primary.widthCm, heightCm: primary.heightCm } : null;
  const ratio = paintingRatio(image, size);
  const year = catalogueDateYears(painting.creationDate?.value ?? null);
  const painted = catalogueDateText(painting.creationDate?.value ?? null);
  const counts = {
    pictures: media.filter((m) => m.type === "poster").length,
    gallery: media.filter((m) => m.type === "gallery").length,
  };
  const mediaLine = [
    counts.pictures ? `${counts.pictures} ${counts.pictures === 1 ? "picture" : "pictures"}` : null,
    counts.gallery ? `${counts.gallery} gallery ${counts.gallery === 1 ? "image" : "images"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // ── Objects ───────────────────────────────────────────────────────────────
  const sourceLabels = new Map(sourceChoices(provenance).map((s) => [s.id, s.label]));
  const objects = painting.objects.map((o, i) =>
    objectView(o, histories[i], painting.objects, sourceLabels),
  );
  const primaryView = primary ? objects.find((o) => o.id === primary.id)! : null;
  const owned = painting.objects.filter((o) => o.ownership === "personal");
  const held = owned.filter((o) => o.holdingStatus !== "disposed");
  const locations: StorageLocation[] = allLocations
    .filter((l) => l.type === "physical")
    .map((l) => ({
      id: l.id,
      name: l.name,
      subLocations: l.subLocations.map((s) => ({ id: s.id, name: s.name })),
    }));

  // ── Sources ───────────────────────────────────────────────────────────────
  const cited = new Set(
    [
      painting.sourceRecordId,
      ...painting.objects.map((o) => o.sourceRecordId),
      ...histories.flatMap((h) => h?.records.map((r) => r.sourceRecordId) ?? []),
      // A link starting here cites a source of this painting
      ...links.filter((l) => l.direction === "outgoing").map((l) => l.source?.id),
    ].filter((id): id is string => !!id),
  );
  const sources = sourceViews(provenance, cited);
  const citable = sourceChoices(provenance);

  // ── The edit form ─────────────────────────────────────────────────────────
  const familyOf = (slug: string) => families.find((f) => f.slug === slug);
  const formSlugs = new Set<string>(PAINTING_FAMILIES.map((f) => f.family.slug));
  const editable: EditablePainting = {
    id: painting.id,
    title: painting.title,
    description: painting.description,
    creationDate: painting.creationDate?.value ?? null,
    sourceRecordId: painting.sourceRecordId,
    painters: painting.credits
      .filter((c) => c.roleId === "painting.painter")
      .map((c) => ({
        key: c.id,
        id: c.id,
        personId: c.personId,
        name: c.person?.name ?? null,
        creditedAs: c.creditedAs,
        attribution: c.attribution as Attribution,
      })),
    movements: painting.artMovements.map((m) => ({ id: m.id, name: m.name })),
    classification: Object.fromEntries(
      PAINTING_FAMILIES.map(({ key, family }) => [
        key,
        (familyOf(family.slug)?.items ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          parentName: item.parentName,
        })),
      ]),
    ) as EditablePainting["classification"],
    otherItemIds: painting.classification
      .filter((c) => !formSlugs.has(c.familySlug))
      .map((c) => c.itemId),
  };
  const painterNames = painting.credits
    .filter((c) => c.roleId === "painting.painter")
    .map((c) => attributedName(c))
    .join(", ");
  const now = primaryView?.now ?? null;

  return (
    <CurationProvider owner={owner} fingerprint={curation?.fingerprint ?? ""}>
      <div className="relative">
        <CopyShortcuts
          name={[painting.title, painterNames].filter(Boolean).join(", ")}
          title={painting.title}
        />

        <Link
          href="/paintings"
          className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary"
        >
          <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
          Back to paintings
        </Link>

        {/* The picture, about half the page wide, beside its identity; stacked on a phone */}
        <header className="mb-10 grid gap-6 lg:grid-cols-2 lg:gap-10">
          <div className="min-w-0">
            <div
              className="mx-auto w-full lg:mx-0"
              style={{ maxWidth: `min(100%, calc(78vh * ${ratio.toFixed(4)}))` }}
            >
              <div className="overflow-hidden rounded-sm shadow-[0_2px_24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
                <PaintingImage
                  image={image}
                  title={painting.title}
                  year={year}
                  size={size}
                  frame="native"
                  alt={painting.title}
                  thumbnail={false}
                  eager
                />
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <h1 className="type-page-title">{painting.title}</h1>
              <PaintingActions
                painting={editable}
                fingerprint={painting.fingerprint}
                choices={choices}
                sources={citable}
                owned={owned.length}
              >
                <FavouriteToggle isFavourite={curation?.isFavourite ?? false} />
              </PaintingActions>
            </div>

            <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-fg-secondary">Painted by</dt>
              <dd className="text-fg-primary">
                <Painters painting={painting} />
              </dd>
              <dt className="text-fg-secondary">Date</dt>
              <dd className="text-fg-primary">
                {painted ?? <span className="text-fg-secondary">Not recorded</span>}
              </dd>
              {painting.artMovements.length > 0 && (
                <>
                  <dt className="text-fg-secondary">
                    {painting.artMovements.length === 1 ? "Movement" : "Movements"}
                  </dt>
                  <dd className="text-fg-primary">
                    {painting.artMovements.map((m, i) => (
                      <span key={m.id}>
                        {i > 0 && ", "}
                        <Link
                          href={`/paintings?movement=${m.id}`}
                          className="transition-colors hover:text-accent-rose-text"
                        >
                          {m.name}
                        </Link>
                      </span>
                    ))}
                  </dd>
                </>
              )}
              <dt className="text-fg-secondary">Original</dt>
              <dd className="text-fg-primary">
                {primaryView ? (
                  <a href="#painting-objects" className="transition-colors hover:text-accent-rose-text">
                    {primary?.ownership === "unknown" ? "Owner unknown" : primaryView.owner}
                  </a>
                ) : (
                  <span className="text-fg-secondary">Not recorded</span>
                )}
              </dd>
              {primaryView && (
                <>
                  <dt className="text-fg-secondary">Now</dt>
                  <dd className="text-fg-primary">
                    {now ? (
                      <>
                        {primary?.currentWhereabouts?.venueId ? (
                          <Link
                            href={`/paintings?venue=${primary.currentWhereabouts.venueId}`}
                            className="transition-colors hover:text-accent-rose-text"
                          >
                            {now.place}
                          </Link>
                        ) : (
                          now.place
                        )}
                        {now.custody && <span className="text-fg-secondary"> · {now.custody}</span>}
                        <span className={`block text-xs ${now.stale ? "text-accent-gold" : "text-fg-secondary"}`}>
                          {[now.since, now.checked].filter(Boolean).join(" · ")}
                          {now.stale && ", check again"}
                          {now.source && ` · Source: ${now.source}`}
                        </span>
                      </>
                    ) : (
                      <span className="text-fg-secondary">Not recorded</span>
                    )}
                  </dd>
                </>
              )}
              <dt className="text-fg-secondary">In the collection</dt>
              <dd className="text-fg-primary">
                {held.length ? (
                  <a href="#painting-objects" className="transition-colors hover:text-accent-rose-text">
                    {held.length === 1
                      ? objectName({ kind: held[0].kind as ArtObjectKind, label: held[0].label })
                      : `${held.length} objects`}
                  </a>
                ) : (
                  <span className="text-fg-secondary">Nothing of it</span>
                )}
              </dd>
              <dt className="text-fg-secondary">Your rating</dt>
              <dd className="text-fg-primary">
                <RatingControl rating={curation?.rating ?? null} />
              </dd>
            </dl>
          </div>
        </header>

        {/* Reading column and, from lg up, the record on the right */}
        <DetailColumns
          record={
            <RecordPanel>
              <RecordGroup title="Details">
                <RecordFields>
                  <RecordField label="Painted">
                    {painted ?? <span className="text-fg-secondary">Not recorded</span>}
                  </RecordField>
                  {primary && dimensionsText(primary) && (
                    <RecordField label="Size of the original">{dimensionsText(primary)}</RecordField>
                  )}
                  <RecordField label="Added">
                    {painting.createdAt.toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </RecordField>
                </RecordFields>
              </RecordGroup>
              {families.length > 0 && (
                <RecordGroup title="Classification">
                  <TaxonomyAssignments
                    kind="painting"
                    level="work"
                    ownerId={painting.id}
                    families={families}
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
          {painting.description && (
            <section className="mb-10" aria-label="Description">
              <Prose className="whitespace-pre-wrap">{painting.description}</Prose>
            </section>
          )}

          <ArtObjectsSection
            painting={{ id: painting.id, title: painting.title }}
            objects={objects}
            locations={locations}
            sources={citable}
          />

          <LinkedWorksSection
            work={{ id: painting.id, kind: "painting", title: painting.title }}
            relations={links}
          />

          <SourcesSection
            owner={owner}
            title={painting.title}
            sources={sources}
            examples={{
              name: "The museum's collection page, a catalogue raisonné",
              says: "Date, owner, accession number, where it hangs",
            }}
          />

          <PersonalNotes
            notes={curation?.notes ?? null}
            placeholder="Where you saw it, what stays with you"
          />
        </DetailColumns>

        <GallerySection entityType="work" entityId={painting.id} />

        <ActivityTimeline entityType="work" entityId={painting.id} refreshKey={renderStamp()} />
      </div>
    </CurationProvider>
  );
}
