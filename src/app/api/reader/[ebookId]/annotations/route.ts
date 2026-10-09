import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { readJson } from "@/lib/api/rest";
import { isUuid } from "@/lib/utils/uuid";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
import { expectedDeviceRefusal } from "@/lib/reader/device-guard";
import { canonicalAnnotationTime } from "@/lib/reader/sync/annotation-time";
import { annotationBodySchema } from "@/lib/validations/annotations";
import {
  AnnotationInputError,
  annotationBookExists,
  annotationFilesBelong,
  readAnnotations,
  saveAnnotations,
} from "@/lib/reader/annotation-store";
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ ebookId: string }> };
const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function context(req: NextRequest, params: Params["params"]) {
  const origin = crossOriginRefusal(req);
  if (origin) {
    origin.headers.set("Cache-Control", "no-store");
    return origin;
  }
  const { ebookId } = await params;
  if (!isUuid(ebookId)) return json(400, { error: "Invalid eBook id" });
  const refused = expectedDeviceRefusal(req);
  if (refused) return refused;
  return ebookId.toLowerCase();
}
export async function GET(req: NextRequest, { params }: Params) {
  const ebookId = await context(req, params);
  if (ebookId instanceof NextResponse) return ebookId;
  const input = req.nextUrl.searchParams.get("since");
  let since: string | null;
  try {
    since = input === null ? null : canonicalAnnotationTime(input);
  } catch {
    return json(400, { error: "Invalid annotation cursor" });
  }
  try {
    if (!(await annotationBookExists(ebookId)))
      return json(404, { error: "Not found" });
    return json(200, await readAnnotations(ebookId, since));
  } catch (error) {
    if (error instanceof AnnotationInputError)
      return json(400, { error: error.message });
    console.error("[api/reader/annotations] Pull failed:", error);
    return json(500, { error: "Could not load annotations" });
  }
}
export async function POST(req: NextRequest, { params }: Params) {
  const ebookId = await context(req, params);
  if (ebookId instanceof NextResponse) return ebookId;
  const device = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(device))
    return json(400, { error: "No device id: open the reader first" });
  const parsed = annotationBodySchema().safeParse((await readJson(req)) ?? {});
  if (!parsed.success)
    return json(400, {
      error: parsed.error.issues[0]?.message ?? "Invalid annotation input",
      issues: parsed.error.issues,
    });
  try {
    if (!(await annotationBookExists(ebookId)))
      return json(404, { error: "Not found" });
    if (!(await annotationFilesBelong(ebookId, parsed.data)))
      return json(400, {
        error: "The passage is not from a file of this eBook",
      });
    return json(200, await saveAnnotations(ebookId, device, parsed.data));
  } catch (error) {
    console.error("[api/reader/annotations] Save failed:", error);
    return json(500, { error: "Could not save annotations" });
  }
}
