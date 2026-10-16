import { NextRequest, NextResponse } from "next/server";
import { isUuid } from "@/lib/utils/uuid";
import { clearOpenFailure, recordOpenFailure } from "@/lib/ebooks/open-failure";

/** Prevent Next.js from caching this route handler's response. */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/ebooks/files/[fileId]/open-failure — the reader could not open
 * this file: `{ reason }` is kept under the file's `metadata.openFailure`
 * with the time, and the e-book page says the file is damaged (SLN-685).
 * DELETE clears it once the file opens. Same-origin only (src/proxy.ts);
 * 204, or 404 for an unknown file or one the reader is never given.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!isUuid(fileId)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  const body: unknown = await req.json().catch(() => null);
  const reason = body && typeof body === "object" ? (body as { reason?: unknown }).reason : undefined;
  if (typeof reason !== "string") return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  try {
    if (!(await recordOpenFailure(fileId.toLowerCase(), reason)))
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (err) {
    console.error("[api/ebooks/files/open-failure] Failed to record:", err);
    return NextResponse.json({ error: "Failed to record the failure" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  if (!isUuid(fileId)) return NextResponse.json({ error: "Invalid file id" }, { status: 400 });
  try {
    await clearOpenFailure(fileId.toLowerCase());
    return new NextResponse(null, { status: 204, headers: NO_STORE });
  } catch (err) {
    console.error("[api/ebooks/files/open-failure] Failed to clear:", err);
    return NextResponse.json({ error: "Failed to clear the failure" }, { status: 500 });
  }
}
