import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { readJson } from "@/lib/api/rest";
import { isUuid } from "@/lib/utils/uuid";
import { DEVICE_COOKIE, deviceLabel, isDeviceId } from "@/lib/reader/device";
import { devicePositions, ebookAndFile, ebookExists, positionBodySchema, savePosition } from "@/lib/reader/positions";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ ebookId: string }> };

const json = (status: number, body: unknown) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The e-book id of the URL, or the answer that refuses it before any database call */
async function ebookIdOf(req: NextRequest, params: Params["params"]): Promise<string | NextResponse> {
  const refused = crossOriginRefusal(req);
  if (refused) return refused;
  const { ebookId } = await params;
  if (!isUuid(ebookId)) return json(400, { error: "Invalid eBook id" });
  return ebookId.toLowerCase();
}

/**
 * GET /api/reader/[ebookId]/position — this device's place in each file of
 * the e-book (the durtal-device cookie): `{ positions: [...] }`, newest
 * first, empty when this device has not read it. 404 for an unknown e-book.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ebookId = await ebookIdOf(req, params);
  if (ebookId instanceof NextResponse) return ebookId;
  try {
    if (!(await ebookExists(ebookId))) return json(404, { error: "Not found" });
    const device = req.cookies.get(DEVICE_COOKIE)?.value;
    return json(200, { positions: isDeviceId(device) ? await devicePositions(ebookId, device) : [] });
  } catch (err) {
    console.error("[api/reader/position] Failed to read:", err);
    return json(500, { error: "Failed to read the place" });
  }
}

/**
 * POST /api/reader/[ebookId]/position — saves this device's place in one
 * file: `{ fileId, locator, chapter, clientUpdatedAt }`. The newest place by
 * clientUpdatedAt wins; an older one changes only furthestProgression.
 * Answers `{ saved, position }`. 400 for an invalid body, a file of another
 * e-book or a request without the device cookie; 404 for an unknown e-book.
 * The reader also sends it with sendBeacon when the page goes away.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const ebookId = await ebookIdOf(req, params);
  if (ebookId instanceof NextResponse) return ebookId;
  const device = req.cookies.get(DEVICE_COOKIE)?.value;
  if (!isDeviceId(device)) return json(400, { error: "No device id: open the reader first" });
  const parsed = positionBodySchema().safeParse((await readJson(req)) ?? {});
  if (!parsed.success) {
    return json(400, { error: parsed.error.issues[0]?.message ?? "Invalid input", issues: parsed.error.issues });
  }
  try {
    const found = await ebookAndFile(ebookId, parsed.data.fileId.toLowerCase());
    if (!found.ebook) return json(404, { error: "Not found" });
    if (!found.fileOfEbook) return json(400, { error: "The file is not one of this eBook's" });
    const result = await savePosition({
      ebookId,
      deviceId: device,
      deviceLabel: deviceLabel(req.headers.get("user-agent")),
      body: { ...parsed.data, fileId: parsed.data.fileId.toLowerCase() },
    });
    return json(200, result);
  } catch (err) {
    console.error("[api/reader/position] Failed to save:", err);
    return json(500, { error: "Failed to save the place" });
  }
}
