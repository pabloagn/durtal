import Link from "next/link";
import { CapAligned } from "@/components/shared/cap-aligned";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { Droplet } from "lucide-react";
import type { getPerfumes } from "@/lib/actions/perfumes";
import { catalogueDateYears } from "@/lib/catalogue/dates";
import { formulationName, holdingsSummary } from "@/lib/catalogue/perfume-labels";
import {
  COVER_CHIP,
  COVER_CHIP_ICON,
  COVER_CHIP_TEXT,
  COVER_CHIP_TONE,
  COVER_CORNER,
} from "@/components/books/cover-chip";
import { PerfumeImage } from "./perfume-image";

export type PerfumeCardData = Awaited<ReturnType<typeof getPerfumes>>[number];

export function perfumeHref(perfume: { id: string; slug: string | null }) {
  return `/perfumes/${perfume.slug ?? perfume.id}`;
}

/** The houses (or brands), else the perfumers: who the perfume is by */
export function perfumeMakers(perfume: PerfumeCardData) {
  const houses = perfume.organizations
    .filter((o) => o.role !== "manufacturer")
    .map((o) => o.name);
  const names = houses.length
    ? houses
    : perfume.perfumers.flatMap((p) => (p.name ? [p.name] : []));
  return names.length ? [...new Set(names)].join(", ") : null;
}

/** "1925 · EDP · Extrait": the release and the concentrations made */
export function perfumeFacts(perfume: PerfumeCardData) {
  const concentrations = [
    ...new Set(perfume.formulations.map((f) => formulationName(f, { short: true }))),
  ];
  return [catalogueDateYears(perfume.releaseDate), ...concentrations]
    .filter(Boolean)
    .join(" · ");
}

function heldCounts(perfume: PerfumeCardData) {
  const { bottles, samples, decants } = perfume.holdings;
  return { bottle: bottles, sample: samples, decant: decants };
}

/**
 * A perfume in a grid: its bottle, title, house and facts, each on fixed
 * lines so every card of a grid has one height. Chips mark a favourite and
 * what is in the collection.
 */
export function PerfumeCard({
  perfume,
  caption,
}: {
  perfume: PerfumeCardData;
  /** Replaces the facts line: why the card is shown ("Shares iris, vanilla") */
  caption?: string;
}) {
  const held = holdingsSummary(heldCounts(perfume));
  const count =
    perfume.holdings.bottles + perfume.holdings.samples + perfume.holdings.decants;
  return (
    <div className="@container group relative block rounded-sm border border-glass-border bg-bg-secondary card-interactive">
      <Link
        href={perfumeHref(perfume)}
        aria-label={perfume.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative shadow-[0_2px_16px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.05]">
        <PerfumeImage image={perfume.poster} title={perfume.title} />
        {held && (
          <div className={`${COVER_CORNER.topRight} z-20` /* above the card's link, so its tooltip opens */}>
            <span
              role="img"
              aria-label={`In the collection: ${held}`}
              className={`${COVER_CHIP} ${COVER_CHIP_TEXT} gap-0.5 text-fg-primary`}
              data-tooltip={`In the collection: ${held}`}
            >
              <Droplet className={`${COVER_CHIP_ICON} ${COVER_CHIP_TONE.sage}`} strokeWidth={1.5} />
              {count}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        {/* The row carries the title's type: the star sits on the
            cap-height center of the title's first line */}
        <div className="type-item-title flex items-start gap-2">
          <h3 className="type-item-title lines-2 min-w-0 flex-1">{perfume.title}</h3>
          <CapAligned height={32} className="relative z-20 -mr-2">
            <FavouriteToggle
              favourite={perfume.isFavourite}
              target={{ entity: "work", id: perfume.id }}
              name={perfume.title}
            />
          </CapAligned>
        </div>
        <p className="mt-1 lines-1 text-sm text-fg-secondary">
          {perfumeMakers(perfume) ?? "Unknown house"}
        </p>
        <p className="mt-1.5 lines-1 font-mono text-micro text-fg-secondary">
          {caption ?? perfumeFacts(perfume)}
        </p>
      </div>
    </div>
  );
}

/**
 * A perfume in a list: a small bottle, title, house and facts, what is held.
 * On a narrow page what is held goes under the facts, so the house stays whole.
 */
export function PerfumeRow({ perfume }: { perfume: PerfumeCardData }) {
  const held = holdingsSummary(heldCounts(perfume));
  return (
    <div className="flex items-center gap-3 rounded-sm border border-transparent px-3 py-2 transition-colors hover:border-glass-border hover:bg-bg-secondary/60">
      <Link href={perfumeHref(perfume)} className="flex min-w-0 flex-1 items-center gap-3">
        <PerfumeImage
          image={perfume.poster}
          title={perfume.title}
          small
          className="h-12 w-12 shrink-0 rounded-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="type-item-title truncate">{perfume.title}</p>
          <p className="truncate text-sm text-fg-secondary">
            {[perfumeMakers(perfume) ?? "Unknown house", perfumeFacts(perfume)]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {held && <p className="truncate text-xs text-fg-secondary sm:hidden">{held}</p>}
        </div>
        {held && (
          <span className="hidden shrink-0 text-xs leading-6 text-fg-secondary sm:block">
            {held}
          </span>
        )}
      </Link>
      <FavouriteToggle
        favourite={perfume.isFavourite}
        target={{ entity: "work", id: perfume.id }}
        name={perfume.title}
      />
    </div>
  );
}
