import Link from "next/link";
import { FavouriteToggle } from "@/components/shared/favourite-toggle";
import { CardHeading } from "@/components/shared/card-heading";
import { WORK_CARD, WORK_CARD_BODY, WorkCardInfo } from "@/components/shared/work-card";
import { WorkRow } from "@/components/shared/work-row";
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
export function perfumeFactParts(perfume: PerfumeCardData) {
  const concentrations = [
    ...new Set(perfume.formulations.map((f) => formulationName(f, { short: true }))),
  ];
  return [catalogueDateYears(perfume.releaseDate), ...concentrations].filter(
    (fact): fact is string => !!fact,
  );
}

export function perfumeFacts(perfume: PerfumeCardData) {
  return perfumeFactParts(perfume).join(" · ");
}

function heldCounts(perfume: PerfumeCardData) {
  const { bottles, samples, decants } = perfume.holdings;
  return { bottle: bottles, sample: samples, decant: decants };
}

/**
 * A perfume in a grid: its bottle in its square frame, then a book card's
 * heading and info row (SLN-478): title, house, rating and release year,
 * on fixed lines. A chip marks what is in the collection.
 */
export function PerfumeCard({
  perfume,
}: {
  perfume: PerfumeCardData;
}) {
  const held = holdingsSummary(heldCounts(perfume));
  const count =
    perfume.holdings.bottles + perfume.holdings.samples + perfume.holdings.decants;
  return (
    <div className={WORK_CARD}>
      <Link
        href={perfumeHref(perfume)}
        aria-label={perfume.title}
        className="absolute inset-0 z-10 rounded-sm"
      />
      <div className="relative cover-shadow">
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
      <div className={WORK_CARD_BODY}>
        {/* As on a book's card: two title lines and one line of house,
            then the info row, so cards of every collection line up */}
        <CardHeading
          title={perfume.title}
          subtitle={perfumeMakers(perfume) ?? "Unknown house"}
          action={
            <FavouriteToggle
              favourite={perfume.isFavourite}
              target={{ entity: "work", id: perfume.id }}
              name={perfume.title}
            />
          }
        />
        <WorkCardInfo
          rating={perfume.rating}
          year={catalogueDateYears(perfume.releaseDate)}
        />
      </div>
    </div>
  );
}

/** A perfume in a list (`WorkRow`): a small bottle, title, house and facts, what is held */
export function PerfumeRow({ perfume }: { perfume: PerfumeCardData }) {
  return (
    <WorkRow
      href={perfumeHref(perfume)}
      thumbnail={<PerfumeImage image={perfume.poster} title={perfume.title} small className="h-12 w-12 shrink-0 rounded-sm" />}
      title={perfume.title}
      facts={[perfumeMakers(perfume) ?? "Unknown house", ...perfumeFactParts(perfume)]}
      held={holdingsSummary(heldCounts(perfume))}
      favourite={{ on: perfume.isFavourite, workId: perfume.id }}
    />
  );
}
