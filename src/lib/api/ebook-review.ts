import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod/v4";
import { requireApiToken, readJson, UUID_RE } from "./rest";
import { crossOriginRefusal } from "./same-origin";
import {
  confirmedEbookReviewSchema, prepareEbookReviewSchema, undoEbookDecisionSchema,
  prepareReviewSelectionSchema, confirmedReviewSelectionSchema, undoReviewSelectionSchema,
  prepareWorkReviewSchema, confirmedWorkReviewSchema, undoWorkAccessionedSchema,
} from "@/lib/validations/ebook-review";
import {
  createReviewContext, prepareEbookReview, applyEbookReview, undoEbookReview,
} from "@/lib/ebooks/review/service";
import { getEbookReview } from "@/lib/ebooks/review/queries";
import { ReviewError, ReviewPreparationError } from "@/lib/ebooks/review/errors";
import type { SupportedDecision } from "@/lib/ebooks/review/store";
import { prepareEbookReviewSelection, applyEbookReviewSelection, undoEbookReviewSelection } from "@/lib/ebooks/review/bulk";
import { prepareWorkStatusReview, applyWorkStatusReview, undoWorkStatusReview } from "@/lib/ebooks/review/work-service";
import { prepareReviewUnlinkIntentSchema } from "@/lib/ebooks/review/unlink-contract";
import { prepareEbookUnlinkReview, applyEbookUnlinkReview, confirmedReviewUnlinkSchema } from "@/lib/ebooks/review/unlink-service";

const invalid = (message: string) => NextResponse.json({ error: message }, { status: 400 });
export function reviewErrorResponse(error: unknown) {
  if (error instanceof z.ZodError)
    return NextResponse.json({ error: "Invalid input", issues: error.issues }, { status: 400 });
  if (error instanceof ReviewError) {
    const status = ["ebook_not_found", "work_not_found"].includes(error.code) ? 404 :
      error.code === "preparation_required" ? 422 :
      error.code === "invalid_receipt" ? 500 :
      ["outcome_unknown_retry_original", "preparation_unavailable"].includes(error.code) ? 503 : 409;
    return NextResponse.json({ error: error.message, code: error.code,
      ...(error instanceof ReviewPreparationError ? { issues: error.issues } : {}) }, { status });
  }
  return NextResponse.json({ error: "The eBook review could not be completed." }, { status: 500 });
}
type Params = Promise<{ id: string }>;
async function checkedId(params: Params) {
  const { id } = await params;
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}
export async function handleReviewPrepareRoute(req: NextRequest, params: Params) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const intent = prepareEbookReviewSchema.parse(await readJson(req));
    if (intent.ebookId !== id) return invalid("Path and request eBook IDs differ");
    return NextResponse.json(await prepareEbookReview(intent, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewDecisionRoute(
  req: NextRequest, params: Params, allowed: readonly SupportedDecision["action"][],
) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const body = confirmedEbookReviewSchema.parse(await readJson(req));
    if (!("ebookId" in body.request) || body.request.action === "unlink" ||
        !(allowed as readonly string[]).includes(body.request.action)) return invalid("Action is not supported by this route");
    if (body.request.ebookId !== id) return invalid("Path and request eBook IDs differ");
    return NextResponse.json(await applyEbookReview(body.request, body.previewToken, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewUndoRoute(req: NextRequest, params: Params) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const input = undoEbookDecisionSchema.parse(await readJson(req));
    if (input.ebookId !== id) return invalid("Path and request eBook IDs differ");
    return NextResponse.json(await undoEbookReview(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewReadRoute(req: NextRequest, params: Params) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const context = createReviewContext("api");
    return NextResponse.json(await getEbookReview(context.planningUrl, id));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewSelectionPrepareRoute(req: NextRequest) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const input = prepareReviewSelectionSchema.parse(await readJson(req));
    return NextResponse.json(await prepareEbookReviewSelection(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewSelectionConfirmRoute(req: NextRequest) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const input = confirmedReviewSelectionSchema.parse(await readJson(req));
    if (input.requests.some((request) => !("ebookId" in request) || request.action === "unlink") ||
        (input.requests.length > 1 && input.requests.some((request) => request.action !== "accession")))
      return invalid("Confirm only the prepared core commit unit");
    return NextResponse.json(await applyEbookReviewSelection(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewSelectionUndoRoute(req: NextRequest) {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const input = undoReviewSelectionSchema.parse(await readJson(req));
    return NextResponse.json(await undoEbookReviewSelection(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleWorkReviewRoute(req: NextRequest, params: Params, mode: "preview" | "status" | "undo") {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const body = await readJson(req);
    if (mode === "preview") {
      const input = prepareWorkReviewSchema.parse(body);
      if (input.workId !== id) return invalid("Path and request book IDs differ");
      return NextResponse.json(await prepareWorkStatusReview(input, createReviewContext("api")));
    }
    if (mode === "status") {
      const input = confirmedWorkReviewSchema.parse(body);
      if (input.request.workId !== id) return invalid("Path and request book IDs differ");
      return NextResponse.json(await applyWorkStatusReview(input, createReviewContext("api")));
    }
    const input = undoWorkAccessionedSchema.parse(body);
    if (input.workId !== id) return invalid("Path and request book IDs differ");
    return NextResponse.json(await undoWorkStatusReview(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
export async function handleReviewUnlinkRoute(req: NextRequest, params: Params, mode: "preview" | "confirm") {
  const denied = requireApiToken(req) ?? crossOriginRefusal(req);
  if (denied) return denied;
  try {
    const id = await checkedId(params);
    if (!id) return invalid("Invalid ID format");
    const body = await readJson(req);
    if (mode === "preview") {
      const input = prepareReviewUnlinkIntentSchema.parse(body);
      if (input.ebookId !== id) return invalid("Path and request eBook IDs differ");
      return NextResponse.json(await prepareEbookUnlinkReview(input, createReviewContext("api")));
    }
    const input = confirmedReviewUnlinkSchema.parse(body);
    if (input.request.ebookId !== id) return invalid("Path and request eBook IDs differ");
    return NextResponse.json(await applyEbookUnlinkReview(input, createReviewContext("api")));
  } catch (error) { return reviewErrorResponse(error); }
}
