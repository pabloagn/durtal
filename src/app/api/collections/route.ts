import { NextRequest, NextResponse } from "next/server";
import {
  createCollection,
  getCollections,
  setCollectionIcon,
} from "@/lib/actions/collections";
import { missingEditions } from "@/lib/api/missing-editions";
import { errorResponse, readJson, requireApiToken } from "@/lib/api/rest";
import { createCollectionBodySchema } from "@/lib/validations/collections-api";

/** GET /api/collections — every collection with its edition count. */
export async function GET() {
  try {
    const rows = await getCollections();
    return NextResponse.json({
      collections: rows.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        editionCount: c.collectionEditions.length,
      })),
    });
  } catch (err) {
    return errorResponse(err, "Failed to fetch collections");
  }
}

/**
 * POST /api/collections — create a collection, as the New Collection dialog
 * does (activity log included). `editionIds` join in the order given.
 * The same `requestId` sent twice creates one collection.
 */
export async function POST(req: NextRequest) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const input = createCollectionBodySchema.parse(await readJson(req));
    const editionIds = input.editionIds ?? [];
    const missing = await missingEditions(editionIds);
    if (missing.length) {
      return NextResponse.json(
        { error: "Editions not found", missing },
        { status: 404 },
      );
    }

    const collection = await createCollection(
      { name: input.name, description: input.description },
      editionIds,
      input.requestId,
    );
    if (input.icon !== undefined) {
      collection.icon = (await setCollectionIcon(collection.id, input.icon)).icon;
    }
    return NextResponse.json(collection, { status: 201 });
  } catch (err) {
    return errorResponse(err, "Failed to create collection");
  }
}
