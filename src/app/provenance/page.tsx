import Link from "next/link";
import { redirect } from "next/navigation";
import { parsePagination, lastPage, pageHref, type ListSearchParams } from "@/lib/utils/pagination";
import { PaginatedSection } from "@/components/shared/pagination";
import { getTargetOrderSeed } from "@/lib/actions/publishers";
import { Suspense } from "react";
import { getActiveOrders, getProvenanceStats, getOrderTimeline } from "@/lib/actions/orders";
import { PageHeader } from "@/components/layout/page-header";
import { Spinner } from "@/components/ui/spinner";
import { ProvenanceShell } from "./provenance-shell";
import { OrderCreateDialog } from "./order-create-dialog";
import type { OrderItem, ProvenanceStats } from "./provenance-shell";

async function ProvenanceContent() {
  const [rawOrders, stats] = await Promise.all([
    getActiveOrders(),
    getProvenanceStats(),
  ]);

  const orders: OrderItem[] = rawOrders.map((o) => ({
    id: o.id,
    workId: o.workId,
    editionId: o.editionId,
    acquisitionTargetId: o.acquisitionTargetId,
    work: {
      id: o.work.id,
      title: o.work.title,
      slug: o.work.slug ?? "",
      workAuthors: o.work.workAuthors.map((wa) => ({
        author: { id: wa.author.id, name: wa.author.name },
      })),
      media: o.work.media.map((m) => ({
        s3Key: m.s3Key,
        thumbnailS3Key: m.thumbnailS3Key,
        type: m.type,
        isActive: m.isActive,
        cropX: m.cropX,
        cropY: m.cropY,
        cropZoom: m.cropZoom,
        brightness: m.brightness,
        contrast: m.contrast,
      })),
    },
    venue: o.venue
      ? {
          id: o.venue.id,
          name: o.venue.name,
          slug: o.venue.slug ?? "",
          type: o.venue.type,
        }
      : null,
    acquisitionMethod: o.acquisitionMethod,
    status: o.status,
    orderDate: o.orderDate,
    estimatedDeliveryDate: o.estimatedDeliveryDate,
    actualDeliveryDate: o.actualDeliveryDate,
    shippedDate: o.shippedDate,
    carrier: o.carrier,
    trackingNumber: o.trackingNumber,
    trackingUrl: o.trackingUrl,
    orderUrl: o.orderUrl,
    orderConfirmation: o.orderConfirmation,
    price: o.price,
    shippingCost: o.shippingCost,
    totalCost: o.totalCost,
    currency: o.currency,
    notes: o.notes,
    createdAt: o.createdAt,
  }));

  const provenanceStats: ProvenanceStats = {
    spentByCurrency: stats.spentByCurrency,
    avgOrderCost: stats.avgOrderCost ?? "0",
    orderCount: stats.orderCount,
    activeOrders: stats.activeOrders,
    inTransit: stats.inTransit,
    arrivingThisWeek: stats.arrivingThisWeek,
  };

  return <ProvenanceShell activeOrders={orders} stats={provenanceStats} />;
}

async function OrderHistory({ params }: { params: ListSearchParams }) {
  const { page, perPage, offset } = parsePagination(params);
  const { orders, total } = await getOrderTimeline(undefined, { limit: perPage, offset });
  if (page > lastPage(total, perPage)) redirect(pageHref("/provenance", params, lastPage(total, perPage)));
  return <section className="mt-10">
    <h2 className="font-serif text-2xl text-fg-primary">Acquisition history</h2>
    <PaginatedSection page={page} perPage={perPage} total={total} noun="orders">
      <div className="space-y-2">{orders.map((order) => <Link key={order.id} href={`/library/${order.work.slug}`} className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-glass-border p-3 hover:bg-bg-secondary">
        <span><span className="block text-sm text-fg-primary">{order.work.title}</span><span className="text-xs text-fg-muted">{order.work.workAuthors.map((wa) => wa.author.name).join(", ")}</span></span>
        <span className="font-mono text-xs text-fg-muted">{order.orderDate} · {order.status.replace(/_/g, " ")}{order.venue ? ` · ${order.venue.name}` : ""}</span>
      </Link>)}</div>
      {!total && <p className="py-6 text-sm text-fg-muted">No acquisitions yet.</p>}
    </PaginatedSection>
  </section>;
}

export default async function ProvenancePage({
  searchParams,
}: {
  searchParams: Promise<ListSearchParams>;
}) {
  const params = await searchParams;
  const target = typeof params.target === "string" ? params.target : undefined;
  const seed =
    target && /^[0-9a-f-]{36}$/i.test(target)
      ? await getTargetOrderSeed(target)
      : null;
  return (
    <>
      <PageHeader
        title="Provenance"
        description="Track the acquisition pipeline for incoming books"
        actions={
          <OrderCreateDialog key={seed?.target.id ?? "new"} seed={seed} />
        }
      />

      <Suspense
        fallback={
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-6 w-6" />
          </div>
        }
      >
        <ProvenanceContent />
      </Suspense>
      <Suspense key={JSON.stringify(params)} fallback={<Spinner />}><OrderHistory params={params} /></Suspense>
    </>
  );
}
