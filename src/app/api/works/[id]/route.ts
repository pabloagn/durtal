import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { recommenders } from "@/lib/db/schema";
import { getWork, updateWork } from "@/lib/actions/works";
import { addWorkRecommenders } from "@/lib/actions/recommenders";
import { createWorkSchema } from "@/lib/validations/works";
import {
  UUID_RE,
  errorResponse,
  readJson,
  requireApiToken,
} from "@/lib/api/rest";
import { RATING_SCHEMA } from "@/lib/validations/helpers";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const work = await getWork(id);
    if (!work) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(work);
  } catch (err) {
    console.error("[api/works/:id] Failed to fetch work:", err);
    return NextResponse.json({ error: "Failed to fetch work" }, { status: 500 });
  }
}

/**
 * The fields a work PATCH may change. `addRecommenderIds` adds recommenders
 * and keeps the existing ones; `rating` null clears the rating. Unknown fields
 * are refused.
 */
const patchWorkSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    catalogueStatus: createWorkSchema.shape.catalogueStatus.unwrap().optional(),
    addRecommenderIds: z.array(z.uuid()).optional(),
    rating: RATING_SCHEMA,
  })
  .strict();

/**
 * PATCH /api/works/[id] — change a work's title (the slug follows), catalogue
 * status or rating, as the Edit dialog does (activity log included), and add
 * recommenders.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const denied = requireApiToken(req);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
    }
    const { title, catalogueStatus, addRecommenderIds, rating } =
      patchWorkSchema.parse(await readJson(req));
    if (!(await getWork(id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Checked before any write: an unknown recommender changes nothing
    if (addRecommenderIds?.length) {
      const found = await db
        .select({ id: recommenders.id })
        .from(recommenders)
        .where(inArray(recommenders.id, addRecommenderIds));
      if (found.length !== new Set(addRecommenderIds).size) {
        return NextResponse.json({ error: "Recommender not found" }, { status: 404 });
      }
    }

    if (title || catalogueStatus || rating !== undefined) {
      await updateWork(id, {
        ...(title ? { title } : {}),
        ...(catalogueStatus ? { catalogueStatus } : {}),
        ...(rating !== undefined ? { rating } : {}),
      });
    }
    const recommendersAdded = addRecommenderIds
      ? await addWorkRecommenders(id, addRecommenderIds)
      : 0;

    const work = await getWork(id);
    return NextResponse.json({
      id,
      title: work?.title,
      slug: work?.slug,
      catalogueStatus: work?.catalogueStatus,
      rating: work?.rating ?? null,
      recommenderIds: work?.workRecommenders.map((wr) => wr.recommender.id),
      recommendersAdded,
    });
  } catch (err) {
    return errorResponse(err, "Failed to update work");
  }
}
