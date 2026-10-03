import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { works } from "@/lib/db/schema";
import {
  createOrder,
  getActiveOrders,
  getOrdersForWork,
} from "@/lib/actions/orders";
import { TERMINAL_STATUSES } from "@/lib/constants/orders";
import { createOrderSchema } from "@/lib/validations/orders";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";

/** GET /api/orders[?workId=<uuid>] — orders of one work, or all active orders. */
export async function GET(req: NextRequest) {
  try {
    const workId = req.nextUrl.searchParams.get("workId");
    if (workId) {
      if (!UUID_RE.test(workId)) {
        return NextResponse.json({ error: "Invalid workId" }, { status: 400 });
      }
      return NextResponse.json({ orders: await getOrdersForWork(workId) });
    }
    return NextResponse.json({ orders: await getActiveOrders() });
  } catch (err) {
    return errorResponse(err, "Failed to fetch orders");
  }
}

/**
 * POST /api/orders[?allowDuplicate=1] — create an order, exactly as the New
 * Order dialog does (status history, work catalogue status).
 *
 * A work that already has an active order is refused with 409, so the same
 * screenshot entered twice does not create two orders. `allowDuplicate=1`
 * creates a second order on purpose (a second copy).
 */
export async function POST(req: NextRequest) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const input = createOrderSchema.parse(await readJson(req));

    const work = await db.query.works.findFirst({
      where: eq(works.id, input.workId),
      columns: { id: true },
    });
    if (!work) {
      return NextResponse.json({ error: "Work not found" }, { status: 404 });
    }

    if (req.nextUrl.searchParams.get("allowDuplicate") !== "1") {
      const active = (await getOrdersForWork(input.workId)).filter(
        (o) => !TERMINAL_STATUSES.includes(o.status),
      );
      if (active.length > 0) {
        return NextResponse.json(
          {
            error: "The work already has an active order",
            orders: active.map((o) => ({ id: o.id, status: o.status })),
          },
          { status: 409 },
        );
      }
    }

    const order = await createOrder(input);
    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to create order");
  }
}
