import { HorizontalCarousel } from "@/components/shared/horizontal-carousel";
import type { getRelatedPerfumes } from "@/lib/actions/perfumes";
import { PerfumeCard, type PerfumeCardData } from "./perfume-card";

type Related = Awaited<ReturnType<typeof getRelatedPerfumes>>;

function Row({
  title,
  href,
  perfumes,
  caption,
}: {
  title: string;
  href?: string;
  perfumes: PerfumeCardData[];
  caption?: (perfume: PerfumeCardData) => string;
}) {
  return (
    <section className="mb-10">
      <HorizontalCarousel title={title} titleHref={href}>
        {perfumes.map((perfume) => (
          <div key={perfume.id} className="w-[168px] flex-shrink-0 snap-start">
            <PerfumeCard perfume={perfume} caption={caption?.(perfume)} />
          </div>
        ))}
      </HorizontalCarousel>
    </section>
  );
}

/**
 * Fragrances to look at next: the house's, the perfumer's, and those that
 * share notes, each card saying which. Rows with nothing to show are left out.
 */
export function RelatedPerfumes({ related }: { related: Related }) {
  const shared = new Map(related.similar.map((p) => [p.id, p.shared]));
  return (
    <>
      {related.house && (
        <Row
          title={`More from ${related.house.name}`}
          href={`/perfumes?house=${related.house.id}`}
          perfumes={related.house.perfumes}
        />
      )}
      {related.perfumer && (
        <Row
          title={`More by ${related.perfumer.name}`}
          href={`/perfumes?perfumer=${related.perfumer.id}`}
          perfumes={related.perfumer.perfumes}
        />
      )}
      {related.similar.length > 0 && (
        <Row
          title="Shared notes"
          perfumes={related.similar}
          caption={(p) => {
            const names = shared.get(p.id) ?? [];
            return `Shares ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
          }}
        />
      )}
    </>
  );
}
