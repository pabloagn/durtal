import Link from "next/link";
import type { WorkWithRelations } from "@/lib/types";
import type { getOrdersForWork } from "@/lib/actions/orders";
import { Badge } from "@/components/ui/badge";
import { RecordGroup, RecordPanel } from "@/components/shared/detail-layout";
import { WorkDetails } from "./work-metadata-grid";
import { WorkTaxonomySection } from "./work-taxonomy-section";

type Order = Awaited<ReturnType<typeof getOrdersForWork>>[number];

const ORDER_STATUS_VARIANT: Record<
  string,
  "default" | "blue" | "gold" | "sage" | "red" | "muted"
> = {
  placed: "muted",
  confirmed: "blue",
  processing: "gold",
  shipped: "sage",
  in_transit: "sage",
  out_for_delivery: "gold",
  delivered: "sage",
  purchased: "sage",
  received: "sage",
  bid: "gold",
  won: "sage",
  cancelled: "red",
  returned: "red",
};

/**
 * The book page's record column: details, taxonomy, media counts, orders and
 * links. A group with nothing to show is left out.
 */
export function WorkRecord({
  work,
  orders,
  media,
  links,
}: {
  work: WorkWithRelations;
  orders: Order[];
  media: { posters: number; backgrounds: number; gallery: number };
  links: { label: string; href: string }[];
}) {
  const mediaParts = (
    [
      [media.posters, "poster", "posters"],
      [media.backgrounds, "background", "backgrounds"],
      [media.gallery, "gallery image", "gallery images"],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);

  return (
    <RecordPanel>
      <WorkDetails work={work} />
      <WorkTaxonomySection work={work} />

      {mediaParts.length > 0 && (
        <RecordGroup title="Media">
          <p className="text-sm text-fg-primary">{mediaParts.join(" · ")}</p>
        </RecordGroup>
      )}

      {orders.length > 0 && (
        <RecordGroup
          title="Orders"
          action={
            <Link
              href="/provenance"
              className="text-xs text-fg-secondary transition-colors hover:text-fg-primary"
            >
              Pipeline
            </Link>
          }
        >
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <Badge variant={ORDER_STATUS_VARIANT[order.status] ?? "muted"}>
                    {order.status.replace(/_/g, " ")}
                  </Badge>
                  <span className="shrink-0 font-mono text-micro text-fg-secondary">
                    {new Date(order.orderDate).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <p className="mt-1 lines-1 text-xs text-fg-secondary">
                  {order.venue?.name ?? order.acquisitionMethod.replace(/_/g, " ")}
                </p>
              </li>
            ))}
          </ul>
        </RecordGroup>
      )}

      {(links.length > 0 || work.metadataSource) && (
        <RecordGroup title="Links">
          {links.length > 0 && (
            <ul className="space-y-1.5">
              {links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-accent-rose-text transition-colors hover:text-fg-primary"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {work.metadataSource && (
            <p
              className={`text-xs text-fg-secondary ${links.length > 0 ? "mt-3" : ""}`}
            >
              Metadata from {work.metadataSource}
              {work.metadataSourceId && (
                <span className="ml-1 font-mono">{work.metadataSourceId}</span>
              )}
            </p>
          )}
        </RecordGroup>
      )}
    </RecordPanel>
  );
}
