import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { editions, locations } from "@/lib/db/schema";
import { createInstance } from "@/lib/actions/instances";
import { createInstanceSchema } from "@/lib/validations";
import { errorResponse, readJson, requireApiToken } from "@/lib/api/rest";

/**
 * POST /api/instances — add a copy of an edition at a location, exactly as
 * the Add Copy dialog does. The work's catalogue status does not change here;
 * an arrival moves its order with POST /api/orders/[id]/status.
 */
export async function POST(req: NextRequest) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const input = createInstanceSchema.parse(await readJson(req));

    const [edition, location] = await Promise.all([
      db.query.editions.findFirst({
        where: eq(editions.id, input.editionId),
        columns: { id: true },
      }),
      db.query.locations.findFirst({
        where: eq(locations.id, input.locationId),
        columns: { id: true },
      }),
    ]);
    if (!edition) {
      return NextResponse.json({ error: "Edition not found" }, { status: 404 });
    }
    if (!location) {
      return NextResponse.json({ error: "Location not found" }, { status: 404 });
    }

    const instance = await createInstance(input);
    return NextResponse.json(instance, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to create copy");
  }
}
