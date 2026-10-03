import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collections } from "@/lib/db/schema";
import {
  getCollection,
  setCollectionIcon,
  updateCollection,
} from "@/lib/actions/collections";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";
import { patchCollectionBodySchema } from "@/lib/validations/collections-api";

type Params = { params: Promise<{ id: string }> };

/** GET /api/collections/[id] — one collection with its editions in order. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const collection = await getCollection(id);
    if (!collection) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(collection);
  } catch (err) {
    return errorResponse(err, "Failed to fetch collection");
  }
}

/**
 * PATCH /api/collections/[id] — change the name, description or icon, as the
 * collection page does. Fields left out stay as they are.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const { icon, ...details } = patchCollectionBodySchema.parse(
      await readJson(req),
    );
    const found = await db.query.collections.findFirst({
      where: eq(collections.id, id),
      columns: { id: true },
    });
    if (!found) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (Object.keys(details).length) await updateCollection(id, details);
    if (icon !== undefined) await setCollectionIcon(id, icon);
    const collection = await db.query.collections.findFirst({
      where: eq(collections.id, id),
    });
    return NextResponse.json(collection);
  } catch (err) {
    return errorResponse(err, "Failed to update collection");
  }
}
