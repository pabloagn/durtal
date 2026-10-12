import { NextRequest, NextResponse } from "next/server";
import { crossOriginRefusal } from "@/lib/api/same-origin";
import { DEVICE_COOKIE, isDeviceId } from "@/lib/reader/device";
export const dynamic = "force-dynamic";
/** Read only: never creates or rotates the HTTP-only device cookie. */
export async function GET(req: NextRequest) {
  const refused = crossOriginRefusal(req);
  if (refused) {
    refused.headers.set("Cache-Control", "no-store");
    return refused;
  }
  const device = req.cookies.get(DEVICE_COOKIE)?.value;
  return NextResponse.json(
    { deviceId: isDeviceId(device) ? device : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
