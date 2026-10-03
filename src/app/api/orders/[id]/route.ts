import { NextRequest, NextResponse } from "next/server";
import { getOrder, updateOrder } from "@/lib/actions/orders";
import { createOrderSchema } from "@/lib/validations/orders";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";

/**
 * Fields an order PATCH may change. Status is left out on purpose: it moves
 * through POST /api/orders/[id]/status, which checks the transition and
 * records the history. Unknown fields are refused, so a typo is not ignored.
 */
const updateOrderBodySchema = createOrderSchema
  .omit({ status: true })
  .partial()
  .strict();

type Params = { params: Promise<{ id: string }> };

/** GET /api/orders/[id] — one order with its work, venue and status history. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const order = await getOrder(id);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(order);
  } catch (err) {
    return errorResponse(err, "Failed to fetch order");
  }
}

/** PATCH /api/orders/[id] — change order details (price, dates, carrier...). */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const input = updateOrderBodySchema.parse(await readJson(req));
    if (!(await getOrder(id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(await updateOrder(id, input));
  } catch (err) {
    return errorResponse(err, "Failed to update order");
  }
}
