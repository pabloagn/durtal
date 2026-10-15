import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { DEVICE_COOKIE, deviceCookieOptions, isDeviceId } from "@/lib/reader/device";
export const dynamic = "force-dynamic";

function refusal(req: NextRequest) {
  const refused = crossOriginRefusal(req);
  refused?.headers.set("Cache-Control", "no-store");
  return refused;
}

/** Read only: never creates or rotates the HTTP-only device cookie. */
export async function GET(req: NextRequest) {
  const refused = refusal(req);
  if (refused) return refused;
  const device = req.cookies.get(DEVICE_COOKIE)?.value;
  return NextResponse.json(
    { deviceId: isDeviceId(device) ? device : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * This browser's device id, made now when it has none (SLN-668). The reader
 * calls it under a Web Lock before its first page, so two tabs opened at
 * once make one id; a valid cookie is returned as it is, never rotated.
 */
export async function POST(req: NextRequest) {
  const refused = refusal(req);
  if (refused) return refused;
  const saved = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = isDeviceId(saved) ? saved : crypto.randomUUID();
  const response = NextResponse.json({ deviceId }, { headers: { "Cache-Control": "no-store" } });
  if (deviceId !== saved)
    response.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions(req.nextUrl.protocol === "https:"));
  return response;
}
