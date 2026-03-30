import { Suspense } from "react";
import { Route } from "lucide-react";
import { getActiveOrders, getProvenanceStats } from "@/lib/actions/orders";
import { PageHeader } from "@/components/layout/page-header";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
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
    totalSpent: stats.totalSpent ?? "0",
    avgOrderCost: stats.avgOrderCost ?? "0",
    orderCount: stats.orderCount,
    activeOrders: stats.activeOrders,
    inTransit: stats.inTransit,
    arrivingThisWeek: stats.arrivingThisWeek,
  };

  return <ProvenanceShell activeOrders={orders} stats={provenanceStats} />;
}

export default async function ProvenancePage() {
  return (
    <>
      <PageHeader
        title="Provenance"
        description="Track the acquisition pipeline for incoming books"
        actions={<OrderCreateDialog />}
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
    </>
  );
}
