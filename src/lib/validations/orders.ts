import { z } from "zod/v4";
import { toUpdateSchema } from "./helpers";

export const orderStatusSchema = z.enum(["placed", "confirmed", "processing", "shipped", "in_transit", "out_for_delivery", "delivered", "purchased", "received", "bid", "won", "cancelled", "returned"]);

export const createOrderSchema = z.object({
  workId: z.string().uuid(),
  editionId: z.string().uuid().nullable().optional(),
  instanceId: z.string().uuid().nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),
  acquisitionMethod: z.enum(["online_order", "in_store_purchase", "gift", "digital_purchase", "auction", "event_purchase"]),
  status: orderStatusSchema.optional(),
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

/** Partial update: no defaults, unknown keys rejected. */
export const updateOrderSchema = toUpdateSchema(createOrderSchema);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.input<typeof updateOrderSchema>;
