import { cache } from "react";
import { DetailTitleRow } from "@/components/shared/detail-layout";
import { ActivityTimeline } from "@/components/activity/activity-timeline";
import { WorkCollectionsSection, loadWorkCollections } from "@/components/collections/work-collections";
import { renderStamp } from "@/lib/activity/render-stamp";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CopyShortcuts } from "@/components/shortcuts/copy-shortcuts";
import { SectionHeading } from "@/components/shared/section-heading";
import { Prose } from "@/components/shared/prose";
import { GallerySection } from "@/components/shared/gallery-section";
import { TaxonomyAssignments } from "@/components/taxonomy/taxonomy-assignments";
import { PerfumeImage } from "@/components/perfumes/perfume-image";
import { PerfumeActions } from "@/components/perfumes/perfume-actions";
import {
  CurationProvider,
  CurationFavourite,
  PersonalNotes,
  RatingControl,
} from "@/components/catalogue/curation";
import { NotesSection } from "@/components/perfumes/notes-section";
import {
  FormulationsSection,
  type FormulationView,
} from "@/components/perfumes/formulations-section";
import { BottlesSection, type BottleView } from "@/components/perfumes/bottles-section";
import { RetailersSection } from "@/components/perfumes/retailers-section";
import { WantedSection } from "@/components/catalogue/wanted-section";
import { getTypedTargets } from "@/lib/actions/acquisitions";
import { LinkedWorksSection } from "@/components/catalogue/work-relations";
import { getWorkRelations } from "@/lib/actions/work-relations";
import { linkedWorkEbooks } from "@/lib/catalogue/linked-work-ebooks";
import { SourcesSection } from "@/components/catalogue/sources-section";
import { PerfumeSourceLookup } from "@/components/perfumes/source-lookup";
import { sourceChoices, sourceViews } from "@/lib/catalogue/source-views";
import { RelatedPerfumes } from "@/components/perfumes/related-perfumes";
import type { FormulationVocabulary } from "@/components/perfumes/formulation-dialog";
import { getPerfume, getRelatedPerfumes } from "@/lib/actions/perfumes";
import { getWorkCuration } from "@/lib/actions/curation";
import { getCatalogueProvenance } from "@/lib/actions/catalogue-provenance";
import {
  getTaxonomyAssignments,
  getTaxonomyFamily,
} from "@/lib/actions/taxonomy-families";
import { getMediaForWork } from "@/lib/actions/media";
import { getLocations } from "@/lib/actions/locations";
import { catalogueDateText } from "@/lib/catalogue/dates";
import {
  CONTAINER_LABELS,
  HOLDING_STATUS_LABELS,
  formatPrice,
  formatVolume,
  formulationName,
  holdingsSummary,
  remainingShare,
} from "@/lib/catalogue/perfume-labels";
import { coverToneStyle } from "@/lib/utils/media-style";
import type { ListSearchParams } from "@/lib/utils/pagination";

/** One read per request for the page and its title */
const loadPerfume = cache((slug: string) => getPerfume(decodeURIComponent(slug)));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const perfume = await loadPerfume((await params).slug);
  return { title: perfume?.title ?? "Perfume not found" };
}

const VOCABULARY_LABELS: Record<string, string> = {
  "perfume-families": "Families",
  "perfume-accords": "Accords",
};

/** "Shalimar, Guerlain" */
function names(list: { name: string | null }[]) {
  return list.flatMap((item) => (item.name ? [item.name] : [])).join(", ");
}

/** A short list: "bergamot, iris, vanilla and 4 more" */
function shortList(list: string[], limit = 4) {
  if (!list.length) return null;
  return list.length > limit
    ? `${list.slice(0, limit).join(", ")} and ${list.length - limit} more`
    : list.join(", ");
}

/**
 * A perfume: the bottle and who made it first, then its notes, families and
 * accords, its formulations, the bottles and samples kept, where it is sold,
 * where the facts come from, personal notes and related fragrances. With a
 * formulation chosen (`?formulation=`), the facts and notes are that
 * formulation's: its own where it has them, else the fragrance's.
 */
export default async function PerfumePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListSearchParams>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const perfume = await loadPerfume(slug);
  if (!perfume) notFound();
  const owner = { kind: "perfume" as const, id: perfume.id };
  const [media, curation, provenance, related, families, notesFamily, allLocations, links, wanted, inCollections] =
    await Promise.all([
      getMediaForWork(perfume.id),
      getWorkCuration(owner),
      getCatalogueProvenance({ owner, limit: 100 }),
      getRelatedPerfumes(perfume.id),
      getTaxonomyAssignments({ kind: "perfume", level: "work", ownerId: perfume.id }),
      getTaxonomyFamily("perfume-notes"),
      getLocations(),
      getWorkRelations(perfume.id),
      getTypedTargets(perfume.id),
      loadWorkCollections(perfume.id),
    ]);
  // The e-book marks of linked books' cards
  const linkedEbooks = await linkedWorkEbooks(links);

  const base = `/perfumes/${perfume.slug ?? perfume.id}`;
  const chosen = Array.isArray(query.formulation) ? query.formulation[0] : query.formulation;
  const selected = perfume.variants.find((v) => v.id === chosen) ?? null;
  const poster = media.find((m) => m.type === "poster" && m.isActive);
  const posterImage = poster
    ? {
        s3Key: poster.s3Key,
        thumbnailS3Key: poster.thumbnailS3Key,
        tone:
          (poster.colorPalette as { dominant?: { hex?: string } } | null)?.dominant?.hex ?? null,
      }
    : null;
  const heroImage = selected?.image ?? posterImage;

  // ── Who made it ───────────────────────────────────────────────────────────
  const houses = perfume.organizations.filter((o) => o.role !== "manufacturer");
  const manufacturers = perfume.organizations.filter((o) => o.role === "manufacturer");
  const fragrancePerfumers = perfume.credits
    .filter((c) => c.roleId === "perfume.perfumer")
    .map((c) => ({
      personId: c.personId,
      name: c.person?.name ?? c.creditedAs ?? (c.attribution === "anonymous" ? "Anonymous" : "Unknown"),
    }));
  const perfumers = selected
    ? selected.perfumers.map((p) => ({
        personId: p.personId,
        name: p.name ?? p.creditedAs ?? (p.attribution === "anonymous" ? "Anonymous" : "Unknown"),
      }))
    : fragrancePerfumers;
  const directors = perfume.credits.filter((c) => c.roleId === "perfume.creative_director");
  const launched = catalogueDateText(
    (selected?.releaseDate ?? perfume.releaseDate)?.value ?? null,
  );
  const discontinued = catalogueDateText(
    (selected?.discontinuedDate ?? perfume.discontinuedDate)?.value ?? null,
  );

  // ── What is kept ──────────────────────────────────────────────────────────
  const variantName = (id: string) => {
    const v = perfume.variants.find((variant) => variant.id === id);
    return v ? formulationName(v) : "Formulation";
  };
  const held = perfume.bottles.filter((b) => b.status !== "disposed");
  const heldSummary = holdingsSummary({
    bottle: held.filter((b) => b.container === "bottle").length,
    sample: held.filter((b) => b.container === "sample").length,
    decant: held.filter((b) => b.container === "decant").length,
  });

  // ── Sources ───────────────────────────────────────────────────────────────
  const cited = new Set(
    [
      perfume.sourceRecordId,
      ...perfume.organizations.map((o) => o.sourceRecordId),
      ...perfume.notePyramid.map((n) => n.sourceRecordId),
      ...perfume.classification.map((c) => c.sourceRecordId),
      ...perfume.variants.flatMap((v) => [
        v.sourceRecordId,
        ...v.perfumers.map((p) => p.sourceRecordId),
        ...v.notePyramid.map((n) => n.sourceRecordId),
        ...v.classification.map((c) => c.sourceRecordId),
      ]),
      ...perfume.retailers.flatMap((r) => [r.link.sourceRecordId, r.observation?.sourceRecordId]),
      // A link starting here cites a source of this perfume
      ...links.filter((l) => l.direction === "outgoing").map((l) => l.source?.id),
    ].filter((id): id is string => !!id),
  );
  const sources = sourceViews(provenance, cited);
  const choices = sourceChoices(provenance);

  // ── Formulations ──────────────────────────────────────────────────────────
  const vocabularies: FormulationVocabulary[] = families
    .filter((f) => f.slug in VOCABULARY_LABELS)
    .map((f) => ({
      familyId: f.id,
      slug: f.slug,
      name: f.name,
      label: VOCABULARY_LABELS[f.slug],
    }));
  const inherited = {
    perfumers:
      shortList(fragrancePerfumers.map((p) => p.name)) ?? "The fragrance has no perfumer recorded",
    notes: shortList(perfume.notePyramid.map((n) => n.name))
      ? `The fragrance's notes: ${shortList(perfume.notePyramid.map((n) => n.name))}`
      : "The fragrance has no notes recorded",
    vocabularies: Object.fromEntries(
      vocabularies.map((v) => [
        v.slug,
        shortList(
          perfume.classification.filter((c) => c.familyId === v.familyId).map((c) => c.name),
        ) ?? "None recorded for the fragrance",
      ]),
    ),
  };
  const formulations: FormulationView[] = perfume.variants.map((v) => {
    const containers = perfume.bottles.filter((b) => b.variantId === v.id).length;
    const kept = held.filter((b) => b.variantId === v.id);
    const ownNotes = !!notesFamily && v.overriddenFamilyIds.includes(notesFamily.id);
    const dates = [catalogueDateText(v.releaseDate?.value ?? null), catalogueDateText(v.discontinuedDate?.value ?? null)];
    return {
      id: v.id,
      name: formulationName(v),
      image: v.image,
      facts: [
        dates[0] && dates[1] ? `${dates[0]} to ${dates[1]}` : dates[0] ? `Launched ${dates[0]}` : null,
        v.perfumersOverride
          ? names(v.perfumers) || "No perfumer"
          : null,
        ownNotes ? "Its own notes" : null,
        holdingsSummary({
          bottle: kept.filter((b) => b.container === "bottle").length,
          sample: kept.filter((b) => b.container === "sample").length,
          decant: kept.filter((b) => b.container === "decant").length,
        }) ?? "None kept",
      ]
        .filter(Boolean)
        .join(" · "),
      containers,
      listings: perfume.retailers.filter((r) => r.link.variantId === v.id).length,
      href: `${base}?formulation=${v.id}`,
      editable: {
        id: v.id,
        fingerprint: v.fingerprint,
        concentration: v.concentration,
        concentrationLabel: v.concentrationLabel,
        formulationLabel: v.formulationLabel,
        releaseDate: v.releaseDate?.value ?? null,
        discontinuedDate: v.discontinuedDate?.value ?? null,
        notes: v.notes,
        sourceRecordId: v.sourceRecordId,
        perfumers: v.perfumersOverride
          ? v.perfumers.map((p) => ({
              id: p.id,
              personId: p.personId,
              name: p.name,
              creditedAs: p.creditedAs,
              attribution: p.attribution,
              sourceRecordId: p.sourceRecordId,
            }))
          : null,
        notePyramid: ownNotes
          ? v.notePyramid.map((n) => ({
              itemId: n.itemId,
              name: n.name,
              parentName: null,
              position: n.position ?? "unspecified",
              sourceRecordId: n.sourceRecordId,
            }))
          : null,
        classification: Object.fromEntries(
          vocabularies
            .filter((voc) => v.overriddenFamilyIds.includes(voc.familyId))
            .map((voc) => [
              voc.slug,
              v.classification
                .filter((c) => c.familyId === voc.familyId)
                .map((c) => ({ id: c.itemId, name: c.name, parentName: null })),
            ]),
        ),
      },
    };
  });

  // ── Bottles ───────────────────────────────────────────────────────────────
  const locations = allLocations
    .filter((l) => l.type === "physical")
    .map((l) => ({
      id: l.id,
      name: l.name,
      subLocations: l.subLocations.map((s) => ({ id: s.id, name: s.name })),
    }));
  const bottles: BottleView[] = [...perfume.bottles]
    .sort((a, b) => Number(a.status === "disposed") - Number(b.status === "disposed"))
    .map((b) => {
      const acquired = catalogueDateText(b.acquisitionDate?.value ?? null);
      const gone = catalogueDateText(b.dispositionDate?.value ?? null);
      return {
        id: b.id,
        title: `${CONTAINER_LABELS[b.container].one} · ${formatVolume(b.capacityValue, b.volumeUnit)}`,
        line: [
          variantName(b.variantId),
          HOLDING_STATUS_LABELS[b.status],
          b.locationName
            ? [b.locationName, b.subLocationName].filter(Boolean).join(" › ")
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        details:
          [
            acquired ? `Acquired ${acquired}` : null,
            b.supplierName,
            b.venueName,
            b.acquisitionPrice !== null && b.acquisitionCurrency
              ? formatPrice(b.acquisitionPrice, b.acquisitionCurrency)
              : null,
            b.batchCode ? `Batch ${b.batchCode}` : null,
            b.condition,
            b.status === "disposed"
              ? [gone ? `Gone since ${gone}` : "Gone", b.dispositionReason].filter(Boolean).join(": ")
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        share: remainingShare(b.remainingMl, b.capacityMl),
        left: b.remainingMl === null ? "Left unknown" : `${formatVolume(b.remainingMl)} left`,
        disposed: b.status === "disposed",
        editable: {
          id: b.id,
          fingerprint: b.fingerprint,
          variantId: b.variantId,
          container: b.container,
          capacityValue: b.capacityValue,
          volumeUnit: b.volumeUnit,
          remainingMl: b.remainingMl,
          status: b.status,
          batchCode: b.batchCode,
          condition: b.condition,
          locationId: b.locationId,
          subLocationId: b.subLocationId,
          acquisitionDate: b.acquisitionDate?.value ?? null,
          supplier: b.supplierId ? { id: b.supplierId, label: b.supplierName ?? "Supplier" } : null,
          venue: b.venueId ? { id: b.venueId, label: b.venueName ?? "Shop" } : null,
          acquisitionPrice: b.acquisitionPrice,
          acquisitionCurrency: b.acquisitionCurrency,
          dispositionDate: b.dispositionDate?.value ?? null,
          dispositionReason: b.dispositionReason,
          notes: b.notes,
        },
      };
    });
  const formulationChoices = perfume.variants.map((v) => ({ id: v.id, label: formulationName(v) }));

  // ── Notes in view ─────────────────────────────────────────────────────────
  const notes = selected ? selected.notePyramid : perfume.notePyramid;
  const scope = selected
    ? `${formulationName(selected)}: ${
        notesFamily && selected.overriddenFamilyIds.includes(notesFamily.id)
          ? "its own notes"
          : "the fragrance's notes"
      }`
    : undefined;

  return (
    <CurationProvider owner={{ kind: "perfume", id: perfume.id }} fingerprint={curation?.fingerprint ?? ""}>
      <CopyShortcuts
        name={[perfume.title, names(houses)].filter(Boolean).join(", ")}
        title={perfume.title}
      />
      <Link
        href="/perfumes"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-fg-secondary transition-colors hover:text-fg-primary touch-hit"
      >
        <ArrowLeft className="h-3 w-3" strokeWidth={1.5} />
        Back to perfumes
      </Link>

      {/* The bottle and who made it */}
      <header className="mb-10 grid gap-6 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:gap-8">
        <div className="mx-auto w-full max-w-[320px] md:max-w-none">
          <div
            className="overflow-hidden rounded-sm shadow-[0_2px_24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]"
            style={heroImage ? coverToneStyle(heroImage.tone) : undefined}
          >
            <PerfumeImage
              image={heroImage}
              title={perfume.title}
              alt={selected ? `${perfume.title}, ${formulationName(selected)}` : perfume.title}
              thumbnail={false}
              eager
            />
          </div>
        </div>
        <div className="min-w-0">
          <DetailTitleRow title={perfume.title} controls="wide">
            <PerfumeActions
              perfume={{
                id: perfume.id,
                title: perfume.title,
                description: perfume.description,
                releaseDate: perfume.releaseDate?.value ?? null,
                discontinuedDate: perfume.discontinuedDate?.value ?? null,
                sourceRecordId: perfume.sourceRecordId,
                organizations: perfume.organizations.map((o) => ({
                  organizationId: o.organizationId,
                  name: o.name,
                  role: o.role as "perfume_house" | "brand" | "manufacturer",
                  sourceRecordId: o.sourceRecordId,
                })),
                credits: perfume.credits.map((c) => ({
                  id: c.id,
                  personId: c.personId,
                  name: c.person?.name ?? null,
                  creditedAs: c.creditedAs,
                  attribution: c.attribution,
                  roleId: c.roleId as "perfume.perfumer" | "perfume.creative_director",
                  notes: c.notes,
                })),
              }}
              fingerprint={perfume.fingerprint}
              sources={choices}
              containers={perfume.bottles.length}
              listings={perfume.retailers.length}
            >
              <CurationFavourite isFavourite={curation?.isFavourite ?? false} />
            </PerfumeActions>
          </DetailTitleRow>

          {houses.length > 0 && (
            <p className="mt-2 text-sm text-fg-secondary pointer-coarse:mt-4">
              {houses.map((house, i) => (
                <span key={`${house.organizationId}:${house.role}`}>
                  {i > 0 && ", "}
                  <Link
                    href={`/perfumes?house=${house.organizationId}`}
                    className="text-command"
                  >
                    {house.name}
                  </Link>
                  {house.role === "brand" && houses.some((h) => h.role === "perfume_house") && " (brand)"}
                </span>
              ))}
            </p>
          )}

          <dl className="mt-5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm facts-touch">
            <dt className="text-fg-secondary">{perfumers.length === 1 ? "Perfumer" : "Perfumers"}</dt>
            <dd className="text-fg-primary">
              {perfumers.length === 0 ? (
                <span className="text-fg-secondary">Not recorded</span>
              ) : (
                perfumers.map((p, i) => (
                  <span key={`${p.personId ?? "unknown"}:${i}`}>
                    {i > 0 && ", "}
                    {p.personId ? (
                      <Link
                        href={`/perfumes?perfumer=${p.personId}`}
                        className="text-command"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="text-fg-secondary">{p.name}</span>
                    )}
                  </span>
                ))
              )}
            </dd>
            {directors.length > 0 && (
              <>
                <dt className="text-fg-secondary">Creative direction</dt>
                <dd className="text-fg-primary">
                  {directors.map((d) => d.person?.name ?? d.creditedAs ?? "Unknown").join(", ")}
                </dd>
              </>
            )}
            <dt className="text-fg-secondary">Launched</dt>
            <dd className="text-fg-primary">
              {launched ?? <span className="text-fg-secondary">Not recorded</span>}
              {discontinued && (
                <span className="text-fg-secondary"> · discontinued {discontinued}</span>
              )}
            </dd>
            {manufacturers.length > 0 && (
              <>
                <dt className="text-fg-secondary">Made by</dt>
                <dd className="text-fg-primary">{manufacturers.map((m) => m.name).join(", ")}</dd>
              </>
            )}
            {perfume.variants.length > 0 && (
              <>
                {/* The label sits on the first chip's baseline. On touch each
                    chip keeps its 26px box and takes a 44px press area; rows
                    of chips sit 18px apart so those areas do not overlap */}
                <dt className="self-baseline text-fg-secondary">Concentration</dt>
                <dd className="self-baseline">
                  <nav aria-label="Formulations" className="flex flex-wrap gap-1.5 pointer-coarse:gap-x-2 pointer-coarse:gap-y-6.5">
                    {perfume.variants.map((v) => {
                      const current = v.id === selected?.id;
                      return (
                        <Link
                          key={v.id}
                          href={current ? base : `${base}?formulation=${v.id}`}
                          scroll={false}
                          aria-current={current ? "true" : undefined}
                          className={`rounded-sm border px-2 py-0.5 text-xs leading-5 transition-colors touch-hit ${
                            current
                              ? "border-accent-primary/40 bg-selection-bg text-fg-primary"
                              : "border-glass-border text-fg-secondary hover:bg-bg-tertiary hover:text-fg-primary"
                          }`}
                        >
                          {formulationName(v)}
                        </Link>
                      );
                    })}
                  </nav>
                </dd>
              </>
            )}
            <dt className="text-fg-secondary">In the collection</dt>
            <dd className="text-fg-primary">
              {heldSummary ? (
                <a href="#perfume-bottles" className="text-command">
                  {heldSummary}
                </a>
              ) : (
                <span className="text-fg-secondary">None kept</span>
              )}
            </dd>
            {/* The stars are 220px on touch: under sm they take a row of their own */}
            <dt className="text-fg-secondary">Your rating</dt>
            <dd className="col-span-2 text-fg-primary sm:col-span-1">
              <RatingControl rating={curation?.rating ?? null} />
            </dd>
          </dl>
        </div>
      </header>

      {perfume.description && (
        <section className="mb-10" aria-label="Description">
          <Prose className="whitespace-pre-wrap">{perfume.description}</Prose>
        </section>
      )}

      <NotesSection
        key={`${selected?.id ?? "fragrance"}:${perfume.fingerprint}`}
        perfumeId={perfume.id}
        fingerprint={perfume.fingerprint}
        notes={notes}
        editable={!selected}
        scope={scope}
        sources={choices}
      />

      <section className="mb-10" aria-labelledby="perfume-classification">
        <SectionHeading
          id="perfume-classification"
          // Themes, subjects and keywords apply to perfumes too (SLN-1157)
          title={
            families.every((f) => f.slug in VOCABULARY_LABELS)
              ? "Families and accords"
              : "Classification"
          }
          description={
            selected
              ? `${formulationName(selected)}: edit its own families and accords with the formulation`
              : undefined
          }
        />
        {selected ? (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm facts-touch">
            {vocabularies.map((v) => {
              const terms = selected.classification.filter((c) => c.familyId === v.familyId);
              return (
                <div key={v.slug} className="contents">
                  <dt className="text-fg-secondary">{v.label}</dt>
                  <dd className="text-fg-primary">
                    {terms.length ? terms.map((t) => t.name).join(", ") : <span className="text-fg-secondary">None</span>}
                    {terms.some((t) => t.inherited) && (
                      <span className="text-fg-secondary"> (the fragrance&apos;s)</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <TaxonomyAssignments kind="perfume" level="work" ownerId={perfume.id} families={families} />
        )}
      </section>

      <FormulationsSection
        perfume={{ id: perfume.id, title: perfume.title }}
        formulations={formulations}
        selectedId={selected?.id ?? null}
        clearHref={base}
        vocabularies={vocabularies}
        inherited={inherited}
        sources={choices}
        locations={locations}
      />

      <BottlesSection
        perfumeTitle={perfume.title}
        bottles={bottles}
        summary={heldSummary}
        formulations={formulationChoices}
        locations={locations}
      />

      <WantedSection
        workId={perfume.id}
        title={perfume.title}
        targets={wanted}
        choices={{ kind: "perfume", formulations: formulationChoices }}
        locations={{ physical: locations, digital: [] }}
      />

      <RetailersSection
        perfumeId={perfume.id}
        perfumeTitle={perfume.title}
        listings={perfume.retailers}
        formulations={formulationChoices}
      />

      <LinkedWorksSection
        work={{ id: perfume.id, kind: "perfume", title: perfume.title }}
        relations={links}
        ebooks={linkedEbooks}
        readerReturnTo={base}
      />

      <GallerySection entityType="work" entityId={perfume.id} />

      <SourcesSection
        owner={{ kind: "perfume", id: perfume.id }}
        title={perfume.title}
        sources={sources}
        examples={{
          name: "e.g. Fragrantica",
          says: "Launch year, perfumer",
        }}
        lookup={<PerfumeSourceLookup key="lookup" perfume={{ id: perfume.id, title: perfume.title, fingerprint: perfume.fingerprint }} />}
      />

      <PersonalNotes notes={curation?.notes ?? null} placeholder="How it wears on you, when you reach for it" />

      <RelatedPerfumes related={related} />

      <WorkCollectionsSection {...inCollections} />

      <ActivityTimeline entityType="work" entityId={perfume.id} refreshKey={renderStamp()} />
    </CurationProvider>
  );
}
