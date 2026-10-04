import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { serverEnv } from "@/lib/env";

/**
 * Shared helpers for the write routes of the REST API (task 0174).
 *
 * Every write needs `Authorization: Bearer <DURTAL_API_TOKEN>`. When the
 * variable is not set, every write is refused: a missing setting never
 * leaves the API open.
 */

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An error response when the request may not write, otherwise null. */
export function requireApiToken(req: NextRequest): NextResponse | null {
  const expected = serverEnv().DURTAL_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Writes are disabled: DURTAL_API_TOKEN is not set" },
      { status: 503 },
    );
  }
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** The JSON body, or undefined when the body is missing or not JSON. */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

/** A thrown error as a response: 400 for invalid input, 500 otherwise. */
export function errorResponse(err: unknown, fallback: string): NextResponse {
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: "Invalid input", issues: err.issues },
      { status: 400 },
    );
  }
  console.error(`[api] ${fallback}:`, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
