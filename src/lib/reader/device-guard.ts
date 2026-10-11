import { NextResponse } from "next/server";
import { DEVICE_COOKIE, isDeviceId } from "./device";
import {
  EXPECTED_DEVICE_HEADER,
  deviceReplayPolicy,
} from "./offline/mutations";
import type { NextRequest } from "next/server";

/** Captured identity is checked before body parsing or any database work.
 * Legacy online callers without the header retain their existing cookie policy.
 */
export function expectedDeviceRefusal(req: NextRequest): NextResponse | null {
  const expected = req.headers.get(EXPECTED_DEVICE_HEADER);
  if (expected === null) return null;
  const current = req.cookies.get(DEVICE_COOKIE)?.value ?? null;
  const code = !isDeviceId(expected)
    ? "device_identity_changed"
    : deviceReplayPolicy(expected, current);
  return code === "ready"
    ? null
    : NextResponse.json(
        { error: "Reader device reconciliation required", code },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
}
