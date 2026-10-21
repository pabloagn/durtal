import { z } from "zod/v4";
import { isSupportedCurrency } from "@/lib/constants/currencies";
import { toUpdateSchema } from "./helpers";

export const orderStatusSchema = z.enum([
  "placed",
  "confirmed",
  "processing",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "purchased",
  "received",
  "bid",
  "won",
  "cancelled",
  "returned",
]);

/** An ISO 4217 code from the supported list, or null for orders without money. */
export const orderCurrencySchema = z
  .string()
  .refine(isSupportedCurrency, "Unsupported currency")
  .nullable();

export const createOrderSchema = z.object({
  workId: z.string().uuid(),
  acquisitionTargetId: z.uuid().nullable().optional(),
  editionId: z.string().uuid().nullable().optional(),
  instanceId: z.string().uuid().nullable().optional(),
  venueId: z.string().uuid().nullable().optional(),
  acquisitionMethod: z.enum([
    "online_order",
    "in_store_purchase",
    "gift",
    "digital_purchase",
    "auction",
    "event_purchase",
  ]),
  status: orderStatusSchema.optional(),
  orderDate: z.string().min(1),
  orderConfirmation: z.string().nullable().optional(),
  orderUrl: z.string().nullable().optional(),
  price: z.string().nullable().optional(),
  shippingCost: z.string().nullable().optional(),
  totalCost: z.string().nullable().optional(),
  currency: orderCurrencySchema.optional(),
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

/** Partial update: no defaults, unknown keys rejected (see toUpdateSchema). */
export const updateOrderSchema = toUpdateSchema(createOrderSchema);

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.input<typeof updateOrderSchema>;

const orderMoney = z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/, "Use a positive amount with at most two decimal places").nullable().optional();
export const createOrderGroupSchema = createOrderSchema.omit({
  workId: true, price: true, totalCost: true, instanceId: true,
  acquisitionTargetId: true, editionId: true,
}).extend({
  shippingCost: orderMoney,
  items: z.array(z.object({
    workId: z.uuid(),
    editionId: z.uuid().nullable().optional(),
    acquisitionTargetId: z.uuid().nullable().optional(),
    price: orderMoney,
  })).min(2).max(50),
}).refine((value) => new Set(value.items.map((item) => item.workId)).size === value.items.length,
  "Choose each book only once");
