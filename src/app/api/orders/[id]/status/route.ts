import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getOrder, updateOrderStatus } from "@/lib/actions/orders";
import { getValidTransitions } from "@/lib/constants/orders";
import { createOrderSchema } from "@/lib/validations/orders";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";

const statusBodySchema = z
  .object({
    status: createOrderSchema.shape.status.unwrap(),
    notes: z.string().nullable().optional(),
  })
  .strict();

/**
 * POST /api/orders/[id]/status — move an order to a new status, exactly as
 * the order page does: the transition is checked, the history is recorded,
 * the delivery date is set on arrival and the work's catalogue status follows.
 * An invalid transition is refused with 409 and the allowed statuses.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const { status, notes } = statusBodySchema.parse(await readJson(req));

    const order = await getOrder(id);
    if (!order) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const allowed = getValidTransitions(order.status, order.acquisitionMethod);
    if (!allowed.includes(status)) {
      return NextResponse.json(
        {
          error: `Cannot move from "${order.status}" to "${status}"`,
          allowed,
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      await updateOrderStatus(id, status, notes ?? undefined),
    );
  } catch (err) {
    return errorResponse(err, "Failed to change order status");
  }
}
