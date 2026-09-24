import { z } from "zod/v4";

export const createOrderSchema = z.object({
  workId: z.string().uuid(),
  editionId: z.string().uuid().nullable().optional(),
  instanceId: z.string().uuid().nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),
  acquisitionMethod: z.enum(["online_order", "in_store_purchase", "gift", "digital_purchase", "auction", "event_purchase"]),
  status: z.enum(["placed", "confirmed", "processing", "shipped", "in_transit", "out_for_delivery", "delivered", "purchased", "received", "bid", "won", "cancelled", "returned"]).optional(),
  orderDate: z.string().min(1),
  orderConfirmation: z.string().nullable().optional(),
  orderUrl: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  shippingCost: z.string().nullable().optional(),
  totalCost: z.string().nullable().optional(),
  currency: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  trackingUrl: z.string().nullable().optional(),
  shippedDate: z.string().nullable().optional(),
  estimatedDeliveryDate: z.string().nullable().optional(),
  actualDeliveryDate: z.string().nullable().optional(),
  originDescription: z.string().nullable().optional(),
  originPlaceId: z.string().uuid().nullable().optional(),
  destinationLocationId: z.string().uuid().nullable().optional(),
  destinationSubLocationId: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
