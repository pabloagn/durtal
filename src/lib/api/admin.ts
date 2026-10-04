import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Guard for the media maintenance routes (reprocess, apply-crops,
 * backfill-palettes). They rewrite S3 files and media rows in bulk.
 *
 * Every call needs the `x-admin-token: <ADMIN_TOKEN>` header. When the
 * variable is not set, every call is refused: a missing setting never
 * leaves these routes open.
 */
export function requireAdminToken(req: Request): NextResponse | null {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Admin routes are disabled: ADMIN_TOKEN is not set" },
      { status: 503 },
    );
  }
  const given = Buffer.from(req.headers.get("x-admin-token") ?? "");
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
