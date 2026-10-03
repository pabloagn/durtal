import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collections } from "@/lib/db/schema";
import {
  bulkAddEditionsToCollection,
  removeEditionsFromCollection,
} from "@/lib/actions/collections";
import { missingEditions } from "@/lib/api/missing-editions";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";
import { collectionEditionsBodySchema } from "@/lib/validations/collections-api";

type Params = { params: Promise<{ id: string }> };
type ReadResult =
  | { ok: false; response: NextResponse }
  | { ok: true; id: string; editionIds: string[] };

/** The collection ID and body, or the error response that refuses them. */
async function readRequest(
  req: NextRequest,
  { params }: Params,
): Promise<ReadResult> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid ID format" }, { status: 400 }),
    };
  }
  const { editionIds } = collectionEditionsBodySchema.parse(await readJson(req));
  const found = await db.query.collections.findFirst({
    where: eq(collections.id, id),
    columns: { id: true },
  });
  if (!found) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  return { ok: true, id, editionIds };
}

/**
 * POST /api/collections/[id]/editions — add editions at the end of the
 * collection, in the order given. Editions already in it stay where they are.
 */
export async function POST(req: NextRequest, ctx: Params) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const request = await readRequest(req, ctx);
    if (!request.ok) return request.response;
    const missing = await missingEditions(request.editionIds);
    if (missing.length) {
      return NextResponse.json(
        { error: "Editions not found", missing },
        { status: 404 },
      );
    }
    const result = await bulkAddEditionsToCollection(
      request.id,
      request.editionIds,
    );
    return NextResponse.json({ added: result.changed });
  } catch (err) {
    return errorResponse(err, "Failed to add editions");
  }
}

/** DELETE /api/collections/[id]/editions — take editions out of the collection. */
export async function DELETE(req: NextRequest, ctx: Params) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const request = await readRequest(req, ctx);
    if (!request.ok) return request.response;
    const result = await removeEditionsFromCollection(
      request.id,
      request.editionIds,
    );
    return NextResponse.json({ removed: result.changed });
  } catch (err) {
    return errorResponse(err, "Failed to remove editions");
  }
}
